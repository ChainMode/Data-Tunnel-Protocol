// DTP Error Code Definitions
// Defines all error codes, error types, and the error notification frame structure.

import type { FragmentID, AgreementID } from '../types/frame.js';

/** DTP 错误码枚举 */
export enum DTPErrorCode {
  // 帧处理错误 (1xxx)
  FRAME_DESERIALIZATION_FAILED = 1001,
  FRAME_INVALID_FORMAT = 1002,

  // 加密错误 (2xxx)
  DECRYPTION_FAILED = 2001,
  KEY_NOT_READY = 2002,

  // 约定错误 (3xxx)
  AGREEMENT_NOT_FOUND = 3001,
  AGREEMENT_EXPIRED = 3002,
  AGREEMENT_NEGOTIATION_FAILED = 3003,

  // DAG 错误 (4xxx)
  DAG_CYCLE_DETECTED = 4001,
  DAG_DEPENDENCY_UNRESOLVED = 4002,

  // 会话错误 (5xxx)
  SESSION_NOT_FOUND = 5001,
  SESSION_TIMEOUT = 5002,
  SESSION_RESTORE_FAILED = 5003,

  // 续传错误 (6xxx)
  BUFFER_FULL = 6001,
  RETRANSMISSION_TIMEOUT = 6002,

  // 版本错误 (7xxx)
  VERSION_INCOMPATIBLE = 7001,

  // 权限错误 (8xxx)
  PERMISSION_DENIED = 8001,
  OBSERVER_WRITE_DENIED = 8002,
}

/** DTP 错误接口 */
export interface DTPError {
  code: DTPErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** 错误通知帧 */
export interface ErrorNotificationFrame {
  frameType: 'control';
  controlType: 'error_notification';
  errorCode: DTPErrorCode;
  errorMessage: string;
  relatedFrameId?: FragmentID;
  relatedAgreementId?: AgreementID;
  details?: Record<string, unknown>;
}
