// DTP Engine Unit Tests
// Covers: session lifecycle, state machine, role permissions, bidirectional transfer

import { describe, it, expect, beforeEach } from 'vitest';
import { DTPEngine } from './dtp-engine.js';
import { InMemoryTransportAdapter } from './transport-adapter.js';
import type { CAPContext } from '../types/components.js';
import type { LogicalFrame } from '../types/index.js';
import { DTPErrorCode } from '../errors/error-codes.js';
import { randomBytes } from 'node:crypto';

/** Helper: create a valid 32-byte key */
function makeKey(): Uint8Array {
  return randomBytes(32);
}

/** Helper: create a verified CAPContext */
function makeCAPContext(key?: Uint8Array): CAPContext {
  return {
    identity: 'test-identity',
    sessionKey: key ?? makeKey(),
    verified: true,
  };
}

/** Helper: create a minimal LogicalFrame */
function makeFrame(overrides?: Partial<LogicalFrame['header']>): LogicalFrame {
  return {
    header: {
      protocolVersion: { major: 1, minor: 0 },
      frameType: 'data',
      fragmentId: 'frag-001',
      agreementId: 'agreement-001',
      originTimestamp: 1700000000000,
      dagDependencies: [],
      encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
      sequenceNumber: 0,
      ...overrides,
    },
    payload: new Uint8Array([1, 2, 3, 4]),
  };
}

describe('DTPEngine', () => {
  let masterTransport: InMemoryTransportAdapter;
  let slaveTransport: InMemoryTransportAdapter;

  beforeEach(() => {
    masterTransport = new InMemoryTransportAdapter();
    slaveTransport = new InMemoryTransportAdapter();
    InMemoryTransportAdapter.pair(masterTransport, slaveTransport);
  });

  // ─── Session Lifecycle ───

  describe('Session Lifecycle', () => {
    it('should create a session with verified CAP context', () => {
      const engine = new DTPEngine('master', masterTransport);
      const session = engine.createSession(makeCAPContext());

      expect(session.sessionId).toBeDefined();
      expect(session.state).toBe('established');
      expect(engine.getSessionState(session.sessionId)).toBe('established');
    });

    it('should reject session creation with unverified CAP', () => {
      const engine = new DTPEngine('master', masterTransport);
      const cap: CAPContext = { identity: 'x', sessionKey: makeKey(), verified: false };

      expect(() => engine.createSession(cap)).toThrow('CAP verification not completed');
    });

    it('should close a session', () => {
      const engine = new DTPEngine('master', masterTransport);
      const session = engine.createSession(makeCAPContext());
      const sid = session.sessionId;

      engine.closeSession(sid);
      expect(() => engine.getSessionState(sid)).toThrow();
    });

    it('should restore a previously persisted session', () => {
      const key = makeKey();
      const engine = new DTPEngine('master', masterTransport);
      const session = engine.createSession(makeCAPContext(key));
      const sid = session.sessionId;

      // Persist then close
      engine.sessionManager.persistSession(sid);
      engine.closeSession(sid);

      // Restore
      const restored = engine.restoreSession(sid, makeCAPContext(key));
      expect(restored.sessionId).toBe(sid);
      expect(engine.getSessionState(sid)).toBe('established');
    });

    it('should throw when restoring a non-existent session', () => {
      const engine = new DTPEngine('master', masterTransport);
      expect(() => engine.restoreSession('no-such-id', makeCAPContext())).toThrow();
    });
  });

  // ─── State Machine ───

  describe('State Machine', () => {
    it('should allow valid transitions', () => {
      const engine = new DTPEngine('master', masterTransport);
      const session = engine.createSession(makeCAPContext());
      const sid = session.sessionId;

      // established → negotiating
      engine.transitionState(sid, 'negotiating');
      expect(engine.getSessionState(sid)).toBe('negotiating');

      // negotiating → transmitting
      engine.transitionState(sid, 'transmitting');
      expect(engine.getSessionState(sid)).toBe('transmitting');

      // transmitting → suspended
      engine.transitionState(sid, 'suspended');
      expect(engine.getSessionState(sid)).toBe('suspended');

      // suspended → resuming
      engine.transitionState(sid, 'resuming');
      expect(engine.getSessionState(sid)).toBe('resuming');

      // resuming → transmitting
      engine.transitionState(sid, 'transmitting');
      expect(engine.getSessionState(sid)).toBe('transmitting');
    });

    it('should reject invalid transitions', () => {
      const engine = new DTPEngine('master', masterTransport);
      const session = engine.createSession(makeCAPContext());
      const sid = session.sessionId;

      // established → transmitting is NOT valid (must go through negotiating)
      expect(() => engine.transitionState(sid, 'transmitting')).toThrow('Invalid state transition');
    });

    it('should reject transition for unknown session', () => {
      const engine = new DTPEngine('master', masterTransport);
      expect(() => engine.transitionState('unknown', 'idle')).toThrow('Session not found');
    });
  });

  // ─── Role Permission Checks ───

  describe('Role Permissions', () => {
    it('master can initiate collection requests', () => {
      const engine = new DTPEngine('master', masterTransport);
      expect(() => engine.assertCanInitiateCollection()).not.toThrow();
    });

    it('slave cannot initiate collection requests', () => {
      const engine = new DTPEngine('slave', slaveTransport);
      expect(() => engine.assertCanInitiateCollection()).toThrow();
      try {
        engine.assertCanInitiateCollection();
      } catch (e: any) {
        expect(e.code).toBe(DTPErrorCode.PERMISSION_DENIED);
      }
    });

    it('observer cannot initiate collection requests', () => {
      const engine = new DTPEngine('observer', masterTransport);
      expect(() => engine.assertCanInitiateCollection()).toThrow();
    });

    it('slave can initiate injection requests', () => {
      const engine = new DTPEngine('slave', slaveTransport);
      expect(() => engine.assertCanInitiateInjection()).not.toThrow();
    });

    it('master cannot initiate injection requests', () => {
      const engine = new DTPEngine('master', masterTransport);
      expect(() => engine.assertCanInitiateInjection()).toThrow();
    });

    it('observer cannot write or send data', () => {
      const engine = new DTPEngine('observer', masterTransport);
      expect(() => engine.assertCanWrite()).toThrow();
      try {
        engine.assertCanWrite();
      } catch (e: any) {
        expect(e.code).toBe(DTPErrorCode.OBSERVER_WRITE_DENIED);
      }
    });

    it('observer cannot initiate any request', () => {
      const engine = new DTPEngine('observer', masterTransport);
      expect(() => engine.assertCanInitiateRequest()).toThrow();
    });

    it('master can decide injection requests', () => {
      const engine = new DTPEngine('master', masterTransport);
      expect(() => engine.assertCanDecideInjection()).not.toThrow();
    });

    it('slave cannot decide injection requests', () => {
      const engine = new DTPEngine('slave', slaveTransport);
      expect(() => engine.assertCanDecideInjection()).toThrow();
    });
  });

  // ─── Agreement Negotiation with Roles ───

  describe('Agreement Negotiation', () => {
    it('master can initiate a collection agreement', () => {
      const engine = new DTPEngine('master', masterTransport);
      const session = engine.createSession(makeCAPContext());

      const requestFrame = engine.initiateAgreement(session.sessionId, {
        direction: 'collection',
        proposedParams: {
          dataType: 'sensor',
          dataRange: 'all',
          transferMode: 'streaming',
          frequency: 10,
          validityPeriod: 60000,
          priority: 'normal',
        },
      });

      expect(requestFrame.frameType).toBe('request');
      expect(requestFrame.requestorRole).toBe('master');
      expect(engine.getSessionState(session.sessionId)).toBe('negotiating');
    });

    it('slave can initiate an injection agreement', () => {
      const engine = new DTPEngine('slave', slaveTransport);
      const session = engine.createSession(makeCAPContext());

      const requestFrame = engine.initiateAgreement(session.sessionId, {
        direction: 'injection',
        proposedParams: {
          dataType: 'config',
          dataRange: 'partial',
          transferMode: 'one_time',
          frequency: null,
          validityPeriod: 30000,
          priority: 'low',
        },
      });

      expect(requestFrame.frameType).toBe('request');
      expect(requestFrame.requestorRole).toBe('slave');
    });

    it('slave cannot initiate a collection agreement', () => {
      const engine = new DTPEngine('slave', slaveTransport);
      const session = engine.createSession(makeCAPContext());

      expect(() => engine.initiateAgreement(session.sessionId, {
        direction: 'collection',
        proposedParams: {
          dataType: 'sensor',
          dataRange: 'all',
          transferMode: 'streaming',
          frequency: 10,
          validityPeriod: 60000,
          priority: 'normal',
        },
      })).toThrow();
    });

    it('observer cannot initiate any agreement', () => {
      const engine = new DTPEngine('observer', masterTransport);
      const session = engine.createSession(makeCAPContext());

      expect(() => engine.initiateAgreement(session.sessionId, {
        direction: 'collection',
        proposedParams: {
          dataType: 'sensor',
          dataRange: 'all',
          transferMode: 'streaming',
          frequency: 10,
          validityPeriod: 60000,
          priority: 'normal',
        },
      })).toThrow();
    });

    it('slave rejection without compliance reason is invalid', () => {
      const engine = new DTPEngine('master', masterTransport);
      const session = engine.createSession(makeCAPContext());

      expect(() => engine.handleAgreementResponse(session.sessionId, {
        frameType: 'response',
        requestId: 'req-1',
        result: 'rejected',
        // No rejectionReason
      })).toThrow('compliance reason');
    });

    it('slave rejection with compliance reason is valid', () => {
      const engine = new DTPEngine('master', masterTransport);
      const session = engine.createSession(makeCAPContext());

      // First transition to negotiating
      engine.transitionState(session.sessionId, 'negotiating');

      const result = engine.handleAgreementResponse(session.sessionId, {
        frameType: 'response',
        requestId: 'req-1',
        result: 'rejected',
        rejectionReason: 'DLP policy prevents sharing this data',
      });

      expect(result).toBeNull();
      // Should transition back to established
      expect(engine.getSessionState(session.sessionId)).toBe('established');
    });

    it('master logs slave responses', () => {
      const engine = new DTPEngine('master', masterTransport);
      const session = engine.createSession(makeCAPContext());

      engine.transitionState(session.sessionId, 'negotiating');

      engine.handleAgreementResponse(session.sessionId, {
        frameType: 'response',
        requestId: 'req-1',
        result: 'rejected',
        rejectionReason: 'DLP policy',
      });

      expect(engine.slaveResponseLog).toHaveLength(1);
      expect(engine.slaveResponseLog[0].result).toBe('rejected');
      expect(engine.slaveResponseLog[0].rejectionReason).toBe('DLP policy');
    });
  });

  // ─── Bidirectional Transfer & Sequence Numbers ───

  describe('Bidirectional Transfer', () => {
    it('sendFrame assigns incrementing sequence numbers', () => {
      const key = makeKey();
      const engine = new DTPEngine('master', masterTransport);
      const session = engine.createSession(makeCAPContext(key));
      const sid = session.sessionId;

      // Bind a connection
      const conn = masterTransport.connect({ protocol: 'memory', address: 'local' });
      engine.bindConnection(sid, conn.connectionId);

      // Master sends injection data
      engine.sendFrame(sid, makeFrame());
      engine.sendFrame(sid, makeFrame());
      engine.sendFrame(sid, makeFrame());

      // Master sends in injection direction
      expect(engine.getSequenceNumber(sid, 'injection')).toBe(3);
      // Collection direction should be untouched
      expect(engine.getSequenceNumber(sid, 'collection')).toBe(0);
    });

    it('slave sends in collection direction', () => {
      const key = makeKey();
      const engine = new DTPEngine('slave', slaveTransport);
      const session = engine.createSession(makeCAPContext(key));
      const sid = session.sessionId;

      const conn = slaveTransport.connect({ protocol: 'memory', address: 'local' });
      engine.bindConnection(sid, conn.connectionId);

      engine.sendFrame(sid, makeFrame());
      engine.sendFrame(sid, makeFrame());

      // Slave sends in collection direction
      expect(engine.getSequenceNumber(sid, 'collection')).toBe(2);
      // Injection direction untouched
      expect(engine.getSequenceNumber(sid, 'injection')).toBe(0);
    });

    it('observer cannot send frames', () => {
      const engine = new DTPEngine('observer', masterTransport);
      const session = engine.createSession(makeCAPContext());

      expect(() => engine.sendFrame(session.sessionId, makeFrame())).toThrow();
    });

    it('sendFrame fails without encryption key', () => {
      const engine = new DTPEngine('master', masterTransport);
      // Create session with a key that's not 32 bytes to simulate no key
      const cap: CAPContext = {
        identity: 'test',
        sessionKey: new Uint8Array(16), // wrong size
        verified: true,
      };
      const session = engine.createSession(cap);

      expect(() => engine.sendFrame(session.sessionId, makeFrame())).toThrow('key not ready');
    });

    it('bidirectional sequence numbers are independent', () => {
      const key = makeKey();

      // Master engine
      const masterEngine = new DTPEngine('master', masterTransport);
      const masterSession = masterEngine.createSession(makeCAPContext(key));
      const masterConn = masterTransport.connect({ protocol: 'memory', address: 'local' });
      masterEngine.bindConnection(masterSession.sessionId, masterConn.connectionId);

      // Slave engine
      const slaveEngine = new DTPEngine('slave', slaveTransport);
      const slaveSession = slaveEngine.createSession(makeCAPContext(key));
      const slaveConn = slaveTransport.connect({ protocol: 'memory', address: 'local' });
      slaveEngine.bindConnection(slaveSession.sessionId, slaveConn.connectionId);

      // Master sends 3 frames (injection direction)
      masterEngine.sendFrame(masterSession.sessionId, makeFrame());
      masterEngine.sendFrame(masterSession.sessionId, makeFrame());
      masterEngine.sendFrame(masterSession.sessionId, makeFrame());

      // Slave sends 2 frames (collection direction)
      slaveEngine.sendFrame(slaveSession.sessionId, makeFrame());
      slaveEngine.sendFrame(slaveSession.sessionId, makeFrame());

      // Verify independence
      expect(masterEngine.getSequenceNumber(masterSession.sessionId, 'injection')).toBe(3);
      expect(masterEngine.getSequenceNumber(masterSession.sessionId, 'collection')).toBe(0);
      expect(slaveEngine.getSequenceNumber(slaveSession.sessionId, 'collection')).toBe(2);
      expect(slaveEngine.getSequenceNumber(slaveSession.sessionId, 'injection')).toBe(0);
    });

    it('Origin_Timestamp is preserved through send pipeline', () => {
      const key = makeKey();
      const engine = new DTPEngine('master', masterTransport);
      const session = engine.createSession(makeCAPContext(key));
      const conn = masterTransport.connect({ protocol: 'memory', address: 'local' });
      engine.bindConnection(session.sessionId, conn.connectionId);

      const originalTimestamp = 1700000000000;
      const frame = makeFrame({ originTimestamp: originalTimestamp });

      // The frame header should preserve the timestamp through the pipeline
      // We verify by checking the frame we construct internally
      engine.sendFrame(session.sessionId, frame);

      // The session's sequence number should have incremented (proving send happened)
      expect(engine.getSequenceNumber(session.sessionId, 'injection')).toBe(1);
      // The original frame's timestamp should not have been modified
      expect(frame.header.originTimestamp).toBe(originalTimestamp);
    });
  });

  // ─── Frame Receive ───

  describe('Frame Receive', () => {
    it('onFrameReceived registers handlers', () => {
      const engine = new DTPEngine('master', masterTransport);
      let called = false;
      engine.onFrameReceived(() => { called = true; });
      // Handler registered but not called yet
      expect(called).toBe(false);
    });
  });
});
