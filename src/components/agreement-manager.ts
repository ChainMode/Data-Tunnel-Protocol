// DTP Agreement Manager Implementation
// Manages agreement negotiation, lifecycle, expiration (OQ-DTP-11), and querying.

import { v4 as uuidv4 } from 'uuid';
import type {
  AgreementManager,
  AgreementRequest,
  ControlFrame,
} from '../types/components.js';
import type { Agreement, AgreementParams } from '../types/agreement.js';
import type { SessionID } from '../types/frame.js';
import type { RequestFrame, ResponseFrame } from '../types/negotiation.js';
import { DTPErrorCode } from '../errors/error-codes.js';

export type AgreementValidationResult =
  | { valid: true; agreement: Agreement }
  | {
      valid: false;
      errorCode: DTPErrorCode.AGREEMENT_NOT_FOUND | DTPErrorCode.AGREEMENT_EXPIRED;
    };

export class DTPAgreementManager implements AgreementManager {
  /** All agreements by agreementId */
  private readonly agreements = new Map<string, Agreement>();

  /** Agreements that transitioned out of active specifically due to expiration */
  private readonly expiredAgreements = new Set<string>();

  /** Track pending requests: requestId -> { sessionId, direction, requestorRole, targetAgreementId } */
  private readonly pendingRequests = new Map<string, {
    sessionId: SessionID;
    direction: 'collection' | 'injection';
    requestorRole: 'master' | 'slave';
    targetAgreementId?: string;
  }>();

  initiateRequest(sessionId: SessionID, request: AgreementRequest): RequestFrame {
    const requestType = request.direction === 'collection' ? 'collection' : 'injection';
    const requestorRole = requestType === 'collection' ? 'master' : 'slave';
    const requestId = uuidv4();

    // Track the pending request so handleResponse can use the direction
    this.pendingRequests.set(requestId, {
      sessionId,
      direction: request.direction,
      requestorRole,
    });

    return {
      frameType: 'request',
      requestId,
      requestorRole,
      requestType,
      proposedParams: request.proposedParams,
    };
  }

  handleRequest(sessionId: SessionID, request: RequestFrame): ResponseFrame {
    // Handle adjustment of an existing agreement
    if (
      request.requestType === 'adjustment' &&
      request.targetAgreementId &&
      this.agreements.has(request.targetAgreementId)
    ) {
      const existing = this.agreements.get(request.targetAgreementId)!;
      existing.params = { ...request.proposedParams };
      return {
        frameType: 'response',
        requestId: request.requestId,
        result: 'accepted',
        agreedParams: { ...existing.params },
        agreementId: existing.agreementId,
      };
    }

    // Default policy: auto-accept incoming collection/injection requests
    const agreementId = uuidv4();

    const direction: 'collection' | 'injection' =
      request.requestType === 'collection' || request.requestType === 'injection'
        ? request.requestType
        : 'collection';

    const agreement: Agreement = {
      agreementId,
      sessionId,
      direction,
      initiator: request.requestorRole,
      params: { ...request.proposedParams },
      status: 'active',
      createdAt: Date.now(),
    };
    this.agreements.set(agreementId, agreement);

    return {
      frameType: 'response',
      requestId: request.requestId,
      result: 'accepted',
      agreedParams: { ...request.proposedParams },
      agreementId,
    };
  }

  handleResponse(sessionId: SessionID, response: ResponseFrame): Agreement | null {
    // Clean up pending request tracking
    const pending = this.pendingRequests.get(response.requestId);
    this.pendingRequests.delete(response.requestId);

    if (response.result === 'rejected') {
      return null;
    }

    if (response.result === 'counter_proposal') {
      // Counter proposal doesn't create an agreement yet — needs further negotiation
      return null;
    }

    // If updating an existing agreement from an adjustment response
    const targetId = pending?.targetAgreementId ?? response.agreementId;
    if (targetId && this.agreements.has(targetId) && pending?.targetAgreementId) {
      const existing = this.agreements.get(targetId)!;
      if (response.agreedParams) {
        existing.params = { ...response.agreedParams };
      }
      return existing;
    }

    // accepted — create and store the agreement
    const agreementId = response.agreementId ?? uuidv4();
    const params = response.agreedParams!;

    const agreement: Agreement = {
      agreementId,
      sessionId,
      direction: pending?.direction ?? 'collection',
      initiator: pending?.requestorRole ?? 'master',
      params,
      status: 'active',
      createdAt: Date.now(),
    };

    this.agreements.set(agreementId, agreement);
    return agreement;
  }

  getAgreement(agreementId: string): Agreement | null {
    return this.agreements.get(agreementId) ?? null;
  }

  adjustAgreement(agreementId: string, adjustments: Partial<AgreementParams>): RequestFrame {
    const existing = this.agreements.get(agreementId);
    if (!existing) {
      throw new Error(`Agreement not found: ${agreementId}`);
    }

    const requestId = uuidv4();
    this.pendingRequests.set(requestId, {
      sessionId: existing.sessionId,
      direction: existing.direction,
      requestorRole: 'master',
      targetAgreementId: agreementId,
    });

    return {
      frameType: 'request',
      requestId,
      requestorRole: 'master',
      requestType: 'adjustment',
      targetAgreementId: agreementId,
      proposedParams: { ...existing.params, ...adjustments },
    };
  }

  terminateAgreement(agreementId: string): ControlFrame {
    const existing = this.agreements.get(agreementId);
    if (!existing) {
      throw new Error(`Agreement not found: ${agreementId}`);
    }

    existing.status = 'terminated';

    return {
      frameType: 'control',
      controlType: 'terminate_agreement',
      agreementId,
    };
  }

  /**
   * Check whether an agreement has passed its validityPeriod (OQ-DTP-11).
   * If expired, transitions status to 'terminated' and records expiration.
   */
  isAgreementExpired(agreementId: string, now: number = Date.now()): boolean {
    if (this.expiredAgreements.has(agreementId)) {
      return true;
    }
    const agreement = this.agreements.get(agreementId);
    if (!agreement) {
      return false;
    }
    if (now > agreement.createdAt + agreement.params.validityPeriod) {
      agreement.status = 'terminated';
      this.expiredAgreements.add(agreementId);
      return true;
    }
    return false;
  }

  /**
   * Validate an Agreement_ID for incoming or outgoing frame processing:
   * - Unknown or terminated agreement -> AGREEMENT_NOT_FOUND (3001)
   * - Expired agreement -> AGREEMENT_EXPIRED (3002)
   */
  validateAgreement(agreementId: string, now: number = Date.now()): AgreementValidationResult {
    const agreement = this.agreements.get(agreementId);
    if (!agreement) {
      return { valid: false, errorCode: DTPErrorCode.AGREEMENT_NOT_FOUND };
    }
    if (this.isAgreementExpired(agreementId, now)) {
      return { valid: false, errorCode: DTPErrorCode.AGREEMENT_EXPIRED };
    }
    if (agreement.status !== 'active') {
      return { valid: false, errorCode: DTPErrorCode.AGREEMENT_NOT_FOUND };
    }
    return { valid: true, agreement };
  }

  getActiveAgreements(sessionId: SessionID, now: number = Date.now()): Agreement[] {
    const result: Agreement[] = [];
    for (const agreement of this.agreements.values()) {
      if (agreement.sessionId === sessionId) {
        if (this.isAgreementExpired(agreement.agreementId, now)) {
          continue;
        }
        if (agreement.status === 'active') {
          result.push(agreement);
        }
      }
    }
    return result;
  }
}
