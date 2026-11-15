// DTP Engine Implementation
// Core protocol engine integrating all sub-components.
// Implements state machine, role-based permissions, bidirectional data transfer,
// agreement validation/expiration (3001/3002), and bounded retry with backoff (OQ-DTP-11).

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
import type { SessionStore } from './session-manager.js';
import { DTPResumeManager } from './resume-manager.js';
import { AgreementIdCompressor } from './agreement-id-compressor.js';
import { ContextMetadataValidator } from './context-metadata-validator.js';
import { DTPErrorCode } from '../errors/error-codes.js';
import {
  ErrorHandler,
  CURRENT_VERSION,
  DEFAULT_MAX_RETRIES,
} from './error-handler.js';

/** DTP Engine role */
export type DTPRole = 'master' | 'slave' | 'observer';

/** DTP Engine configuration */
export interface DTPEngineConfig {
  maxBufferSize?: number;
  /** Base retransmission timeout in milliseconds (default: 5000) */
  retransmissionTimeout?: number;
  /** Maximum retransmission attempts before terminal failure (default: 3, OQ-DTP-11) */
  maxRetries?: number;
  /** Optional pluggable session store (e.g. EncryptedFileSessionStore per OQ-DTP-10) */
  sessionStore?: SessionStore;
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

  /** Base retransmission timeout in ms */
  private readonly retransmissionTimeout: number;

  /** Maximum retransmission attempts (OQ-DTP-11) */
  private readonly maxRetries: number;

  /** Active retransmission timer ID (for cleanup) */
  private retransmissionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(role: DTPRole, transport: Transport_Adapter, config?: DTPEngineConfig) {
    this.role = role;
    this.transport = transport;
    this.retransmissionTimeout = config?.retransmissionTimeout ?? 5000;
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;

    // Initialize sub-components
    this.frameCodec = new DTPFrameCodec();
    this.encryptionModule = new DTPEncryptionModule(null); // key set on session creation
    this.dagManager = new DTPDAGManager();
    this.agreementManager = new DTPAgreementManager();
    this.sessionManager = new DTPSessionManager(config?.sessionStore);
    this.resumeManager = new DTPResumeManager(
      config?.maxBufferSize,
      this.maxRetries,
      this.retransmissionTimeout,
    );
    this.agreementIdCompressor = new AgreementIdCompressor();
    this.contextMetadataValidator = new ContextMetadataValidator();

    // Wire up transport receive & connection state handlers
    this.transport.onReceive((connectionId: ConnectionID, data: Uint8Array) => {
      this.handleIncomingData(connectionId, data);
    });
    this.transport.onConnectionStateChange((connectionId: ConnectionID, state) => {
      if (state === 'disconnected') {
        for (const [sessionId, boundConnId] of this.sessionConnections.entries()) {
          if (boundConnId === connectionId && this.sessionStates.get(sessionId) === 'transmitting') {
            this.transitionState(sessionId, 'suspended');
          }
        }
      }
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
    (this as { encryptionModule: DTPEncryptionModule }).encryptionModule = new DTPEncryptionModule(
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
    (this as { encryptionModule: DTPEncryptionModule }).encryptionModule = new DTPEncryptionModule(
      capContext.sessionKey.length === 32 ? capContext.sessionKey : null,
    );

    const session = this.sessionManager.restoreSession(sessionId);
    if (!session) {
      throw Object.assign(
        new Error(`Cannot restore session: ${sessionId}`),
        { code: DTPErrorCode.SESSION_RESTORE_FAILED },
      );
    }

    // Re-register active agreements in agreementManager upon restore
    for (const [agrId, agr] of session.activeAgreements.entries()) {
      if (!this.agreementManager.getAgreement(agrId)) {
        (this.agreementManager as unknown as { agreements: Map<string, Agreement> }).agreements.set(
          agrId,
          { ...agr, params: { ...agr.params } },
        );
      }
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

  /**
   * Check idle timeout on a session; if timed out, purge session resources and emit SESSION_TIMEOUT (5002).
   */
  enforceSessionTimeout(sessionId: SessionID, now: number = Date.now()): boolean {
    if (!this.sessionManager.getSession(sessionId)) {
      return true;
    }
    if (this.sessionManager.checkTimeout(sessionId, now)) {
      this.stopRetransmissionTimer();
      this.sessionManager.purgeSession(sessionId);
      this.sessionStates.delete(sessionId);
      this.sessionConnections.delete(sessionId);
      this.emitError({
        frameType: 'control',
        controlType: 'error_notification',
        errorCode: DTPErrorCode.SESSION_TIMEOUT,
        errorMessage: `Session timed out: ${sessionId}`,
      });
      return true;
    }
    return false;
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

    const resp = this.agreementManager.handleRequest(sessionId, request);
    if (resp.result === 'accepted' && resp.agreementId) {
      const agr = this.agreementManager.getAgreement(resp.agreementId);
      if (agr) {
        session.activeAgreements.set(agr.agreementId, agr);
      }
    }
    return resp;
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
        const session = this.sessionManager.getSession(sessionId);
        if (session) {
          session.activeAgreements.set(agreement.agreementId, agreement);
        }
        this.transitionState(sessionId, 'transmitting');
      } else {
        this.transitionState(sessionId, 'established');
      }
    } else if (agreement) {
      const session = this.sessionManager.getSession(sessionId);
      if (session) {
        session.activeAgreements.set(agreement.agreementId, agreement);
      }
    }

    return agreement;
  }

  getActiveAgreements(sessionId: SessionID): Agreement[] {
    return this.agreementManager.getActiveAgreements(sessionId);
  }

  // ─── Bidirectional Data Transfer ───

  /**
   * Send a frame: check agreement expiration -> encrypt payload -> serialize (JCS) -> send via transport.
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

    // If the agreement is tracked locally and expired, reject with AGREEMENT_EXPIRED (3002)
    if (frame.header.agreementId && this.agreementManager.getAgreement(frame.header.agreementId)) {
      if (this.agreementManager.isAgreementExpired(frame.header.agreementId)) {
        const expErr = ErrorHandler.createAgreementExpiredError(
          frame.header.agreementId,
          frame.header.fragmentId,
        );
        this.emitError(expErr);
        throw Object.assign(
          new Error(`Agreement expired: ${frame.header.agreementId}`),
          { code: DTPErrorCode.AGREEMENT_EXPIRED },
        );
      }
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
   * Trigger bounded retransmission of unacknowledged fragments (OQ-DTP-11).
   * Once a fragment's retry count reaches maxRetries, emits terminal RETRANSMISSION_TIMEOUT (6002)
   * and evicts it instead of retrying infinitely.
   */
  retransmitUnacknowledged(sessionId: SessionID): void {
    const entries = this.resumeManager.getUnacknowledgedEntries();
    if (entries.length === 0) return;

    const connectionId = this.sessionConnections.get(sessionId);
    if (!connectionId) return;

    for (const [seqNum, fragment] of entries) {
      const decision = this.resumeManager.recordRetryAttempt(seqNum);
      if (!decision.allowed) {
        this.resumeManager.evictFragment(seqNum);
        this.emitError(
          ErrorHandler.createRetransmissionExhaustedError(
            fragment.fragmentId,
            decision.attempt,
            this.maxRetries,
          ),
        );
        continue;
      }

      const frame: LogicalFrame = {
        header: {
          protocolVersion: CURRENT_VERSION,
          frameType: 'data',
          fragmentId: fragment.fragmentId,
          agreementId: fragment.agreementId,
          originTimestamp: fragment.originTimestamp,
          dagDependencies: fragment.dagDependencies,
          encryptionMetadata: this.encryptionModule.getEncryptionMetadata(),
          sequenceNumber: seqNum,
        },
        payload: fragment.data,
      };

      try {
        const encryptedPayload = this.encryptionModule.encryptPayload(
          frame.payload,
          frame.header.encryptionMetadata,
        );
        const encryptedFrame: LogicalFrame = { header: frame.header, payload: encryptedPayload };
        const serialized = this.frameCodec.serialize(encryptedFrame);
        this.transport.send(connectionId, serialized);
      } catch {
        this.emitError(ErrorHandler.createRetransmissionTimeoutError(fragment.fragmentId));
      }
    }
  }

  /**
   * Start bounded exponential-backoff retransmission timer for a session (OQ-DTP-11).
   * Delay for attempt k is baseDelayMs * 2^k, stopping automatically once cache clears or maxRetries is reached.
   */
  startRetransmissionTimer(sessionId: SessionID, attempt: number = 0): void {
    this.stopRetransmissionTimer();
    const delayMs = ErrorHandler.computeBackoffDelay(attempt, this.retransmissionTimeout);
    this.retransmissionTimer = setTimeout(() => {
      this.retransmitUnacknowledged(sessionId);
      if (this.resumeManager.getUnacknowledgedFragments().length > 0 && attempt <= this.maxRetries) {
        this.startRetransmissionTimer(sessionId, attempt + 1);
      } else {
        this.retransmissionTimer = null;
      }
    }, delayMs);
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
      const error = ErrorHandler.createDeserializationError();
      this.sendErrorNotification(_connectionId, error);
      this.emitError(error);
      return;
    }

    // Step 2: Version compatibility check (OQ-DTP-2: same MAJOR only)
    if (!ErrorHandler.isVersionCompatible(frame.header.protocolVersion)) {
      const error = ErrorHandler.createVersionIncompatibleError(CURRENT_VERSION);
      this.sendErrorNotification(_connectionId, error);
      this.emitError(error);
      return;
    }

    // Handle incoming cleartext control error notifications without decryption ping-pong
    if (
      frame.header.frameType === 'control' &&
      frame.header.encryptionMetadata.algorithm === 'none'
    ) {
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
        const error = ErrorHandler.createDecryptionError(frame.header.fragmentId);
        this.sendErrorNotification(_connectionId, error);
        this.emitError(error);
        return;
      }

      let decryptedFrame: LogicalFrame = {
        header: frame.header,
        payload: decryptedPayload,
      };

      const direction = this.getReceiveDirection();
      for (const [sessionId, connId] of this.sessionConnections) {
        if (connId === _connectionId) {
          // Step 4: Agreement decompression & validation for data frames (3001 / 3002)
          if (decryptedFrame.header.frameType === 'data') {
            try {
              decryptedFrame = this.agreementIdCompressor.decompressFrame(decryptedFrame);
            } catch {
              const err = ErrorHandler.createAgreementNotFoundError(
                undefined,
                decryptedFrame.header.fragmentId,
              );
              this.sendErrorNotification(_connectionId, err);
              this.emitError(err);
              return;
            }

            const agreementId = decryptedFrame.header.agreementId!;
            const validation = this.agreementManager.validateAgreement(agreementId);
            if (!validation.valid) {
              const err =
                validation.errorCode === DTPErrorCode.AGREEMENT_EXPIRED
                  ? ErrorHandler.createAgreementExpiredError(
                      agreementId,
                      decryptedFrame.header.fragmentId,
                    )
                  : ErrorHandler.createAgreementNotFoundError(
                      agreementId,
                      decryptedFrame.header.fragmentId,
                    );
              this.sendErrorNotification(_connectionId, err);
              this.emitError(err);
              return;
            }
          }

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
