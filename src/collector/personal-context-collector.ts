/**
 * DTP 1.0 Official Personal Context Collector & Privacy-Filtered Minimal Injection SDK
 *
 * Implements the two locked MVP flows on top of the normative DTP 1.0 engine
 * (RFC 8785 JCS + AES-256-GCM wire framing):
 *   1. Terminal -> iFay Contextual Collection: scans or watches an authorized local
 *      notes/workspace folder, attaches contextual metadata (timestamp, timezone,
 *      ambient_activity, device_class, source_app), negotiates a DTP collection
 *      agreement, encrypts fragments into DTP 1.0 wire frames (100% compatible with
 *      @ifay/soul ingestDtpContextFrame), and commits them into a Personal Data Heap.
 *   2. iFay -> App Privacy-Filtered Minimal Data Injection: evaluates an external
 *      app's personalization request against a Human Prime disclosure policy, strips
 *      all raw note history, paths, and identifiers, and injects ONLY the minimal
 *      approved fields over an encrypted DTP 1.0 injection tunnel.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DTPEngine } from '../components/dtp-engine.js';
import { DTPFrameCodec, canonicalizeJson } from '../components/frame-codec.js';
import { DTPEncryptionModule } from '../components/encryption-module.js';
import { ContextMetadataValidator } from '../components/context-metadata-validator.js';
import { InMemoryTransportAdapter } from '../components/transport-adapter.js';
import type {
  CAPContext,
  ContextMetadata,
  DAGEdge,
  LogicalFrame,
} from '../types/index.js';

export const IFAY_DTP_CONTEXT_SCHEMA = 'ifay-dtp-context/1.0';
export const IFAY_DTP_INJECTION_SCHEMA = 'ifay-dtp-minimal-injection/1.0';
export const PERSONAL_HEAP_MANIFEST_VERSION = 'dtp-personal-heap/1.0';

const DEFAULT_ALLOWED_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
]);

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'target',
  '.dev-os',
  '.iaccord',
]);

/** Identifiers and raw-history keys unconditionally stripped from external app injections */
const ALWAYS_STRIPPED_KEYS = new Set([
  'text',
  'raw_text',
  'raw_history',
  'content',
  'source_rel_path',
  'file_path',
  'fay_id',
  'human_prime_id',
  'sender_fay_id',
  'email',
  'phone',
  'ssn',
  'passport',
  'api_key',
  'secret',
  'password',
  'mnemonic',
]);

export type ThoughtSubtype = 'content' | 'data' | 'knowledge_base' | 'info_feed';

export interface AmbientCaptureContext {
  timestamp?: string;
  timezone?: string;
  ambient_activity?: string;
  device_class?: string;
  source_app?: string;
}

export interface DtpPersonalContextPayload {
  schema: typeof IFAY_DTP_CONTEXT_SCHEMA;
  subtype: ThoughtSubtype;
  title: string;
  text: string;
  domain: string;
  tags: string[];
  source_rel_path?: string;
  context_metadata: {
    timestamp: string;
    timezone: string;
    ambient_activity: string;
    device_class: string;
    source_app: string;
  };
  dtp_source_descriptor: ContextMetadata;
  structured_fields: Record<string, unknown>;
}

export interface HeapFrameManifestEntry {
  sequenceNumber: number;
  fragmentId: string;
  agreementId: string | null;
  originTimestamp: number;
  frameFile: string;
  byteLength: number;
  sha256: string;
  dagDependencies: DAGEdge[];
}

export interface HeapManifest {
  schema_version: typeof PERSONAL_HEAP_MANIFEST_VERSION;
  owner_fay_id: string;
  created_at: string;
  updated_at: string;
  frame_count: number;
  frames: HeapFrameManifestEntry[];
}

export interface DecryptedHeapRecord {
  manifestEntry: HeapFrameManifestEntry;
  frame: LogicalFrame;
  payload: DtpPersonalContextPayload;
}

export interface CollectWorkspaceOptions {
  workspaceDir: string;
  heapDir: string;
  sessionKey: Uint8Array;
  ownerFayId?: string;
  terminalDeviceId?: string;
  domain?: string;
  subtype?: ThoughtSubtype;
  tags?: string[];
  allowedExtensions?: string[];
  ambientContext?: AmbientCaptureContext;
  deterministicIvSeed?: string;
}

export interface CollectWorkspaceResult {
  sessionId: string;
  agreementId: string;
  scannedFiles: number;
  committedFrames: number;
  heapManifest: HeapManifest;
  wireFrames: Uint8Array[];
}

export interface WatchWorkspaceOptions extends CollectWorkspaceOptions {
  debounceMs?: number;
  onCommit?: (result: CollectWorkspaceResult) => void;
}

export interface WatchHandle {
  close: () => void;
  flush: () => CollectWorkspaceResult;
}

export interface ExternalAppContextRequest {
  appId: string;
  purpose: string;
  requestedFields: string[];
  appSessionKey?: Uint8Array;
}

export interface MinimalDisclosurePolicy {
  approvedFields: string[];
  allowedPurposes?: string[];
  validityPeriodMs?: number;
}

export interface MinimalContextInjectionResult {
  approved: boolean;
  rejectionReason?: string;
  appId: string;
  purpose: string;
  agreementId: string | null;
  injectedFields: Record<string, unknown>;
  withheldFields: string[];
  strippedProtectedFields: string[];
  wireFrame: Uint8Array | null;
  decryptedAppView: {
    schema: typeof IFAY_DTP_INJECTION_SCHEMA;
    app_id: string;
    purpose: string;
    disclosed_at: string;
    attributes: Record<string, unknown>;
  } | null;
}

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function deriveCollectorKeyFromHexOrPassphrase(secret: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return new Uint8Array(Buffer.from(secret, 'hex'));
  }
  return new Uint8Array(createHash('sha256').update(secret, 'utf8').digest());
}

function resolveDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Extract structured personalization key-value pairs from Markdown frontmatter,
 * `key: value` preference lines, or JSON note files, while never leaking raw prose.
 */
export function extractStructuredPersonalFields(
  rawContent: string,
  ext: string,
): Record<string, unknown> {
  const extracted: Record<string, unknown> = {};

  if (ext === '.json') {
    try {
      const parsed = JSON.parse(rawContent) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (
            v === null ||
            typeof v === 'string' ||
            typeof v === 'number' ||
            typeof v === 'boolean' ||
            Array.isArray(v)
          ) {
            extracted[k] = v;
          }
        }
      }
    } catch {
      // Ignore malformed JSON snippet and treat as plain note
    }
    return extracted;
  }

  const lines = rawContent.split(/\r?\n/);
  let inFrontmatter = false;
  let frontmatterChecked = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!frontmatterChecked) {
      frontmatterChecked = true;
      if (trimmed === '---') {
        inFrontmatter = true;
        continue;
      }
    } else if (inFrontmatter && trimmed === '---') {
      inFrontmatter = false;
      continue;
    }

    // Match frontmatter `key: value` or bulleted `- preference_key: value`
    const candidate = inFrontmatter
      ? trimmed
      : trimmed.startsWith('- ') || trimmed.startsWith('* ')
        ? trimmed.slice(2).trim()
        : trimmed;

    const match = /^([a-z][a-z0-9_]{1,48})\s*:\s*(.+)$/i.exec(candidate);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (key === 'http' || key === 'https' || key === 'mailto') continue;

    let valueStr = match[2].trim();
    if (
      (valueStr.startsWith('"') && valueStr.endsWith('"')) ||
      (valueStr.startsWith("'") && valueStr.endsWith("'"))
    ) {
      valueStr = valueStr.slice(1, -1);
    }

    if (valueStr === 'true') {
      extracted[key] = true;
    } else if (valueStr === 'false') {
      extracted[key] = false;
    } else if (/^-?\d+(\.\d+)?$/.test(valueStr)) {
      extracted[key] = Number(valueStr);
    } else if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
      const items = valueStr
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      extracted[key] = items;
    } else {
      extracted[key] = valueStr;
    }
  }

  return extracted;
}

function inferTitleFromNote(relPath: string, content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const heading = /^#\s+(.+)$/.exec(line.trim());
    if (heading && heading[1].trim().length > 0) {
      return heading[1].trim();
    }
  }
  return relPath;
}

function walkWorkspaceFiles(
  rootDir: string,
  currentDir: string,
  allowedExtensions: Set<string>,
  collected: string[],
): void {
  const entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') {
      continue;
    }
    if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
      continue;
    }
    const absPath = resolve(currentDir, entry.name);
    // Strict workspace confinement guard
    if (absPath !== rootDir && !absPath.startsWith(rootDir + sep)) {
      continue;
    }
    if (entry.isDirectory()) {
      walkWorkspaceFiles(rootDir, absPath, allowedExtensions, collected);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (allowedExtensions.has(ext)) {
        collected.push(absPath);
      }
    }
  }
}

/**
 * Local encrypted Personal Data Heap storing ONLY DTP 1.0 AES-256-GCM wire frames on disk.
 * Directly ingestible by `@ifay/soul` (`ingestDtpContextFrame` / `PrimaryBodyStore.ingestDtpFrame`).
 */
export class PersonalDataHeap {
  readonly heapDir: string;
  readonly framesDir: string;
  readonly manifestPath: string;
  private readonly codec = new DTPFrameCodec();

  constructor(heapDir: string) {
    this.heapDir = resolve(heapDir);
    this.framesDir = join(this.heapDir, 'frames');
    this.manifestPath = join(this.heapDir, 'manifest.json');
  }

  ensureInitialized(ownerFayId: string = 'ifay_personalcollector234567'): HeapManifest {
    mkdirSync(this.framesDir, { recursive: true });
    if (existsSync(this.manifestPath)) {
      return JSON.parse(readFileSync(this.manifestPath, 'utf8')) as HeapManifest;
    }
    const nowIso = new Date().toISOString();
    const initial: HeapManifest = {
      schema_version: PERSONAL_HEAP_MANIFEST_VERSION,
      owner_fay_id: ownerFayId,
      created_at: nowIso,
      updated_at: nowIso,
      frame_count: 0,
      frames: [],
    };
    writeFileSync(this.manifestPath, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }

  getManifest(): HeapManifest {
    if (!existsSync(this.manifestPath)) {
      return this.ensureInitialized();
    }
    return JSON.parse(readFileSync(this.manifestPath, 'utf8')) as HeapManifest;
  }

  appendWireFrame(wireFrame: Uint8Array, ownerFayId?: string): HeapFrameManifestEntry {
    const manifest = this.ensureInitialized(ownerFayId);
    const deserialized = this.codec.deserialize(wireFrame);
    const seqStr = String(manifest.frames.length + 1).padStart(5, '0');
    const safeFrag = deserialized.header.fragmentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${seqStr}-${safeFrag}.dtp`;
    const filePath = join(this.framesDir, fileName);

    writeFileSync(filePath, Buffer.from(wireFrame));

    const entry: HeapFrameManifestEntry = {
      sequenceNumber: deserialized.header.sequenceNumber,
      fragmentId: deserialized.header.fragmentId,
      agreementId: deserialized.header.agreementId,
      originTimestamp: deserialized.header.originTimestamp,
      frameFile: `frames/${fileName}`,
      byteLength: wireFrame.byteLength,
      sha256: sha256Hex(wireFrame),
      dagDependencies: deserialized.header.dagDependencies,
    };

    manifest.frames.push(entry);
    manifest.frame_count = manifest.frames.length;
    manifest.updated_at = new Date().toISOString();
    writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return entry;
  }

  readWireFrames(): Uint8Array[] {
    const manifest = this.getManifest();
    return manifest.frames.map((entry) => {
      const fullPath = join(this.heapDir, entry.frameFile);
      return new Uint8Array(readFileSync(fullPath));
    });
  }

  readDecryptedEntries(sessionKey: Uint8Array): DecryptedHeapRecord[] {
    const manifest = this.getManifest();
    const encryption = new DTPEncryptionModule(sessionKey);
    const records: DecryptedHeapRecord[] = [];

    for (const entry of manifest.frames) {
      const fullPath = join(this.heapDir, entry.frameFile);
      const wireBytes = new Uint8Array(readFileSync(fullPath));
      const encryptedFrame = this.codec.deserialize(wireBytes);
      const plaintextBytes = encryption.decryptPayload(
        encryptedFrame.payload,
        encryptedFrame.header.encryptionMetadata,
      );
      const payload = JSON.parse(
        Buffer.from(plaintextBytes).toString('utf8'),
      ) as DtpPersonalContextPayload;
      records.push({
        manifestEntry: entry,
        frame: {
          header: encryptedFrame.header,
          payload: plaintextBytes,
        },
        payload,
      });
    }
    return records;
  }
}

/**
 * Flow 1 (`Terminal -> iFay` Contextual Collection):
 * Scans an authorized workspace directory, attaches rich ambient context metadata,
 * negotiates a DTP 1.0 collection agreement between iFay (master) and Terminal (slave),
 * encrypts fragments into DTP 1.0 wire frames, and commits them to the Personal Data Heap.
 */
export function collectWorkspaceToHeap(
  options: CollectWorkspaceOptions,
): CollectWorkspaceResult {
  const rootDir = resolve(options.workspaceDir);
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    throw new Error(`Authorized workspace directory does not exist: ${rootDir}`);
  }
  if (!(options.sessionKey instanceof Uint8Array) || options.sessionKey.length !== 32) {
    throw new Error('DTP Personal Context Collector requires a 32-byte AES-256-GCM sessionKey');
  }

  const ownerFayId = options.ownerFayId ?? 'ifay_personalcollector234567';
  const terminalDeviceId = options.terminalDeviceId ?? 'host_laptop_terminal_01';
  const allowedExts = new Set(
    (options.allowedExtensions ?? [...DEFAULT_ALLOWED_EXTENSIONS]).map((e) =>
      e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`,
    ),
  );

  const files: string[] = [];
  walkWorkspaceFiles(rootDir, rootDir, allowedExts, files);

  // Pair iFay (master) and Terminal Collector (slave) DTP engines
  const masterTransport = new InMemoryTransportAdapter();
  const slaveTransport = new InMemoryTransportAdapter();
  InMemoryTransportAdapter.pair(masterTransport, slaveTransport);

  const ifayMaster = new DTPEngine('master', masterTransport);
  const terminalSlave = new DTPEngine('slave', slaveTransport);

  const masterCap: CAPContext = {
    identity: ownerFayId,
    sessionKey: options.sessionKey,
    verified: true,
  };
  const slaveCap: CAPContext = {
    identity: terminalDeviceId,
    sessionKey: options.sessionKey,
    verified: true,
  };

  const masterSession = ifayMaster.createSession(masterCap);
  const slaveSession = terminalSlave.createSession(slaveCap);

  const masterConn = masterTransport.connect({ protocol: 'memory', address: 'ifay-heap' });
  const slaveConnId = Array.from(
    (slaveTransport as unknown as { connections: Map<string, unknown> }).connections.keys(),
  )[0];
  ifayMaster.bindConnection(masterSession.sessionId, masterConn.connectionId);
  terminalSlave.bindConnection(slaveSession.sessionId, slaveConnId);

  // Master initiates collection agreement -> Slave accepts -> Master activates agreement
  const collectionRequest = ifayMaster.initiateAgreement(masterSession.sessionId, {
    direction: 'collection',
    proposedParams: {
      dataType: 'personal_context_note',
      dataRange: rootDir,
      transferMode: 'one_time',
      frequency: null,
      validityPeriod: 3_600_000,
      priority: 'normal',
    },
  });
  const slaveResponse = terminalSlave.handleAgreementRequest(
    slaveSession.sessionId,
    collectionRequest,
  );
  const activeAgreement = ifayMaster.handleAgreementResponse(
    masterSession.sessionId,
    slaveResponse,
  );
  if (!activeAgreement) {
    throw new Error('Terminal collector rejected DTP collection agreement');
  }
  terminalSlave.transitionState(slaveSession.sessionId, 'negotiating');
  terminalSlave.transitionState(slaveSession.sessionId, 'transmitting');

  // Capture raw wire frames arriving at iFay Master before committing to Personal Data Heap
  const capturedWireFrames: Uint8Array[] = [];
  masterTransport.onReceive((_connId, rawWireData) => {
    capturedWireFrames.push(new Uint8Array(rawWireData));
  });

  const receivedLogicalFrames: LogicalFrame[] = [];
  ifayMaster.onFrameReceived((_sessId, decryptedFrame) => {
    receivedLogicalFrames.push(decryptedFrame);
  });

  const metadataValidator = new ContextMetadataValidator();
  const heap = new PersonalDataHeap(options.heapDir);
  const existingManifest = heap.ensureInitialized(ownerFayId);

  // Deduplicate unchanged files against existing heap entries when key matches
  const existingNoteFrameByPath = new Map<string, { fragmentId: string; textSha: string }>();
  try {
    const existingRecords = heap.readDecryptedEntries(options.sessionKey);
    for (const rec of existingRecords) {
      if (rec.payload.source_rel_path) {
        existingNoteFrameByPath.set(rec.payload.source_rel_path, {
          fragmentId: rec.manifestEntry.fragmentId,
          textSha: sha256Hex(rec.payload.text),
        });
      }
    }
  } catch {
    // Different key or empty heap; skip dedup lookup
  }

  const nowDate = options.ambientContext?.timestamp
    ? new Date(options.ambientContext.timestamp)
    : new Date();
  const timestampIso = nowDate.toISOString();
  const originTimestampMs = nowDate.getTime();
  const timezone = options.ambientContext?.timezone ?? resolveDefaultTimezone();
  const ambientActivity = options.ambientContext?.ambient_activity ?? 'deep_work';
  const deviceClass = options.ambientContext?.device_class ?? 'laptop_workstation';
  const sourceApp = options.ambientContext?.source_app ?? 'dtp-collector';

  let committedCount = 0;

  for (let idx = 0; idx < files.length; idx++) {
    const absFile = files[idx];
    const relPath = relative(rootDir, absFile).split(sep).join('/');
    const rawText = readFileSync(absFile, 'utf8');
    const textSha = sha256Hex(rawText);

    const prevForNote = existingNoteFrameByPath.get(relPath);
    if (prevForNote && prevForNote.textSha === textSha) {
      continue;
    }

    const dtpSourceDescriptor: ContextMetadata = {
      dataType: 'personal_context_note',
      source: {
        kind: 'software',
        appIdentifier: sourceApp,
        sharingMethod: 'dtp_authorized_workspace_collector',
      },
      customFields: {
        timestamp: timestampIso,
        timezone,
        ambient_activity: ambientActivity,
        device_class: deviceClass,
        source_app: sourceApp,
      },
    };

    const metaValidation = metadataValidator.validate(dtpSourceDescriptor);
    if (!metaValidation.valid) {
      throw new Error(
        `ContextMetadata validation failed: ${metaValidation.errors.join('; ')}`,
      );
    }

    const structuredFields = extractStructuredPersonalFields(
      rawText,
      extname(absFile).toLowerCase(),
    );

    const payloadObj: DtpPersonalContextPayload = {
      schema: IFAY_DTP_CONTEXT_SCHEMA,
      subtype: options.subtype ?? 'knowledge_base',
      title: inferTitleFromNote(relPath, rawText),
      text: rawText,
      domain: options.domain ?? 'personal_workspace',
      tags: Array.from(
        new Set([
          ...(options.tags ?? ['workspace-note']),
          `activity:${ambientActivity}`,
          `device:${deviceClass}`,
        ]),
      ),
      source_rel_path: relPath,
      context_metadata: {
        timestamp: timestampIso,
        timezone,
        ambient_activity: ambientActivity,
        device_class: deviceClass,
        source_app: sourceApp,
      },
      dtp_source_descriptor: dtpSourceDescriptor,
      structured_fields: structuredFields,
    };

    const plaintextBytes = new Uint8Array(
      Buffer.from(canonicalizeJson(payloadObj), 'utf8'),
    );

    const dagDependencies: DAGEdge[] = prevForNote
      ? [{ targetFragmentId: prevForNote.fragmentId, relationType: 'derived_from' }]
      : [];

    const seqNum = existingManifest.frames.length + committedCount + 1;
    const fragmentId = `frag_ctx_${seqNum}_${textSha.slice(0, 12)}`;

    if (options.deterministicIvSeed) {
      const iv = createHash('sha256')
        .update(`${options.deterministicIvSeed}:${fragmentId}`)
        .digest()
        .subarray(0, 12);
      const encMod = new DTPEncryptionModule(options.sessionKey);
      const codec = new DTPFrameCodec();
      const header = {
        protocolVersion: { major: 1, minor: 0 },
        frameType: 'data' as const,
        fragmentId,
        agreementId: activeAgreement.agreementId,
        originTimestamp: originTimestampMs,
        dagDependencies,
        encryptionMetadata: encMod.getEncryptionMetadata(),
        sequenceNumber: seqNum,
      };
      const encPayload = encMod.encryptPayloadWithIv(plaintextBytes, iv);
      const wire = codec.serialize({ header, payload: encPayload });
      slaveTransport.send(slaveConnId, wire);
    } else {
      terminalSlave.sendFrame(slaveSession.sessionId, {
        header: {
          protocolVersion: { major: 1, minor: 0 },
          frameType: 'data',
          fragmentId,
          agreementId: activeAgreement.agreementId,
          originTimestamp: originTimestampMs,
          dagDependencies,
          encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
          sequenceNumber: seqNum,
        },
        payload: plaintextBytes,
      });
    }

    const latestWire = capturedWireFrames[capturedWireFrames.length - 1];
    const latestLogical = receivedLogicalFrames[receivedLogicalFrames.length - 1];
    if (!latestWire || !latestLogical) {
      throw new Error(`DTP Engine failed to verify frame for ${relPath}`);
    }

    const dagCheck = ifayMaster.dagManager.addFragment({
      fragmentId: latestLogical.header.fragmentId,
      data: latestLogical.payload,
      originTimestamp: latestLogical.header.originTimestamp,
      agreementId: latestLogical.header.agreementId ?? activeAgreement.agreementId,
      contextMetadata: dtpSourceDescriptor,
      dagDependencies: latestLogical.header.dagDependencies,
    });
    if (dagCheck.status === 'rejected') {
      throw new Error(`DAG cycle detected while committing fragment ${fragmentId}`);
    }

    heap.appendWireFrame(latestWire, ownerFayId);
    committedCount += 1;
  }

  ifayMaster.closeSession(masterSession.sessionId);
  terminalSlave.closeSession(slaveSession.sessionId);

  return {
    sessionId: masterSession.sessionId,
    agreementId: activeAgreement.agreementId,
    scannedFiles: files.length,
    committedFrames: committedCount,
    heapManifest: heap.getManifest(),
    wireFrames: capturedWireFrames,
  };
}

/**
 * Watch an authorized workspace folder for note changes and continuously commit
 * encrypted DTP 1.0 fragments into the Personal Data Heap.
 */
export function watchWorkspaceToHeap(options: WatchWorkspaceOptions): WatchHandle {
  const debounceMs = options.debounceMs ?? 100;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const flush = (): CollectWorkspaceResult => {
    const res = collectWorkspaceToHeap(options);
    if (res.committedFrames > 0 && options.onCommit) {
      options.onCommit(res);
    }
    return res;
  };

  // Initial scan upon watch start
  flush();

  const watcher: FSWatcher = watch(
    resolve(options.workspaceDir),
    { recursive: true },
    () => {
      if (closed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!closed) {
          flush();
        }
      }, debounceMs);
    },
  );

  return {
    flush,
    close: () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      watcher.close();
    },
  };
}

/**
 * Flow 2 (`iFay -> App` Privacy-Filtered Minimal Data Injection):
 * External app (Slave) requests personalization attributes from iFay (Master).
 * iFay evaluates Human Prime disclosure policy, strips all raw history, file paths,
 * and identifiers, and injects ONLY the minimal approved fields over an encrypted
 * DTP 1.0 injection frame.
 */
export function requestMinimalContextFromIfay(
  heapSource:
    | PersonalDataHeap
    | { heap: PersonalDataHeap; heapSessionKey: Uint8Array }
    | { heapDir: string; heapSessionKey: Uint8Array },
  appRequest: ExternalAppContextRequest,
  disclosurePolicy: MinimalDisclosurePolicy,
  options?: { heapSessionKey?: Uint8Array; nowIso?: string },
): MinimalContextInjectionResult {
  let heap: PersonalDataHeap;
  let heapKey: Uint8Array | undefined = options?.heapSessionKey;

  if (heapSource instanceof PersonalDataHeap) {
    heap = heapSource;
  } else if ('heap' in heapSource) {
    heap = heapSource.heap;
    heapKey = heapSource.heapSessionKey;
  } else {
    heap = new PersonalDataHeap(heapSource.heapDir);
    heapKey = heapSource.heapSessionKey;
  }

  if (!heapKey || heapKey.length !== 32) {
    throw new Error('heapSessionKey (32 bytes) is required for iFay to read its Personal Data Heap');
  }

  // Dedicated ephemeral tunnel key between iFay and the external App (never reuses heap master key!)
  const appTunnelKey =
    appRequest.appSessionKey && appRequest.appSessionKey.length === 32
      ? appRequest.appSessionKey
      : new Uint8Array(randomBytes(32));

  const masterTransport = new InMemoryTransportAdapter();
  const appTransport = new InMemoryTransportAdapter();
  InMemoryTransportAdapter.pair(masterTransport, appTransport);

  const ifayMaster = new DTPEngine('master', masterTransport);
  const appSlave = new DTPEngine('slave', appTransport);

  const manifest = heap.getManifest();
  const masterSession = ifayMaster.createSession({
    identity: manifest.owner_fay_id,
    sessionKey: appTunnelKey,
    verified: true,
  });
  const appSession = appSlave.createSession({
    identity: `app:${appRequest.appId}`,
    sessionKey: appTunnelKey,
    verified: true,
  });

  const masterConn = masterTransport.connect({ protocol: 'memory', address: appRequest.appId });
  const appConnId = Array.from(
    (appTransport as unknown as { connections: Map<string, unknown> }).connections.keys(),
  )[0];
  ifayMaster.bindConnection(masterSession.sessionId, masterConn.connectionId);
  appSlave.bindConnection(appSession.sessionId, appConnId);

  // External app (Slave) initiates injection request
  const injectionReq = appSlave.initiateAgreement(appSession.sessionId, {
    direction: 'injection',
    proposedParams: {
      dataType: `minimal_personalization:${appRequest.purpose}`,
      dataRange: appRequest.requestedFields.join(','),
      transferMode: 'one_time',
      frequency: null,
      validityPeriod: disclosurePolicy.validityPeriodMs ?? 300_000,
      priority: 'normal',
    },
  });

  ifayMaster.assertCanDecideInjection();

  // Check purpose policy
  if (
    Array.isArray(disclosurePolicy.allowedPurposes) &&
    !disclosurePolicy.allowedPurposes.includes(appRequest.purpose)
  ) {
    const rejectionReason = `Purpose '${appRequest.purpose}' is not authorized by Human Prime disclosure policy`;
    appSlave.handleAgreementResponse(appSession.sessionId, {
      frameType: 'response',
      requestId: injectionReq.requestId,
      result: 'rejected',
      rejectionReason,
    });
    ifayMaster.closeSession(masterSession.sessionId);
    appSlave.closeSession(appSession.sessionId);
    return {
      approved: false,
      rejectionReason,
      appId: appRequest.appId,
      purpose: appRequest.purpose,
      agreementId: null,
      injectedFields: {},
      withheldFields: [...appRequest.requestedFields],
      strippedProtectedFields: [],
      wireFrame: null,
      decryptedAppView: null,
    };
  }

  const approvedSet = new Set(disclosurePolicy.approvedFields.map((f) => f.toLowerCase()));
  const strippedProtectedFields: string[] = [];
  const withheldFields: string[] = [];
  const permittedLookupKeys: string[] = [];

  for (const reqField of appRequest.requestedFields) {
    const normalized = reqField.toLowerCase();
    if (ALWAYS_STRIPPED_KEYS.has(normalized)) {
      strippedProtectedFields.push(reqField);
      withheldFields.push(reqField);
      continue;
    }
    if (!approvedSet.has(normalized)) {
      withheldFields.push(reqField);
      continue;
    }
    permittedLookupKeys.push(normalized);
  }

  if (permittedLookupKeys.length === 0 && appRequest.requestedFields.length > 0) {
    const rejectionReason =
      'Zero requested fields are permitted under Human Prime minimal disclosure policy';
    appSlave.handleAgreementResponse(appSession.sessionId, {
      frameType: 'response',
      requestId: injectionReq.requestId,
      result: 'rejected',
      rejectionReason,
    });
    ifayMaster.closeSession(masterSession.sessionId);
    appSlave.closeSession(appSession.sessionId);
    return {
      approved: false,
      rejectionReason,
      appId: appRequest.appId,
      purpose: appRequest.purpose,
      agreementId: null,
      injectedFields: {},
      withheldFields,
      strippedProtectedFields,
      wireFrame: null,
      decryptedAppView: null,
    };
  }

  // Aggregate latest structured fields from Personal Data Heap (chronological LWW)
  const records = heap.readDecryptedEntries(heapKey);
  const aggregatedStructured: Record<string, unknown> = {};
  for (const rec of records) {
    for (const [k, v] of Object.entries(rec.payload.structured_fields ?? {})) {
      const normK = k.toLowerCase();
      if (!ALWAYS_STRIPPED_KEYS.has(normK)) {
        aggregatedStructured[normK] = v;
      }
    }
  }

  const injectedFields: Record<string, unknown> = {};
  for (const key of permittedLookupKeys) {
    if (Object.prototype.hasOwnProperty.call(aggregatedStructured, key)) {
      injectedFields[key] = aggregatedStructured[key];
    }
  }

  // Accept minimal injection agreement on iFay Master & App Slave
  const masterDecision = ifayMaster.handleAgreementRequest(
    masterSession.sessionId,
    injectionReq,
  );
  const agreedOnSlave = appSlave.handleAgreementResponse(
    appSession.sessionId,
    masterDecision,
  );
  if (!agreedOnSlave) {
    throw new Error('Failed to finalize minimal injection agreement');
  }
  ifayMaster.transitionState(masterSession.sessionId, 'negotiating');
  ifayMaster.transitionState(masterSession.sessionId, 'transmitting');

  let capturedWireFrame: Uint8Array | null = null;
  appTransport.onReceive((_connId, rawData) => {
    capturedWireFrame = new Uint8Array(rawData);
  });

  let receivedByApp: LogicalFrame | null = null;
  appSlave.onFrameReceived((_sessId, frame) => {
    receivedByApp = frame;
  });

  const disclosedAt = options?.nowIso ?? new Date().toISOString();
  const injectionEnvelope = {
    schema: IFAY_DTP_INJECTION_SCHEMA,
    app_id: appRequest.appId,
    purpose: appRequest.purpose,
    disclosed_at: disclosedAt,
    attributes: injectedFields,
  } as const;

  const plaintextBytes = new Uint8Array(
    Buffer.from(canonicalizeJson(injectionEnvelope), 'utf8'),
  );

  ifayMaster.sendFrame(masterSession.sessionId, {
    header: {
      protocolVersion: { major: 1, minor: 0 },
      frameType: 'data',
      fragmentId: `frag_inj_${randomUUID().slice(0, 8)}`,
      agreementId: agreedOnSlave.agreementId,
      originTimestamp: Date.parse(disclosedAt),
      dagDependencies: [],
      encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
      sequenceNumber: 1,
    },
    payload: plaintextBytes,
  });

  if (!capturedWireFrame || !receivedByApp) {
    throw new Error('Minimal context injection frame failed transport verification');
  }

  const decryptedAppView = JSON.parse(
    Buffer.from((receivedByApp as LogicalFrame).payload).toString('utf8'),
  ) as MinimalContextInjectionResult['decryptedAppView'];

  ifayMaster.closeSession(masterSession.sessionId);
  appSlave.closeSession(appSession.sessionId);

  return {
    approved: true,
    appId: appRequest.appId,
    purpose: appRequest.purpose,
    agreementId: agreedOnSlave.agreementId,
    injectedFields,
    withheldFields,
    strippedProtectedFields,
    wireFrame: capturedWireFrame,
    decryptedAppView,
  };
}
