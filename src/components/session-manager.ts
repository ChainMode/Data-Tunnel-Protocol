// DTP Session Manager Implementation
// Manages session lifecycle, state persistence/restoration, and timeout detection.

import { v4 as uuidv4 } from 'uuid';
import type { SessionManager, CAPContext } from '../types/components.js';
import type { Session, DirectionalTransferState } from '../types/session.js';
import type { SessionID } from '../types/frame.js';

/** Default timeout threshold: 5 minutes (300,000 ms) */
const DEFAULT_TIMEOUT_THRESHOLD = 300_000;

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

  /** Persisted session snapshots (simulated persistence store) */
  private readonly persistedSessions = new Map<SessionID, Session>();

  createSession(capContext: CAPContext): Session {
    const now = Date.now();
    const session: Session = {
      sessionId: uuidv4(),
      masterIdentity: capContext.identity,
      slaveIdentity: '',
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

    // Deep-copy the session into the persisted store
    const snapshot: Session = {
      ...session,
      activeAgreements: new Map(session.activeAgreements),
      collectionState: {
        ...session.collectionState,
        unacknowledgedFragmentCache: new Map(session.collectionState.unacknowledgedFragmentCache),
      },
      injectionState: {
        ...session.injectionState,
        unacknowledgedFragmentCache: new Map(session.injectionState.unacknowledgedFragmentCache),
      },
    };

    this.persistedSessions.set(sessionId, snapshot);
  }

  restoreSession(sessionId: SessionID): Session | null {
    const persisted = this.persistedSessions.get(sessionId);
    if (!persisted) {
      return null;
    }

    // Deep-copy from persisted store back into active sessions
    const restored: Session = {
      ...persisted,
      activeAgreements: new Map(persisted.activeAgreements),
      collectionState: {
        ...persisted.collectionState,
        unacknowledgedFragmentCache: new Map(persisted.collectionState.unacknowledgedFragmentCache),
      },
      injectionState: {
        ...persisted.injectionState,
        unacknowledgedFragmentCache: new Map(persisted.injectionState.unacknowledgedFragmentCache),
      },
      lastActivityAt: Date.now(),
    };

    this.sessions.set(sessionId, restored);
    return restored;
  }

  closeSession(sessionId: SessionID): void {
    this.sessions.delete(sessionId);
  }

  checkTimeout(sessionId: SessionID): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return true; // Non-existent session is considered timed out
    }
    return Date.now() > session.lastActivityAt + session.timeoutThreshold;
  }
}
