// DTP Session Manager & Encrypted Persistence Implementation
// Manages session lifecycle, pluggable session stores (InMemorySessionStore &
// EncryptedFileSessionStore per OQ-DTP-10), identity validation (OQ-DTP-9), and timeouts.

import { v4 as uuidv4 } from 'uuid';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SessionManager, CAPContext } from '../types/components.js';
import type { Session, DirectionalTransferState } from '../types/session.js';
import type { Agreement } from '../types/agreement.js';
import type { Fragment } from '../types/fragment.js';
import type { SessionID, SequenceNumber } from '../types/frame.js';
import { DTPErrorCode } from '../errors/error-codes.js';

/** Default timeout threshold: 5 minutes (300,000 ms) */
const DEFAULT_TIMEOUT_THRESHOLD = 300_000;

/** Snapshot file header constants for EncryptedFileSessionStore */
const SNAPSHOT_MAGIC = Buffer.from('DTPS', 'ascii');
const SNAPSHOT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Recommended canonical FayID pattern for Fay masters (OQ-DTP-9; authoritative syntax in FayID repo) */
const CANONICAL_FAY_ID_REGEX = /^(ifay|cofay)_[A-Za-z0-9_]+$/;

/**
 * Check whether an identity string uses the recommended canonical FayID prefix
 * (`ifay_...` or `cofay_...`) per OQ-DTP-9.
 */
export function isCanonicalFayId(identity: string): boolean {
  return CANONICAL_FAY_ID_REGEX.test(identity);
}

/** Deep-clone a Fragment including its Uint8Array payload and customFields */
function cloneFragment(fragment: Fragment): Fragment {
  return {
    fragmentId: fragment.fragmentId,
    agreementId: fragment.agreementId,
    originTimestamp: fragment.originTimestamp,
    contextMetadata: {
      dataType: fragment.contextMetadata.dataType,
      source: { ...fragment.contextMetadata.source },
      customFields: { ...fragment.contextMetadata.customFields },
    },
    dagDependencies: fragment.dagDependencies.map((d) => ({ ...d })),
    data: new Uint8Array(fragment.data),
  };
}

/** Deep-clone a DirectionalTransferState */
function cloneDirectionalState(state: DirectionalTransferState): DirectionalTransferState {
  const cache = new Map<SequenceNumber, Fragment>();
  for (const [seq, frag] of state.unacknowledgedFragmentCache.entries()) {
    cache.set(seq, cloneFragment(frag));
  }
  return {
    currentSequenceNumber: state.currentSequenceNumber,
    highestAcknowledgedSequenceNumber: state.highestAcknowledgedSequenceNumber,
    unacknowledgedFragmentCache: cache,
  };
}

/** Deep-clone a Session */
function cloneSession(session: Session): Session {
  const activeAgreements = new Map<string, Agreement>();
  for (const [id, agr] of session.activeAgreements.entries()) {
    activeAgreements.set(id, {
      ...agr,
      params: { ...agr.params },
    });
  }
  return {
    ...session,
    activeAgreements,
    collectionState: cloneDirectionalState(session.collectionState),
    injectionState: cloneDirectionalState(session.injectionState),
  };
}

/** Pluggable persistence store contract for DTP sessions (OQ-DTP-10) */
export interface SessionStore {
  save(sessionId: SessionID, session: Session): void;
  load(sessionId: SessionID): Session | null;
  delete(sessionId: SessionID): void;
}

/** Default in-memory session store for unit tests and ephemeral runtimes */
export class InMemorySessionStore implements SessionStore {
  private readonly store = new Map<SessionID, Session>();

  save(sessionId: SessionID, session: Session): void {
    this.store.set(sessionId, cloneSession(session));
  }

  load(sessionId: SessionID): Session | null {
    const existing = this.store.get(sessionId);
    return existing ? cloneSession(existing) : null;
  }

  delete(sessionId: SessionID): void {
    this.store.delete(sessionId);
  }
}

interface SerializedFragment {
  fragmentId: Fragment['fragmentId'];
  agreementId: Fragment['agreementId'];
  originTimestamp: Fragment['originTimestamp'];
  contextMetadata: Fragment['contextMetadata'];
  dagDependencies: Fragment['dagDependencies'];
  dataBase64: string;
}

interface SerializedDirectionalState {
  currentSequenceNumber: number;
  highestAcknowledgedSequenceNumber: number;
  unacknowledgedFragmentCache: Array<[number, SerializedFragment]>;
}

interface SerializedSession {
  sessionId: string;
  masterIdentity: string;
  slaveIdentity: string;
  state: Session['state'];
  activeAgreements: Array<[string, Agreement]>;
  collectionState: SerializedDirectionalState;
  injectionState: SerializedDirectionalState;
  createdAt: number;
  lastActivityAt: number;
  timeoutThreshold: number;
}

function serializeDirectionalState(state: DirectionalTransferState): SerializedDirectionalState {
  const entries: Array<[number, SerializedFragment]> = [];
  for (const [seq, frag] of state.unacknowledgedFragmentCache.entries()) {
    entries.push([
      seq,
      {
        fragmentId: frag.fragmentId,
        agreementId: frag.agreementId,
        originTimestamp: frag.originTimestamp,
        contextMetadata: frag.contextMetadata,
        dagDependencies: frag.dagDependencies,
        dataBase64: Buffer.from(frag.data).toString('base64'),
      },
    ]);
  }
  return {
    currentSequenceNumber: state.currentSequenceNumber,
    highestAcknowledgedSequenceNumber: state.highestAcknowledgedSequenceNumber,
    unacknowledgedFragmentCache: entries,
  };
}

function deserializeDirectionalState(raw: SerializedDirectionalState): DirectionalTransferState {
  const cache = new Map<SequenceNumber, Fragment>();
  for (const [seq, frag] of raw.unacknowledgedFragmentCache) {
    cache.set(seq, {
      fragmentId: frag.fragmentId,
      agreementId: frag.agreementId,
      originTimestamp: frag.originTimestamp,
      contextMetadata: frag.contextMetadata,
      dagDependencies: frag.dagDependencies,
      data: new Uint8Array(Buffer.from(frag.dataBase64, 'base64')),
    });
  }
  return {
    currentSequenceNumber: raw.currentSequenceNumber,
    highestAcknowledgedSequenceNumber: raw.highestAcknowledgedSequenceNumber,
    unacknowledgedFragmentCache: cache,
  };
}

function serializeSession(session: Session): SerializedSession {
  return {
    sessionId: session.sessionId,
    masterIdentity: session.masterIdentity,
    slaveIdentity: session.slaveIdentity,
    state: session.state,
    activeAgreements: [...session.activeAgreements.entries()],
    collectionState: serializeDirectionalState(session.collectionState),
    injectionState: serializeDirectionalState(session.injectionState),
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    timeoutThreshold: session.timeoutThreshold,
  };
}

function deserializeSession(raw: SerializedSession): Session {
  return {
    sessionId: raw.sessionId,
    masterIdentity: raw.masterIdentity,
    slaveIdentity: raw.slaveIdentity,
    state: raw.state,
    activeAgreements: new Map(raw.activeAgreements),
    collectionState: deserializeDirectionalState(raw.collectionState),
    injectionState: deserializeDirectionalState(raw.injectionState),
    createdAt: raw.createdAt,
    lastActivityAt: raw.lastActivityAt,
    timeoutThreshold: raw.timeoutThreshold,
  };
}

/**
 * AES-256-GCM encrypted file session store (OQ-DTP-10).
 * Ensures unacknowledged decrypted Fragments are NEVER persisted in plaintext on disk.
 * Wire layout on disk: [4B "DTPS"][1B version=1][12B IV][AES-256-GCM ciphertext][16B AuthTag]
 */
export class EncryptedFileSessionStore implements SessionStore {
  private readonly filePath: string;
  private readonly storageKey: Uint8Array;

  constructor(filePath: string, storageKey: Uint8Array) {
    if (storageKey.length !== KEY_BYTES) {
      throw new Error(`Invalid storageKey length: expected ${KEY_BYTES} bytes, got ${storageKey.length}`);
    }
    this.filePath = filePath;
    this.storageKey = new Uint8Array(storageKey);
  }

  save(sessionId: SessionID, session: Session): void {
    const allSessions = existsSync(this.filePath) ? this.readAllFromDisk() : {};
    allSessions[sessionId] = serializeSession(cloneSession(session));
    this.writeAllToDisk(allSessions);
  }

  load(sessionId: SessionID): Session | null {
    if (!existsSync(this.filePath)) {
      return null;
    }
    const allSessions = this.readAllFromDisk();
    const raw = allSessions[sessionId];
    return raw ? deserializeSession(raw) : null;
  }

  delete(sessionId: SessionID): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    const allSessions = this.readAllFromDisk();
    if (sessionId in allSessions) {
      delete allSessions[sessionId];
      this.writeAllToDisk(allSessions);
    }
  }

  private readAllFromDisk(): Record<string, SerializedSession> {
    const raw = readFileSync(this.filePath);
    const minLen = SNAPSHOT_MAGIC.length + 1 + IV_BYTES + TAG_BYTES;
    if (raw.length < minLen) {
      throw Object.assign(
        new Error('Encrypted session store corrupted: file too short'),
        { code: DTPErrorCode.SESSION_RESTORE_FAILED },
      );
    }

    if (!raw.subarray(0, 4).equals(SNAPSHOT_MAGIC) || raw[4] !== SNAPSHOT_VERSION) {
      throw Object.assign(
        new Error('Encrypted session store corrupted: invalid header magic or version'),
        { code: DTPErrorCode.SESSION_RESTORE_FAILED },
      );
    }

    const iv = raw.subarray(5, 5 + IV_BYTES);
    const authTag = raw.subarray(raw.length - TAG_BYTES);
    const ciphertext = raw.subarray(5 + IV_BYTES, raw.length - TAG_BYTES);

    try {
      const decipher = createDecipheriv('aes-256-gcm', this.storageKey, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(plaintext.toString('utf-8')) as Record<string, SerializedSession>;
    } catch {
      throw Object.assign(
        new Error('Failed to decrypt or authenticate persisted session snapshot'),
        { code: DTPErrorCode.SESSION_RESTORE_FAILED },
      );
    }
  }

  private writeAllToDisk(data: Record<string, SerializedSession>): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });

    const plaintext = Buffer.from(JSON.stringify(data), 'utf-8');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.storageKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const header = Buffer.alloc(5);
    SNAPSHOT_MAGIC.copy(header, 0);
    header[4] = SNAPSHOT_VERSION;

    const envelope = Buffer.concat([header, iv, ciphertext, authTag]);
    const tmpPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmpPath, envelope, { mode: 0o600 });
    renameSync(tmpPath, this.filePath);
  }
}

/** Create a fresh DirectionalTransferState with zeroed counters */
function createDirectionalTransferState(): DirectionalTransferState {
  return {
    currentSequenceNumber: 0,
    highestAcknowledgedSequenceNumber: 0,
    unacknowledgedFragmentCache: new Map(),
  };
}

export class DTPSessionManager implements SessionManager {
  /** Active sessions keyed by SessionID */
  private readonly sessions = new Map<SessionID, Session>();

  /** Pluggable session persistence store (defaults to InMemorySessionStore) */
  private readonly store: SessionStore;

  constructor(store?: SessionStore) {
    this.store = store ?? new InMemorySessionStore();
  }

  createSession(capContext: CAPContext, slaveIdentity: string = ''): Session {
    if (typeof capContext.identity !== 'string' || capContext.identity.trim().length === 0) {
      throw Object.assign(
        new Error('Session masterIdentity must be a non-empty opaque identifier (OQ-DTP-9)'),
        { code: DTPErrorCode.PERMISSION_DENIED },
      );
    }
    if (slaveIdentity !== '' && slaveIdentity.trim().length === 0) {
      throw Object.assign(
        new Error('Session slaveIdentity cannot be whitespace-only (OQ-DTP-9)'),
        { code: DTPErrorCode.PERMISSION_DENIED },
      );
    }

    const now = Date.now();
    const session: Session = {
      sessionId: uuidv4(),
      masterIdentity: capContext.identity,
      slaveIdentity,
      state: 'established',
      activeAgreements: new Map(),
      collectionState: createDirectionalTransferState(),
      injectionState: createDirectionalTransferState(),
      createdAt: now,
      lastActivityAt: now,
      timeoutThreshold: DEFAULT_TIMEOUT_THRESHOLD,
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: SessionID): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  persistSession(sessionId: SessionID): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.store.save(sessionId, session);
  }

  restoreSession(sessionId: SessionID): Session | null {
    const persisted = this.store.load(sessionId);
    if (!persisted) {
      return null;
    }

    const restored = cloneSession(persisted);
    restored.lastActivityAt = Date.now();

    this.sessions.set(sessionId, restored);
    return restored;
  }

  closeSession(sessionId: SessionID): void {
    this.sessions.delete(sessionId);
  }

  /** Delete persisted snapshot as well (used when session expires due to idle timeout) */
  purgeSession(sessionId: SessionID): void {
    this.sessions.delete(sessionId);
    this.store.delete(sessionId);
  }

  checkTimeout(sessionId: SessionID, now: number = Date.now()): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return true; // Non-existent session is considered timed out
    }
    return now > session.lastActivityAt + session.timeoutThreshold;
  }
}
