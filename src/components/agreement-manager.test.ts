import { describe, it, expect, beforeEach } from 'vitest';
import { DTPAgreementManager } from './agreement-manager.js';
import { DTPErrorCode } from '../errors/error-codes.js';
import type { AgreementRequest } from '../types/components.js';
import type { AgreementParams } from '../types/agreement.js';
import type { RequestFrame, ResponseFrame } from '../types/negotiation.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeParams(overrides: Partial<AgreementParams> = {}): AgreementParams {
  return {
    dataType: 'sensor-data',
    dataRange: 'temperature',
    transferMode: 'streaming',
    frequency: 10,
    validityPeriod: 60000,
    priority: 'normal',
    ...overrides,
  };
}

function makeAgreementRequest(
  direction: 'collection' | 'injection' = 'collection',
  paramOverrides: Partial<AgreementParams> = {},
): AgreementRequest {
  return {
    direction,
    proposedParams: makeParams(paramOverrides),
  };
}

describe('DTPAgreementManager', () => {
  let manager: DTPAgreementManager;
  const sessionId = 'session-001';

  beforeEach(() => {
    manager = new DTPAgreementManager();
  });

  describe('initiateRequest', () => {
    it('creates a RequestFrame for a collection request', () => {
      const frame = manager.initiateRequest(sessionId, makeAgreementRequest('collection'));
      expect(frame.frameType).toBe('request');
      expect(frame.requestType).toBe('collection');
      expect(frame.requestorRole).toBe('master');
      expect(frame.requestId).toMatch(UUID_REGEX);
      expect(frame.proposedParams).toEqual(makeParams());
    });

    it('creates a RequestFrame for an injection request', () => {
      const frame = manager.initiateRequest(sessionId, makeAgreementRequest('injection'));
      expect(frame.frameType).toBe('request');
      expect(frame.requestType).toBe('injection');
      expect(frame.requestorRole).toBe('slave');
    });

    it('generates unique requestIds', () => {
      const f1 = manager.initiateRequest(sessionId, makeAgreementRequest());
      const f2 = manager.initiateRequest(sessionId, makeAgreementRequest());
      expect(f1.requestId).not.toBe(f2.requestId);
    });
  });

  describe('handleRequest', () => {
    it('auto-accepts incoming requests and returns a ResponseFrame', () => {
      const request: RequestFrame = {
        frameType: 'request',
        requestId: 'req-123',
        requestorRole: 'master',
        requestType: 'collection',
        proposedParams: makeParams(),
      };

      const response = manager.handleRequest(sessionId, request);
      expect(response.frameType).toBe('response');
      expect(response.requestId).toBe('req-123');
      expect(response.result).toBe('accepted');
      expect(response.agreedParams).toEqual(makeParams());
      expect(response.agreementId).toMatch(UUID_REGEX);
    });

    it('stores the agreement when accepting a request', () => {
      const request: RequestFrame = {
        frameType: 'request',
        requestId: 'req-456',
        requestorRole: 'slave',
        requestType: 'injection',
        proposedParams: makeParams(),
      };

      const response = manager.handleRequest(sessionId, request);
      const agreement = manager.getAgreement(response.agreementId!);
      expect(agreement).not.toBeNull();
      expect(agreement!.sessionId).toBe(sessionId);
      expect(agreement!.direction).toBe('injection');
      expect(agreement!.initiator).toBe('slave');
      expect(agreement!.status).toBe('active');
    });
  });

  describe('handleResponse', () => {
    it('creates and stores an agreement on accepted response', () => {
      // First initiate a request to track the pending request
      const reqFrame = manager.initiateRequest(sessionId, makeAgreementRequest('collection'));

      const response: ResponseFrame = {
        frameType: 'response',
        requestId: reqFrame.requestId,
        result: 'accepted',
        agreedParams: makeParams(),
        agreementId: 'agreed-001',
      };

      const agreement = manager.handleResponse(sessionId, response);
      expect(agreement).not.toBeNull();
      expect(agreement!.agreementId).toBe('agreed-001');
      expect(agreement!.sessionId).toBe(sessionId);
      expect(agreement!.direction).toBe('collection');
      expect(agreement!.status).toBe('active');
      expect(agreement!.params).toEqual(makeParams());
    });

    it('returns null on rejected response', () => {
      const response: ResponseFrame = {
        frameType: 'response',
        requestId: 'req-789',
        result: 'rejected',
        rejectionReason: 'DLP policy violation',
      };

      const agreement = manager.handleResponse(sessionId, response);
      expect(agreement).toBeNull();
    });

    it('returns null on counter_proposal response', () => {
      const response: ResponseFrame = {
        frameType: 'response',
        requestId: 'req-999',
        result: 'counter_proposal',
        agreedParams: makeParams({ priority: 'high' }),
      };

      const agreement = manager.handleResponse(sessionId, response);
      expect(agreement).toBeNull();
    });

    it('generates an agreementId if response does not include one', () => {
      const reqFrame = manager.initiateRequest(sessionId, makeAgreementRequest());
      const response: ResponseFrame = {
        frameType: 'response',
        requestId: reqFrame.requestId,
        result: 'accepted',
        agreedParams: makeParams(),
        // no agreementId
      };

      const agreement = manager.handleResponse(sessionId, response);
      expect(agreement).not.toBeNull();
      expect(agreement!.agreementId).toMatch(UUID_REGEX);
    });

    it('uses injection direction when initiated as injection', () => {
      const reqFrame = manager.initiateRequest(sessionId, makeAgreementRequest('injection'));
      const response: ResponseFrame = {
        frameType: 'response',
        requestId: reqFrame.requestId,
        result: 'accepted',
        agreedParams: makeParams(),
        agreementId: 'inj-001',
      };

      const agreement = manager.handleResponse(sessionId, response);
      expect(agreement!.direction).toBe('injection');
      expect(agreement!.initiator).toBe('slave');
    });
  });

  describe('getAgreement', () => {
    it('returns null for unknown agreementId', () => {
      expect(manager.getAgreement('nonexistent')).toBeNull();
    });

    it('returns the agreement after it is created', () => {
      const reqFrame = manager.initiateRequest(sessionId, makeAgreementRequest());
      const response: ResponseFrame = {
        frameType: 'response',
        requestId: reqFrame.requestId,
        result: 'accepted',
        agreedParams: makeParams(),
        agreementId: 'agr-100',
      };
      manager.handleResponse(sessionId, response);

      const agreement = manager.getAgreement('agr-100');
      expect(agreement).not.toBeNull();
      expect(agreement!.agreementId).toBe('agr-100');
    });
  });

  describe('adjustAgreement', () => {
    it('creates an adjustment RequestFrame for an existing agreement', () => {
      // Create an agreement first
      const request: RequestFrame = {
        frameType: 'request',
        requestId: 'req-adj',
        requestorRole: 'master',
        requestType: 'collection',
        proposedParams: makeParams(),
      };
      const resp = manager.handleRequest(sessionId, request);
      const agreementId = resp.agreementId!;

      const adjustFrame = manager.adjustAgreement(agreementId, { priority: 'high', frequency: 20 });
      expect(adjustFrame.frameType).toBe('request');
      expect(adjustFrame.requestType).toBe('adjustment');
      expect(adjustFrame.targetAgreementId).toBe(agreementId);
      expect(adjustFrame.proposedParams.priority).toBe('high');
      expect(adjustFrame.proposedParams.frequency).toBe(20);
      // Unchanged fields should be preserved
      expect(adjustFrame.proposedParams.dataType).toBe('sensor-data');
    });

    it('throws when adjusting a nonexistent agreement', () => {
      expect(() => manager.adjustAgreement('no-such-id', { priority: 'high' }))
        .toThrow('Agreement not found: no-such-id');
    });
  });

  describe('terminateAgreement', () => {
    it('terminates an existing agreement and returns a ControlFrame', () => {
      const request: RequestFrame = {
        frameType: 'request',
        requestId: 'req-term',
        requestorRole: 'master',
        requestType: 'collection',
        proposedParams: makeParams(),
      };
      const resp = manager.handleRequest(sessionId, request);
      const agreementId = resp.agreementId!;

      const controlFrame = manager.terminateAgreement(agreementId);
      expect(controlFrame.frameType).toBe('control');
      expect(controlFrame.controlType).toBe('terminate_agreement');
      expect(controlFrame.agreementId).toBe(agreementId);

      // Agreement status should be terminated
      const agreement = manager.getAgreement(agreementId);
      expect(agreement!.status).toBe('terminated');
    });

    it('throws when terminating a nonexistent agreement', () => {
      expect(() => manager.terminateAgreement('no-such-id'))
        .toThrow('Agreement not found: no-such-id');
    });
  });

  describe('getActiveAgreements', () => {
    it('returns empty array when no agreements exist', () => {
      expect(manager.getActiveAgreements(sessionId)).toEqual([]);
    });

    it('returns only active agreements for the given session', () => {
      // Create two agreements in session-001
      const req1: RequestFrame = {
        frameType: 'request',
        requestId: 'req-a1',
        requestorRole: 'master',
        requestType: 'collection',
        proposedParams: makeParams(),
      };
      const req2: RequestFrame = {
        frameType: 'request',
        requestId: 'req-a2',
        requestorRole: 'slave',
        requestType: 'injection',
        proposedParams: makeParams({ dataType: 'location' }),
      };

      manager.handleRequest(sessionId, req1);
      manager.handleRequest(sessionId, req2);

      const active = manager.getActiveAgreements(sessionId);
      expect(active).toHaveLength(2);
    });

    it('excludes terminated agreements', () => {
      const req: RequestFrame = {
        frameType: 'request',
        requestId: 'req-t1',
        requestorRole: 'master',
        requestType: 'collection',
        proposedParams: makeParams(),
      };
      const resp = manager.handleRequest(sessionId, req);
      manager.terminateAgreement(resp.agreementId!);

      expect(manager.getActiveAgreements(sessionId)).toEqual([]);
    });

    it('filters by sessionId', () => {
      const req1: RequestFrame = {
        frameType: 'request',
        requestId: 'req-s1',
        requestorRole: 'master',
        requestType: 'collection',
        proposedParams: makeParams(),
      };
      const req2: RequestFrame = {
        frameType: 'request',
        requestId: 'req-s2',
        requestorRole: 'master',
        requestType: 'collection',
        proposedParams: makeParams(),
      };

      manager.handleRequest('session-A', req1);
      manager.handleRequest('session-B', req2);

      expect(manager.getActiveAgreements('session-A')).toHaveLength(1);
      expect(manager.getActiveAgreements('session-B')).toHaveLength(1);
      expect(manager.getActiveAgreements('session-C')).toHaveLength(0);
    });
  });

  describe('negotiation results', () => {
    it('supports all three negotiation results: accepted, rejected, counter_proposal', () => {
      const reqFrame = manager.initiateRequest(sessionId, makeAgreementRequest());

      // accepted
      const acceptedResp: ResponseFrame = {
        frameType: 'response',
        requestId: reqFrame.requestId,
        result: 'accepted',
        agreedParams: makeParams(),
        agreementId: 'a-1',
      };
      expect(manager.handleResponse(sessionId, acceptedResp)).not.toBeNull();

      // rejected
      const rejectedResp: ResponseFrame = {
        frameType: 'response',
        requestId: 'req-rej',
        result: 'rejected',
        rejectionReason: 'Not allowed',
      };
      expect(manager.handleResponse(sessionId, rejectedResp)).toBeNull();

      // counter_proposal
      const counterResp: ResponseFrame = {
        frameType: 'response',
        requestId: 'req-counter',
        result: 'counter_proposal',
        agreedParams: makeParams({ priority: 'low' }),
      };
      expect(manager.handleResponse(sessionId, counterResp)).toBeNull();
    });
  });

  describe('agreement expiration (AGREEMENT_EXPIRED 3002, OQ-DTP-11)', () => {
    it('detects expired agreements and returns AGREEMENT_EXPIRED (3002)', () => {
      const req: RequestFrame = {
        frameType: 'request',
        requestId: 'req-exp-1',
        requestorRole: 'master',
        requestType: 'collection',
        proposedParams: makeParams({ validityPeriod: 5000 }),
      };
      const resp = manager.handleRequest(sessionId, req);
      const agreementId = resp.agreementId!;
      const agreement = manager.getAgreement(agreementId)!;

      // Within validityPeriod -> valid
      const validRes = manager.validateAgreement(agreementId, agreement.createdAt + 2500);
      expect(validRes.valid).toBe(true);

      // Past validityPeriod -> AGREEMENT_EXPIRED (3002)
      const expiredRes = manager.validateAgreement(agreementId, agreement.createdAt + 5001);
      expect(expiredRes).toEqual({
        valid: false,
        errorCode: DTPErrorCode.AGREEMENT_EXPIRED,
      });

      // Unknown agreement -> AGREEMENT_NOT_FOUND (3001)
      const unknownRes = manager.validateAgreement('00000000-0000-4000-8000-000000000000');
      expect(unknownRes).toEqual({
        valid: false,
        errorCode: DTPErrorCode.AGREEMENT_NOT_FOUND,
      });
    });
  });
});
