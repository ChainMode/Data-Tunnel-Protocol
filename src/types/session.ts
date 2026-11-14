// Session-related type definitions for DTP

import type { SessionID, AgreementID, SequenceNumber } from './frame.js';
import type { Agreement } from './agreement.js';
import type { Fragment } from './fragment.js';

/** 会话状态 */
export type SessionState =
  | 'idle'
  | 'waiting_for_cap'
  | 'established'
  | 'negotiating'
  | 'transmitting'
  | 'suspended'
  | 'resuming';

/** 单方向传输状态 */
export interface DirectionalTransferState {
  currentSequenceNumber: SequenceNumber;
  highestAcknowledgedSequenceNumber: SequenceNumber;
  unacknowledgedFragmentCache: Map<SequenceNumber, Fragment>;
}

/** 会话 */
export interface Session {
  sessionId: SessionID;
  masterIdentity: string;
  slaveIdentity: string;
  state: SessionState;
  activeAgreements: Map<AgreementID, Agreement>;
  collectionState: DirectionalTransferState;
  injectionState: DirectionalTransferState;
  createdAt: number;
  lastActivityAt: number;
  timeoutThreshold: number;
}
