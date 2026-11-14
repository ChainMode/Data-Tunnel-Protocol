// DTP Engine Implementation
// Core protocol engine integrating all sub-components.
// Implements state machine, role-based permissions, and bidirectional data transfer.
// Requirements: 1.1, 2.1-2.7, 7.3, 10.2-10.4, 12.1-12.4, 13.1, 13.4

import type {
  DTP_Engine,
  Transport_Adapter,
  CAPContext,
  ConnectionID,
  AgreementRequest,
} from '../types/components.js';
import type {
  LogicalFrame,
  SessionID,
  SequenceNumber,
  Agreement,
  Session,
  SessionState,
  TransferDirection,
  RequestFrame,
  ResponseFrame,
} from '../types/index.js';
import type { ErrorNotificationFrame } from '../errors/error-codes.js';
import { DTPFrameCodec } from './frame-codec.js';
import { DTPEncryptionModule } from './encryption-module.js';
import { DTPDAGManager } from './dag-manager.js';
import { DTPAgreementManager } from './agreement-manager.js';
import { DTPSessionManager } from './session-manager.js';
import { DTPResumeManager } from './resume-manager.js';
import { AgreementIdCompressor } from './agreement-id-compressor.js';
import { ContextMetadataValidator } from './context-metadata-validator.js';
import { DTPErrorCode } from '../errors/error-codes.js';
import { ErrorHandler, CURRENT_VERSION } from './error-handler.js';

/** DTP Engine role */
export type DTPRole = 'master' | 'slave' | 'observer';

/** DTP Engine configuration */
export interface DTPEngineConfig {
  maxBufferSize?: number;
  /** Retransmission timeout in milliseconds (default: 5000) */
  retransmissionTimeout?: number;
}

/** Valid state transitions map */
const STATE_TRANSITIONS: Record<SessionState, SessionState[]> = {
  idle: ['waiting_for_cap'],
  waiting_for_cap: ['established', 'idle'],
  established: ['negotiating', 'idle'],
  negotiating: ['transmitting', 'established'],
  transmitting: ['negotiating', 'suspended', 'established', 'transmitting'],
  suspended: ['resuming', 'idle'],
  resuming: ['transmitting', 'idle'],
};

/** Slave response log entry */
export interface SlaveResponseRecord {
  requestId: string;
  sessionId: SessionID;
  result: 'accepted' | 'rejected' | 'counter_proposal';
  rejectionReason?: string;
  timestamp: number;
}

export class DTPEngine implements DTP_Engine {
  readonly role: DTPRole;
  private readonly transport: Transport_Adapter;

  // Sub-components
  readonly frameCodec: DTPFrameCodec;
  readonly encryptionModule: DTPEncryptionModule;
  readonly dagManager: DTPDAGManager;
  readonly agreementManager: DTPAgreementManager;
  readonly sessionManager: DTPSessionManager;
  readonly resumeManager: DTPResumeManager;
  readonly agreementIdCompressor: AgreementIdCompressor;
  readonly contextMetadataValidator: ContextMetadataValidator;

  // Internal state
  private readonly sessionStates = new Map<SessionID, SessionState>();
  private readonly sessionConnections = new Map<SessionID, ConnectionID>();
  private readonly frameHandlers: Array<(sessionId: SessionID, frame: LogicalFrame) => void> = [];
  private capContext: CAPContext | null = null;

  /** Persisted slave response records (master only) */
  readonly slaveResponseLog: SlaveResponseRecord[] = [];

  /** Error notification handlers (upper layer) */
  private readonly errorHandlers: Array<(error: ErrorNotificationFrame) => void> = [];

  /** Whether sending is paused due to buffer full */
  private _sendingPaused = false;

  /** Retransmission timeout in ms */
  private readonly retransmissionTimeout: number;

  /** Active retransmission timer ID (for cleanup) */
  private retransmissionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(role: DTPRole, transport: Transport_Adapter, config?: DTPEngineConfig) {
    this.role = role;
    this.transport = transport;
    this.retransmissionTimeout = config?.retransmissionTimeout ?? 5000;

    // Initialize sub-components
    this.frameCodec = new DTPFrameCodec();
    this.encryptionModule = new DTPEncryptionModule(null); // key set on session creation
    this.dagManager = new DTPDAGManager();
    this.agreementManager = new DTPAgreementManager();
    this.sessionManager = new DTPSessionManager();
    this.resumeManager = new DTPResumeManager(config?.maxBufferSize);
    this.agreementIdCompressor = new AgreementIdCompressor();
    this.contextMetadataValidator = new ContextMetadataValidator();

    // Wire up transport receive handler
    this.transport.onReceive((connectionId: ConnectionID, data: Uint8Array) => {
      this.handleIncomingData(connectionId, data);
    });
  }

  // ─── State Machine ───

  /** Get current state for a session */
  getSessionState(sessionId: SessionID): SessionState {
    const state = this.sessionStates.get(sessionId);
    if (!state) {
      throw Object.assign(
        new Error(`Session not found: ${sessionId}`),
        { code: DTPErrorCode.SESSION_NOT_FOUND },
      );
    }
    return state;
  }

  /** Transition session to a new state, validating the transition is allowed */
  transitionState(sessionId: SessionID, newState: SessionState): void {
    const currentState = this.getSessionState(sessionId);
    const allowed = STATE_TRANSITIONS[currentState];
    if (!allowed || !allowed.includes(newState)) {
      throw new Error(
        `Invalid state transition: ${currentState} → ${newState} (session: ${sessionId})`,
      );
    }
    this.sessionStates.set(sessionId, newState);

    // Also update the session object's state
    const session = this.sessionManager.getSession(sessionId);
    if (session) {
      session.state = newState;
      session.lastActivityAt = Date.now();
    }
  }

  // ─── Role Permission Checks ───

  /** Check if the current role can initiate a collection request (master only) */
  assertCanInitiateCollection(): void {
    if (this.role !== 'master') {
      throw Object.assign(
        new Error(`Role '${this.role}' cannot initiate data collection requests. Only master can.`),
        { code: DTPErrorCode.PERMISSION_DENIED },
      );
    }
  }

  /** Check if the current role can initiate an injection request (slave only) */
  assertCanInitiateInjection(): void {
    if (this.role !== 'slave') {
      throw Object.assign(
        new Error(`Role '${this.role}' cannot initiate data injection requests. Only slave can.`),
        { code: DTPErrorCode.PERMISSION_DENIED },
      );
    }
  }

  /** Check if the current role can decide on injection requests (master only) */
  assertCanDecideInjection(): void {
    if (this.role !== 'master') {
      throw Object.assign(
        new Error(`Role '${this.role}' cannot decide on injection requests. Only master can.`),
        { code: DTPErrorCode.PERMISSION_DENIED },
      );
    }
  }

  /** Check if the current role can write (not observer) */
  assertCanWrite(): void {
    if (this.role === 'observer') {
      throw Object.assign(
        new Error('Observer role cannot send data or modify agreements'),
        { code: DTPErrorCode.OBSERVER_WRITE_DENIED },
      );
    }
  }

  /** Check if the current role can initiate any request (not observer) */
  assertCanInitiateRequest(): void {
    if (this.role === 'observer') {
      throw Object.assign(
        new Error('Observer role cannot initiate requests'),
        { code: DTPErrorCode.OBSERVER_WRITE_DENIED },
      );
    }
  }

  // ─── Session Lifecycle ───

  createSession(capContext: CAPContext): Session {
    if (!capContext.verified) {
      throw Object.assign(
        new Error('CAP verification not completed'),
        { code: DTPErrorCode.KEY_NOT_READY },
      );
    }

    this.capContext = capContext;

    // Re-initialize encryption module with the session key
    (this as any).encryptionModule = new DTPEncryptionModule(
      capContext.sessionKey.length === 32 ? capContext.sessionKey : null,
    );

    const session = this.sessionManager.createSession(capContext);
    this.sessionStates.set(session.sessionId, 'established');
    session.state = 'established';

    return session;
  }

  restoreSession(sessionId: SessionID, capContext: CAPContext): Session {
    if (!capContext.verified) {
      throw Object.assign(
        new Error('CAP verification not completed'),
        { code: DTPErrorCode.KEY_NOT_READY },
      );
    }

    this.capContext = capContext;

    // Re-initialize encryption module with the session key
    (this as any).encryptionModule = new DTPEncryptionModule(
      capContext.sessionKey.length === 32 ? capContext.sessionKey : null,
    );

    const session = this.sessionManager.restoreSession(sessionId);
    if (!session) {
      throw Object.assign(
        new Error(`Cannot restore session: ${sessionId}`),
        { code: DTPErrorCode.SESSION_RESTORE_FAILED },
      );
    }

    this.sessionStates.set(session.sessionId, 'established');
    session.state = 'established';

    return session;
  }

  closeSession(sessionId: SessionID): void {
    // Persist before closing
    try {
      this.sessionManager.persistSession(sessionId);
    } catch {
      // Session may not exist, that's fine
    }
    this.sessionManager.closeSession(sessionId);
    this.sessionStates.delete(sessionId);
  }

  // ─── Agreement Negotiation with Role Checks ───

  /** Initiate an agreement request with role validation */
  initiateAgreement(sessionId: SessionID, request: AgreementRequest): RequestFrame {
    this.assertCanInitiateRequest();

    if (request.direction === 'collection') {
      this.assertCanInitiateCollection();
    } else {
      this.assertCanInitiateInjection();
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw Object.assign(
        new Error(`Session not found: ${sessionId}`),
        { code: DTPErrorCode.SESSION_NOT_FOUND },
      );
    }

    // Transition to negotiating if currently established or transmitting
    const currentState = this.getSessionState(sessionId);
    if (currentState === 'established' || currentState === 'transmitting') {
      this.transitionState(sessionId, 'negotiating');
    }

    return this.agreementManager.initiateRequest(sessionId, request);
  }

  /** Handle an incoming agreement request */
  handleAgreementRequest(sessionId: SessionID, request: RequestFrame): ResponseFrame {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw Object.assign(
        new Error(`Session not found: ${sessionId}`),
        { code: DTPErrorCode.SESSION_NOT_FOUND },
      );
    }

    return this.agreementManager.handleRequest(sessionId, request);
  }

  /** Handle an agreement response, with slave rejection compliance validation and master logging */
  handleAgreementResponse(sessionId: SessionID, response: ResponseFrame): Agreement | null {
    // Validate slave rejection must include compliance reason
    if (response.result === 'rejected') {
      if (!response.rejectionReason || response.rejectionReason.trim().length === 0) {
        throw Object.assign(
          new Error('Slave rejection must include a compliance reason'),
          { code: DTPErrorCode.PERMISSION_DENIED },
        );
      }
    }

    const agreement = this.agreementManager.handleResponse(sessionId, response);

    // Master persists slave response records
    if (this.role === 'master') {
      this.slaveResponseLog.push({
        requestId: response.requestId,
        sessionId,
        result: response.result,
        rejectionReason: response.rejectionReason,
        timestamp: Date.now(),
      });
    }

    // Transition state based on result
    const currentState = this.sessionStates.get(sessionId);
    if (currentState === 'negotiating') {
      if (agreement) {
        // Agreement reached — add to session and transition to transmitting
        const session = this.sessionManager.getSession(sessionId);
        if (session) {
          session.activeAgreements.set(agreement.agreementId, agreement);
        }
        this.transitionState(sessionId, 'transmitting');
      } else {
        // Negotiation failed — back to established
        this.transitionState(sessionId, 'established');
      }
    }

    return agreement;
  }

  getActiveAgreements(sessionId: SessionID): Agreement[] {
    return this.agreementManager.getActiveAgreements(sessionId);
  }

  // ─── Bidirectional Data Transfer ───

  /**
   * Send a frame: encrypt payload → serialize → send via transport.
   * Maintains independent sequence numbers per direction.
   */
  sendFrame(sessionId: SessionID, frame: LogicalFrame): void {
    this.assertCanWrite();

    if (!this.encryptionModule.isKeyReady()) {
      throw Object.assign(
        new Error('Encryption key not ready. CAP must complete before sending.'),
        { code: DTPErrorCode.KEY_NOT_READY },
      );
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw Object.assign(
        new Error(`Session not found: ${sessionId}`),
        { code: DTPErrorCode.SESSION_NOT_FOUND },
      );
    }

    // Check buffer-full condition
    if (this.resumeManager.isBufferFull()) {
      this._sendingPaused = true;
      const bufferFullError = ErrorHandler.createBufferFullError();
      this.emitError(bufferFullError);
      throw Object.assign(
        new Error('Buffer full: sending paused'),
        { code: DTPErrorCode.BUFFER_FULL },
      );
    }

    // Determine direction based on role
    const direction = this.getSendDirection();

    // Assign next sequence number for this direction
    const dirState = direction === 'collection' ? session.collectionState : session.injectionState;
    dirState.currentSequenceNumber += 1;
    const seqNum = dirState.currentSequenceNumber;

    // Build the frame with updated sequence number, preserving originTimestamp
    const outFrame: LogicalFrame = {
      header: {
        ...frame.header,
        sequenceNumber: seqNum,
        encryptionMetadata: this.encryptionModule.getEncryptionMetadata(),
        // Origin_Timestamp is preserved as-is (transmission invariance)
      },
      payload: frame.payload,
    };

    // Encrypt payload
    const encryptedPayload = this.encryptionModule.encryptPayload(
      outFrame.payload,
      outFrame.header.encryptionMetadata,
    );

    const encryptedFrame: LogicalFrame = {
      header: outFrame.header,
      payload: encryptedPayload,
    };

    // Serialize
    const serialized = this.frameCodec.serialize(encryptedFrame);

    // Send via transport — find connection for this session
    const connectionId = this.sessionConnections.get(sessionId);
    if (connectionId) {
      this.transport.send(connectionId, serialized);
    }

    // Update session activity
    session.lastActivityAt = Date.now();
  }

  /**
   * Register a handler for received frames.
   */
  onFrameReceived(handler: (sessionId: SessionID, frame: LogicalFrame) => void): void {
    this.frameHandlers.push(handler);
  }

  /** Associate a connection with a session */
  bindConnection(sessionId: SessionID, connectionId: ConnectionID): void {
    this.sessionConnections.set(sessionId, connectionId);
  }

  // ─── Sequence Number Management ───

  /** Get the current sequence number for a direction in a session */
  getSequenceNumber(sessionId: SessionID, direction: TransferDirection): SequenceNumber {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw Object.assign(
        new Error(`Session not found: ${sessionId}`),
        { code: DTPErrorCode.SESSION_NOT_FOUND },
      );
    }
    const state = direction === 'collection' ? session.collectionState : session.injectionState;
    return state.currentSequenceNumber;
  }

  /** Get the send direction based on role */
  private getSendDirection(): TransferDirection {
    // Slave sends collection data (Terminal → Fay)
    // Master sends injection data (Fay → Terminal)
    return this.role === 'slave' ? 'collection' : 'injection';
  }

  /** Get the receive direction based on role */
  private getReceiveDirection(): TransferDirection {
    return this.role === 'slave' ? 'injection' : 'collection';
  }

  // ─── Internal Transport Handling ───

  /** Register a handler for error notifications (upper layer) */
  onError(handler: (error: ErrorNotificationFrame) => void): void {
    this.errorHandlers.push(handler);
  }

  /** Emit an error notification to all registered error handlers */
  private emitError(error: ErrorNotificationFrame): void {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }

  /** Whether sending is currently paused due to buffer full */
  get sendingPaused(): boolean {
    return this._sendingPaused;
  }

  /**
   * Trigger retransmission of unacknowledged fragments.
   * Called when retransmission timeout fires.
   */
  retransmitUnacknowledged(sessionId: SessionID): void {
    const fragments = this.resumeManager.getUnacknowledgedFragments();
    if (fragments.length === 0) return;

    const connectionId = this.sessionConnections.get(sessionId);
    if (!connectionId) return;

    for (const fragment of fragments) {
      const frame: LogicalFrame = {
        header: {
          protocolVersion: CURRENT_VERSION,
          frameType: 'data',
          fragmentId: fragment.fragmentId,
          agreementId: fragment.agreementId,
          originTimestamp: fragment.originTimestamp,
          dagDependencies: fragment.dagDependencies,
          encryptionMetadata: this.encryptionModule.getEncryptionMetadata(),
          sequenceNumber: 0, // will be re-assigned
        },
        payload: fragment.data,
      };

      try {
        // Encrypt and send
        const encryptedPayload = this.encryptionModule.encryptPayload(
          frame.payload,
          frame.header.encryptionMetadata,
        );
        const encryptedFrame: LogicalFrame = { header: frame.header, payload: encryptedPayload };
        const serialized = this.frameCodec.serialize(encryptedFrame);
        this.transport.send(connectionId, serialized);
      } catch {
        // If retransmission fails, emit timeout error
        this.emitError(ErrorHandler.createRetransmissionTimeoutError(fragment.fragmentId));
      }
    }
  }

  /**
   * Start the retransmission timeout timer for a session.
   * When the timer fires, unacknowledged fragments are retransmitted.
   */
  startRetransmissionTimer(sessionId: SessionID): void {
    this.stopRetransmissionTimer();
    this.retransmissionTimer = setTimeout(() => {
      this.retransmitUnacknowledged(sessionId);
    }, this.retransmissionTimeout);
  }

  /** Stop the retransmission timeout timer */
  stopRetransmissionTimer(): void {
    if (this.retransmissionTimer !== null) {
      clearTimeout(this.retransmissionTimer);
      this.retransmissionTimer = null;
    }
  }

  /** Send an error notification frame to the remote peer via transport */
  private sendErrorNotification(connectionId: ConnectionID, error: ErrorNotificationFrame): void {
    try {
      // Wrap the error notification as a control LogicalFrame
      const errorFrame: LogicalFrame = {
        header: {
          protocolVersion: CURRENT_VERSION,
          frameType: 'control',
          fragmentId: error.relatedFrameId ?? '',
          agreementId: error.relatedAgreementId ?? null,
          originTimestamp: Date.now(),
          dagDependencies: [],
          encryptionMetadata: { algorithm: 'none', keyVersion: 0 },
          sequenceNumber: 0,
        },
        payload: new Uint8Array(Buffer.from(JSON.stringify(error), 'utf-8')),
      };
      const serialized = this.frameCodec.serialize(errorFrame);
      this.transport.send(connectionId, serialized);
    } catch {
      // Best-effort: if we can't send the error notification, just emit locally
    }
  }

  /** Handle incoming binary data from transport */
  private handleIncomingData(_connectionId: ConnectionID, data: Uint8Array): void {
    // Step 1: Attempt deserialization
    let frame: LogicalFrame;
    try {
      frame = this.frameCodec.deserialize(data);
    } catch {
      // Deserialization failed — send error notification to sender
      const error = ErrorHandler.createDeserializationError();
      this.sendErrorNotification(_connectionId, error);
      this.emitError(error);
      return;
    }

    // Step 2: Version compatibility check
    if (!ErrorHandler.isVersionCompatible(frame.header.protocolVersion)) {
      const error = ErrorHandler.createVersionIncompatibleError(CURRENT_VERSION);
      this.sendErrorNotification(_connectionId, error);
      this.emitError(error);
      return;
    }

    // Step 3: Attempt decryption
    if (this.encryptionModule.isKeyReady()) {
      let decryptedPayload: Uint8Array;
      try {
        decryptedPayload = this.encryptionModule.decryptPayload(
          frame.payload,
          frame.header.encryptionMetadata,
        );
      } catch {
        // Decryption failed — send error notification to sender
        const error = ErrorHandler.createDecryptionError(frame.header.fragmentId);
        this.sendErrorNotification(_connectionId, error);
        this.emitError(error);
        return;
      }

      const decryptedFrame: LogicalFrame = {
        header: frame.header,
        payload: decryptedPayload,
      };

      // Update receive-side sequence number
      const direction = this.getReceiveDirection();
      for (const [sessionId, connId] of this.sessionConnections) {
        if (connId === _connectionId) {
          const session = this.sessionManager.getSession(sessionId);
          if (session) {
            const dirState = direction === 'collection'
              ? session.collectionState
              : session.injectionState;
            if (frame.header.sequenceNumber > dirState.currentSequenceNumber) {
              dirState.currentSequenceNumber = frame.header.sequenceNumber;
            }
            session.lastActivityAt = Date.now();

            // Record in resume manager
            this.resumeManager.recordReceived(direction, frame.header.sequenceNumber);
          }

          // Dispatch to handlers — Origin_Timestamp preserved through the entire pipeline
          for (const handler of this.frameHandlers) {
            handler(sessionId, decryptedFrame);
          }
          break;
        }
      }
    }
  }
}
