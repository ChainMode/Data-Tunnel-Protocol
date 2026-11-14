// Negotiation frame type definitions for DTP

import type { AgreementID } from './frame.js';
import type { AgreementParams } from './agreement.js';

/** 协商结果 */
export type NegotiationResult = 'accepted' | 'rejected' | 'counter_proposal';

/** 请求帧 */
export interface RequestFrame {
  frameType: 'request';
  requestId: string;
  requestorRole: 'master' | 'slave';
  requestType: 'collection' | 'injection' | 'adjustment' | 'termination';
  targetAgreementId?: AgreementID;
  proposedParams: AgreementParams;
}

/** 响应帧 */
export interface ResponseFrame {
  frameType: 'response';
  requestId: string;
  result: NegotiationResult;
  agreedParams?: AgreementParams;
  agreementId?: AgreementID;
  rejectionReason?: string;
}
