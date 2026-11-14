// Frame-related type definitions for DTP

import type { DAGEdge } from './dag.js';
import type { EncryptionMetadata } from './encryption.js';

/** Fragment 唯一标识符 (UUID v4) */
export type FragmentID = string;

/** 约定唯一标识符 (UUID v4) */
export type AgreementID = string;

/** UTC 毫秒时间戳 */
export type OriginTimestamp = number;

/** 单调递增整数 */
export type SequenceNumber = number;

/** 会话唯一标识符 (UUID v4) */
export type SessionID = string;

/** 协议版本号 */
export interface ProtocolVersion {
  major: number;
  minor: number;
}

/** 帧类型 */
export type FrameType = 'data' | 'request' | 'response' | 'control';

/** 帧头 */
export interface FrameHeader {
  protocolVersion: ProtocolVersion;
  frameType: FrameType;
  fragmentId: FragmentID;
  agreementId: AgreementID | null;
  originTimestamp: OriginTimestamp;
  dagDependencies: DAGEdge[];
  encryptionMetadata: EncryptionMetadata;
  sequenceNumber: SequenceNumber;
}

/** 逻辑帧 */
export interface LogicalFrame {
  header: FrameHeader;
  payload: Uint8Array;
}
