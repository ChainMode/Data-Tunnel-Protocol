// Agreement-related type definitions for DTP

import type { AgreementID, SessionID } from './frame.js';

/** 传输模式 */
export type TransferMode = 'one_time' | 'periodic' | 'streaming';

/** 优先级 */
export type Priority = 'low' | 'normal' | 'high' | 'critical';

/** 约定状态 */
export type AgreementStatus = 'negotiating' | 'active' | 'suspended' | 'terminated';

/** 数据流方向 */
export type TransferDirection = 'collection' | 'injection';

/** 约定参数 */
export interface AgreementParams {
  dataType: string;
  dataRange: string;
  transferMode: TransferMode;
  frequency: number | null;
  validityPeriod: number;
  priority: Priority;
}

/** 约定 */
export interface Agreement {
  agreementId: AgreementID;
  sessionId: SessionID;
  direction: TransferDirection;
  initiator: 'master' | 'slave';
  params: AgreementParams;
  status: AgreementStatus;
  createdAt: number;
}
