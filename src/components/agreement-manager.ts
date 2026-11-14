// DTP Agreement Manager Implementation
// Manages agreement negotiation, lifecycle, and querying.

import { v4 as uuidv4 } from 'uuid';
import type {
  AgreementManager,
  AgreementRequest,
  ControlFrame,
} from '../types/components.js';
import type { Agreement, AgreementParams } from '../types/agreement.js';
import type { SessionID } from '../types/frame.js';
import type { RequestFrame, ResponseFrame } from '../types/negotiation.js';

export class DTPAgreementManager implements AgreementManager {
  /** All agreements by agreementId */
  private readonly agreements = new Map<string, Agreement>();

  /** Track pending requests: requestId -> { sessionId, direction, requestorRole } */
  private readonly pendingRequests = new Map<string, {
    sessionId: SessionID;
    direction: 'collection' | 'injection';
    requestorRole: 'master' | 'slave';
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
    // Default policy: auto-accept all requests
    const agreementId = uuidv4();

    // Store the agreement immediately for accepted incoming requests
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

    return {
      frameType: 'request',
      requestId: uuidv4(),
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

  getActiveAgreements(sessionId: SessionID): Agreement[] {
    const result: Agreement[] = [];
    for (const agreement of this.agreements.values()) {
      if (agreement.sessionId === sessionId && agreement.status === 'active') {
        result.push(agreement);
      }
    }
    return result;
  }
}
