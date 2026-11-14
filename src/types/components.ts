// Component interface type definitions for DTP
// These define the contracts for all DTP protocol components.

import type { LogicalFrame, SessionID, FragmentID, SequenceNumber } from './frame.js';
import type { Fragment } from './fragment.js';
import type { DAGEdge } from './dag.js';
import type { EncryptionMetadata } from './encryption.js';
import type { Agreement, AgreementParams, TransferDirection } from './agreement.js';
import type { Session, SessionState } from './session.js';
import type { RequestFrame, ResponseFrame } from './negotiation.js';

// ─── External types referenced by component interfaces ───

/** CAP 上下文（由 CAP 协议提供） */
export interface CAPContext {
  identity: string;
  sessionKey: Uint8Array;
  verified: boolean;
}

/** 传输端点 */
export interface TransportEndpoint {
  protocol: string;
  address: string;
  port?: number;
}

/** 连接标识符 */
export type ConnectionID = string;

/** 连接状态 */
export type ConnectionState = 'connected' | 'disconnected' | 'error';

/** 连接对象 */
export interface Connection {
  connectionId: ConnectionID;
  state: ConnectionState;
}

/** 约定请求（用于发起协商） */
export interface AgreementRequest {
  direction: TransferDirection;
  proposedParams: AgreementParams;
}

/** 控制帧（用于约定终止等控制操作） */
export interface ControlFrame {
  frameType: 'control';
  controlType: string;
  agreementId?: string;
  details?: Record<string, unknown>;
}

/** DAG 验证结果 */
export type DAGValidationResult =
  | { status: 'accepted' }
  | { status: 'pending'; unresolvedDeps: FragmentID[] }
  | { status: 'rejected'; reason: 'cycle_detected' };

/** 依赖解析结果 */
export interface DependencyResolutionResult {
  resolved: boolean;
  resolvedDeps: FragmentID[];
  unresolvedDeps: FragmentID[];
}

/** 续传报告 */
export interface ResumeReport {
  collectionHighest: SequenceNumber;
  injectionHighest: SequenceNumber;
}

// ─── Component Interfaces ───

/** DTP 协议核心处理引擎 */
export interface DTP_Engine {
  createSession(capContext: CAPContext): Session;
  restoreSession(sessionId: SessionID, capContext: CAPContext): Session;
  closeSession(sessionId: SessionID): void;
  sendFrame(sessionId: SessionID, frame: LogicalFrame): void;
  onFrameReceived(handler: (sessionId: SessionID, frame: LogicalFrame) => void): void;
  getSessionState(sessionId: SessionID): SessionState;
  getActiveAgreements(sessionId: SessionID): Agreement[];
}

/** 底层传输协议抽象接口 */
export interface Transport_Adapter {
  connect(endpoint: TransportEndpoint): Connection;
  disconnect(connectionId: ConnectionID): void;
  send(connectionId: ConnectionID, data: Uint8Array): void;
  onReceive(handler: (connectionId: ConnectionID, data: Uint8Array) => void): void;
  onConnectionStateChange(handler: (connectionId: ConnectionID, state: ConnectionState) => void): void;
}

/** 协商管理器 */
export interface AgreementManager {
  initiateRequest(sessionId: SessionID, request: AgreementRequest): RequestFrame;
  handleRequest(sessionId: SessionID, request: RequestFrame): ResponseFrame;
  handleResponse(sessionId: SessionID, response: ResponseFrame): Agreement | null;
  getAgreement(agreementId: string): Agreement | null;
  adjustAgreement(agreementId: string, adjustments: Partial<AgreementParams>): RequestFrame;
  terminateAgreement(agreementId: string): ControlFrame;
  getActiveAgreements(sessionId: SessionID): Agreement[];
}

/** 帧编解码器 */
export interface FrameCodec {
  serialize(frame: LogicalFrame): Uint8Array;
  deserialize(data: Uint8Array): LogicalFrame;
  prettyPrint(frame: LogicalFrame): string;
}

/** DAG 管理器 */
export interface DAGManager {
  addFragment(fragment: Fragment): DAGValidationResult;
  validateAcyclicity(fragmentId: FragmentID, dependencies: DAGEdge[]): boolean;
  resolveDependencies(fragmentId: FragmentID): DependencyResolutionResult;
  getDependencies(fragmentId: FragmentID): DAGEdge[];
  getDependents(fragmentId: FragmentID): FragmentID[];
  getPendingFragments(): Fragment[];
}

/** 加密模块 */
export interface EncryptionModule {
  encryptPayload(payload: Uint8Array, encryptionMeta: EncryptionMetadata): Uint8Array;
  decryptPayload(encryptedPayload: Uint8Array, encryptionMeta: EncryptionMetadata): Uint8Array;
  isKeyReady(): boolean;
  getEncryptionMetadata(): EncryptionMetadata;
}

/** 会话管理器 */
export interface SessionManager {
  createSession(capContext: CAPContext): Session;
  getSession(sessionId: SessionID): Session | null;
  persistSession(sessionId: SessionID): void;
  restoreSession(sessionId: SessionID): Session | null;
  closeSession(sessionId: SessionID): void;
  checkTimeout(sessionId: SessionID): boolean;
}

/** 续传管理器 */
export interface ResumeManager {
  cacheFragment(fragment: Fragment, sequenceNumber: SequenceNumber): void;
  acknowledgeUpTo(sequenceNumber: SequenceNumber): void;
  getUnacknowledgedFragments(): Fragment[];
  isBufferFull(): boolean;
  getHighestReceivedSequenceNumber(direction: TransferDirection): SequenceNumber;
  reportResumePoint(): ResumeReport;
}
