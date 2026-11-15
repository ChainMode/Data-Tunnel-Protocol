// DTP Components
// Exports all protocol components (FrameCodec, DAGManager, TcpTransportAdapter, etc.).

export { DTPFrameCodec, canonicalizeJson } from './frame-codec.js';
export { DTPEncryptionModule } from './encryption-module.js';
export { DTPDAGManager } from './dag-manager.js';
export { DTPAgreementManager } from './agreement-manager.js';
export type { AgreementValidationResult } from './agreement-manager.js';
export { AgreementIdCompressor } from './agreement-id-compressor.js';
export { ContextMetadataValidator } from './context-metadata-validator.js';
export type { ValidationResult } from './context-metadata-validator.js';
export {
  DTPSessionManager,
  InMemorySessionStore,
  EncryptedFileSessionStore,
  isCanonicalFayId,
} from './session-manager.js';
export type { SessionStore } from './session-manager.js';
export { DTPResumeManager } from './resume-manager.js';
export type { RetryDecision } from './resume-manager.js';
export { InMemoryTransportAdapter } from './transport-adapter.js';
export { TcpTransportAdapter } from './tcp-transport-adapter.js';
export { DTPEngine } from './dtp-engine.js';
export type { DTPRole, DTPEngineConfig, SlaveResponseRecord } from './dtp-engine.js';
export {
  ErrorHandler,
  CURRENT_VERSION,
  MIN_SUPPORTED_MAJOR,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_DELAY_MS,
} from './error-handler.js';
