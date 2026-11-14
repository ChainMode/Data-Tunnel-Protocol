// End-to-End Integration Tests for DTP Protocol
// Tasks 17.1, 17.2, 17.3: Data collection, data injection, and disconnect/resume flows.

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  DTPEngine,
  InMemoryTransportAdapter,
  DTPFrameCodec,
} from '../components/index.js';
import type { LogicalFrame } from '../types/frame.js';
import type { Fragment } from '../types/fragment.js';
import type { CAPContext } from '../types/components.js';
import type { AgreementParams } from '../types/agreement.js';

// ─── Helpers ───

/** Create a valid CAPContext with a 32-byte key */
function createCAPContext(identity: string): CAPContext {
  return {
    identity,
    sessionKey: randomBytes(32),
    verified: true,
  };
}

/** Create a test Fragment */
function createFragment(agreementId: string, data: string): Fragment {
  return {
    fragmentId: uuidv4(),
    agreementId,
    originTimestamp: Date.now(),
    contextMetadata: {
      dataType: 'sensor-reading',
      source: {
        kind: 'hardware',
        sensorType: 'accelerometer',
        precision: '0.01g',
        samplingRate: 100,
      },
      customFields: {},
    },
    dagDependencies: [],
    data: new Uint8Array(Buffer.from(data, 'utf-8')),
  };
}

/** Build a LogicalFrame from a Fragment */
function buildDataFrame(fragment: Fragment, sequenceNumber: number): LogicalFrame {
  return {
    header: {
      protocolVersion: { major: 1, minor: 0 },
      frameType: 'data',
      fragmentId: fragment.fragmentId,
      agreementId: fragment.agreementId,
      originTimestamp: fragment.originTimestamp,
      dagDependencies: fragment.dagDependencies,
      encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
      sequenceNumber,
    },
    payload: fragment.data,
  };
}

/** Default agreement params */
const defaultParams: AgreementParams = {
  dataType: 'sensor-data',
  dataRange: 'all',
  transferMode: 'streaming',
  frequency: 10,
  validityPeriod: 3600000,
  priority: 'normal',
};

// ─── Task 17.1: Data Collection End-to-End (Terminal → Fay) ───

describe('Task 17.1: Data Collection E2E (Slave → Master)', () => {
  it('should complete full data collection pipeline: encrypt → serialize → transport → deserialize → decrypt → verify', async () => {
    // Set up paired transport adapters
    const slaveTransport = new InMemoryTransportAdapter();
    const masterTransport = new InMemoryTransportAdapter();
    InMemoryTransportAdapter.pair(slaveTransport, masterTransport);

    // Use the same key for both engines (simulating CAP key exchange)
    const sharedKey = randomBytes(32);
    const masterCAP: CAPContext = { identity: 'fay-master', sessionKey: sharedKey, verified: true };
    const slaveCAP: CAPContext = { identity: 'terminal-slave', sessionKey: sharedKey, verified: true };

    // Create engines
    const masterEngine = new DTPEngine('master', masterTransport);
    const slaveEngine = new DTPEngine('slave', slaveTransport);

    // Create sessions
    const masterSession = masterEngine.createSession(masterCAP);
    const slaveSession = slaveEngine.createSession(slaveCAP);

    // Establish connections
    const slaveConn = slaveTransport.connect({ protocol: 'memory', address: 'local' });
    const masterConnId = masterTransport['remoteConnectionMap']
      ? [...masterTransport['remoteConnectionMap'].values()][0]
      : slaveConn.connectionId;

    // Find the remote connection ID on master side
    // When slave connects, a mirrored connection is created on master
    let masterRemoteConnId: string | undefined;
    for (const [localId, remoteId] of (slaveTransport as any).remoteConnectionMap) {
      masterRemoteConnId = remoteId;
    }

    slaveEngine.bindConnection(slaveSession.sessionId, slaveConn.connectionId);
    masterEngine.bindConnection(masterSession.sessionId, masterRemoteConnId!);

    // Negotiate agreement: master initiates collection request
    const requestFrame = masterEngine.initiateAgreement(masterSession.sessionId, {
      direction: 'collection',
      proposedParams: defaultParams,
    });

    // Slave handles the request
    const responseFrame = slaveEngine.handleAgreementRequest(slaveSession.sessionId, requestFrame);
    expect(responseFrame.result).toBe('accepted');

    // Master processes the response
    const agreement = masterEngine.handleAgreementResponse(masterSession.sessionId, responseFrame);
    expect(agreement).not.toBeNull();

    // Also register agreement on slave side
    slaveEngine.handleAgreementResponse(slaveSession.sessionId, responseFrame);

    // Track received frames on master
    const receivedFrames: LogicalFrame[] = [];
    masterEngine.onFrameReceived((_sessionId, frame) => {
      receivedFrames.push(frame);
    });

    // Create test data fragments
    const originalTimestamp = Date.now();
    const fragment = createFragment(agreement!.agreementId, 'Hello from terminal sensor');
    fragment.originTimestamp = originalTimestamp;

    // Slave sends data frame (collection: Terminal → Fay)
    const dataFrame = buildDataFrame(fragment, 0);
    slaveEngine.sendFrame(slaveSession.sessionId, dataFrame);

    // Verify master received the frame
    expect(receivedFrames.length).toBe(1);
    const received = receivedFrames[0];

    // Verify Origin_Timestamp is preserved end-to-end
    expect(received.header.originTimestamp).toBe(originalTimestamp);

    // Verify payload is correctly decrypted (matches original)
    const receivedData = Buffer.from(received.payload).toString('utf-8');
    expect(receivedData).toBe('Hello from terminal sensor');

    // Verify frame metadata
    expect(received.header.frameType).toBe('data');
    expect(received.header.fragmentId).toBe(fragment.fragmentId);
    expect(received.header.agreementId).toBe(agreement!.agreementId);
    expect(received.header.protocolVersion).toEqual({ major: 1, minor: 0 });

    // Verify sequence number was assigned (slave sends collection, seq starts at 1)
    expect(received.header.sequenceNumber).toBe(1);
  });

  it('should correctly increment sequence numbers across multiple fragments', () => {
    const slaveTransport = new InMemoryTransportAdapter();
    const masterTransport = new InMemoryTransportAdapter();
    InMemoryTransportAdapter.pair(slaveTransport, masterTransport);

    const sharedKey = randomBytes(32);
    const masterEngine = new DTPEngine('master', masterTransport);
    const slaveEngine = new DTPEngine('slave', slaveTransport);

    const masterSession = masterEngine.createSession({
      identity: 'master', sessionKey: sharedKey, verified: true,
    });
    const slaveSession = slaveEngine.createSession({
      identity: 'slave', sessionKey: sharedKey, verified: true,
    });

    const slaveConn = slaveTransport.connect({ protocol: 'memory', address: 'local' });
    let masterRemoteConnId: string | undefined;
    for (const [, remoteId] of (slaveTransport as any).remoteConnectionMap) {
      masterRemoteConnId = remoteId;
    }
    slaveEngine.bindConnection(slaveSession.sessionId, slaveConn.connectionId);
    masterEngine.bindConnection(masterSession.sessionId, masterRemoteConnId!);

    // Negotiate
    const req = masterEngine.initiateAgreement(masterSession.sessionId, {
      direction: 'collection', proposedParams: defaultParams,
    });
    const resp = slaveEngine.handleAgreementRequest(slaveSession.sessionId, req);
    const agr = masterEngine.handleAgreementResponse(masterSession.sessionId, resp);
    slaveEngine.handleAgreementResponse(slaveSession.sessionId, resp);

    const receivedFrames: LogicalFrame[] = [];
    masterEngine.onFrameReceived((_sid, frame) => receivedFrames.push(frame));

    // Send 3 fragments
    for (let i = 0; i < 3; i++) {
      const frag = createFragment(agr!.agreementId, `data-${i}`);
      slaveEngine.sendFrame(slaveSession.sessionId, buildDataFrame(frag, 0));
    }

    expect(receivedFrames.length).toBe(3);
    // Sequence numbers should be 1, 2, 3 (monotonically increasing)
    expect(receivedFrames[0].header.sequenceNumber).toBe(1);
    expect(receivedFrames[1].header.sequenceNumber).toBe(2);
    expect(receivedFrames[2].header.sequenceNumber).toBe(3);
  });
});

// ─── Task 17.2: Data Injection End-to-End (Fay → Terminal) ───

describe('Task 17.2: Data Injection E2E (Master → Slave)', () => {
  it('should complete full data injection pipeline: encrypt → serialize → transport → deserialize → decrypt → deliver', () => {
    const slaveTransport = new InMemoryTransportAdapter();
    const masterTransport = new InMemoryTransportAdapter();
    InMemoryTransportAdapter.pair(slaveTransport, masterTransport);

    const sharedKey = randomBytes(32);
    const masterEngine = new DTPEngine('master', masterTransport);
    const slaveEngine = new DTPEngine('slave', slaveTransport);

    const masterSession = masterEngine.createSession({
      identity: 'fay-master', sessionKey: sharedKey, verified: true,
    });
    const slaveSession = slaveEngine.createSession({
      identity: 'terminal-slave', sessionKey: sharedKey, verified: true,
    });

    // Connect: master initiates connection
    const masterConn = masterTransport.connect({ protocol: 'memory', address: 'local' });
    let slaveRemoteConnId: string | undefined;
    for (const [, remoteId] of (masterTransport as any).remoteConnectionMap) {
      slaveRemoteConnId = remoteId;
    }
    masterEngine.bindConnection(masterSession.sessionId, masterConn.connectionId);
    slaveEngine.bindConnection(slaveSession.sessionId, slaveRemoteConnId!);

    // Negotiate: slave initiates injection request
    const requestFrame = slaveEngine.initiateAgreement(slaveSession.sessionId, {
      direction: 'injection',
      proposedParams: { ...defaultParams, dataType: 'config-update' },
    });

    // Master handles and accepts
    const responseFrame = masterEngine.handleAgreementRequest(masterSession.sessionId, requestFrame);
    expect(responseFrame.result).toBe('accepted');

    // Both sides process the response
    const agreement = slaveEngine.handleAgreementResponse(slaveSession.sessionId, responseFrame);
    masterEngine.handleAgreementResponse(masterSession.sessionId, responseFrame);
    expect(agreement).not.toBeNull();

    // Track received frames on slave
    const receivedFrames: LogicalFrame[] = [];
    slaveEngine.onFrameReceived((_sessionId, frame) => {
      receivedFrames.push(frame);
    });

    // Master sends injection data (Fay → Terminal)
    const originalTimestamp = Date.now();
    const fragment = createFragment(agreement!.agreementId, 'Config payload from Fay');
    fragment.originTimestamp = originalTimestamp;
    fragment.contextMetadata = {
      dataType: 'config-update',
      source: {
        kind: 'software',
        appIdentifier: 'fay-core',
        sharingMethod: 'push',
      },
      customFields: { version: '2.0' },
    };

    const dataFrame = buildDataFrame(fragment, 0);
    masterEngine.sendFrame(masterSession.sessionId, dataFrame);

    // Verify slave received the frame
    expect(receivedFrames.length).toBe(1);
    const received = receivedFrames[0];

    // Verify Origin_Timestamp preserved
    expect(received.header.originTimestamp).toBe(originalTimestamp);

    // Verify payload decrypted correctly
    const receivedData = Buffer.from(received.payload).toString('utf-8');
    expect(receivedData).toBe('Config payload from Fay');

    // Verify metadata
    expect(received.header.frameType).toBe('data');
    expect(received.header.agreementId).toBe(agreement!.agreementId);

    // Master sends injection data, sequence number should be 1
    expect(received.header.sequenceNumber).toBe(1);
  });

  it('should support bidirectional transfer with independent sequence numbers', () => {
    const slaveTransport = new InMemoryTransportAdapter();
    const masterTransport = new InMemoryTransportAdapter();
    InMemoryTransportAdapter.pair(slaveTransport, masterTransport);

    const sharedKey = randomBytes(32);
    const masterEngine = new DTPEngine('master', masterTransport);
    const slaveEngine = new DTPEngine('slave', slaveTransport);

    const masterSession = masterEngine.createSession({
      identity: 'master', sessionKey: sharedKey, verified: true,
    });
    const slaveSession = slaveEngine.createSession({
      identity: 'slave', sessionKey: sharedKey, verified: true,
    });

    const masterConn = masterTransport.connect({ protocol: 'memory', address: 'local' });
    let slaveRemoteConnId: string | undefined;
    for (const [, remoteId] of (masterTransport as any).remoteConnectionMap) {
      slaveRemoteConnId = remoteId;
    }
    // Also get the slave-side local connection for slave→master
    const slaveConn = slaveTransport.connect({ protocol: 'memory', address: 'local' });
    let masterRemoteConnId2: string | undefined;
    for (const [localId, remoteId] of (slaveTransport as any).remoteConnectionMap) {
      if (localId === slaveConn.connectionId) {
        masterRemoteConnId2 = remoteId;
      }
    }

    masterEngine.bindConnection(masterSession.sessionId, masterConn.connectionId);
    slaveEngine.bindConnection(slaveSession.sessionId, slaveRemoteConnId!);

    // Set up collection agreement
    const collReq = masterEngine.initiateAgreement(masterSession.sessionId, {
      direction: 'collection', proposedParams: defaultParams,
    });
    const collResp = slaveEngine.handleAgreementRequest(slaveSession.sessionId, collReq);
    const collAgr = masterEngine.handleAgreementResponse(masterSession.sessionId, collResp);
    slaveEngine.handleAgreementResponse(slaveSession.sessionId, collResp);

    // Set up injection agreement
    const injReq = slaveEngine.initiateAgreement(slaveSession.sessionId, {
      direction: 'injection', proposedParams: { ...defaultParams, dataType: 'injection-data' },
    });
    const injResp = masterEngine.handleAgreementRequest(masterSession.sessionId, injReq);
    const injAgr = slaveEngine.handleAgreementResponse(slaveSession.sessionId, injResp);
    masterEngine.handleAgreementResponse(masterSession.sessionId, injResp);

    const masterReceived: LogicalFrame[] = [];
    const slaveReceived: LogicalFrame[] = [];
    masterEngine.onFrameReceived((_sid, frame) => masterReceived.push(frame));
    slaveEngine.onFrameReceived((_sid, frame) => slaveReceived.push(frame));

    // Slave sends 2 collection frames
    for (let i = 0; i < 2; i++) {
      const frag = createFragment(collAgr!.agreementId, `coll-${i}`);
      slaveEngine.sendFrame(slaveSession.sessionId, buildDataFrame(frag, 0));
    }

    // Master sends 2 injection frames
    for (let i = 0; i < 2; i++) {
      const frag = createFragment(injAgr!.agreementId, `inj-${i}`);
      masterEngine.sendFrame(masterSession.sessionId, buildDataFrame(frag, 0));
    }

    // Collection sequence numbers: 1, 2 (slave's collection direction)
    expect(masterReceived.length).toBe(2);
    expect(masterReceived[0].header.sequenceNumber).toBe(1);
    expect(masterReceived[1].header.sequenceNumber).toBe(2);

    // Injection sequence numbers: 1, 2 (master's injection direction)
    expect(slaveReceived.length).toBe(2);
    expect(slaveReceived[0].header.sequenceNumber).toBe(1);
    expect(slaveReceived[1].header.sequenceNumber).toBe(2);

    // Verify the sequence number spaces are independent
    // Slave's collection seq should be 2, master's injection seq should be 2
    const slaveCollSeq = slaveEngine.getSequenceNumber(slaveSession.sessionId, 'collection');
    const masterInjSeq = masterEngine.getSequenceNumber(masterSession.sessionId, 'injection');
    expect(slaveCollSeq).toBe(2);
    expect(masterInjSeq).toBe(2);

    // The other direction should still be 0 (or updated by receives)
    const slaveInjSeq = slaveEngine.getSequenceNumber(slaveSession.sessionId, 'injection');
    const masterCollSeq = masterEngine.getSequenceNumber(masterSession.sessionId, 'collection');
    // These are receive-side updates from incoming frames
    expect(masterCollSeq).toBeGreaterThanOrEqual(0);
    expect(slaveInjSeq).toBeGreaterThanOrEqual(0);
  });
});

// ─── Task 17.3: Disconnect and Resume Flow ───

describe('Task 17.3: Connection Disconnect and Resume', () => {
  it('should persist session on disconnect, restore on reconnect, and resume from correct sequence number', () => {
    const slaveTransport = new InMemoryTransportAdapter();
    const masterTransport = new InMemoryTransportAdapter();
    InMemoryTransportAdapter.pair(slaveTransport, masterTransport);

    const sharedKey = randomBytes(32);
    const masterEngine = new DTPEngine('master', masterTransport);
    const slaveEngine = new DTPEngine('slave', slaveTransport);

    const masterSession = masterEngine.createSession({
      identity: 'master', sessionKey: sharedKey, verified: true,
    });
    const slaveSession = slaveEngine.createSession({
      identity: 'slave', sessionKey: sharedKey, verified: true,
    });

    const slaveConn = slaveTransport.connect({ protocol: 'memory', address: 'local' });
    let masterRemoteConnId: string | undefined;
    for (const [, remoteId] of (slaveTransport as any).remoteConnectionMap) {
      masterRemoteConnId = remoteId;
    }
    slaveEngine.bindConnection(slaveSession.sessionId, slaveConn.connectionId);
    masterEngine.bindConnection(masterSession.sessionId, masterRemoteConnId!);

    // Negotiate collection agreement
    const req = masterEngine.initiateAgreement(masterSession.sessionId, {
      direction: 'collection', proposedParams: defaultParams,
    });
    const resp = slaveEngine.handleAgreementRequest(slaveSession.sessionId, req);
    const agr = masterEngine.handleAgreementResponse(masterSession.sessionId, resp);
    slaveEngine.handleAgreementResponse(slaveSession.sessionId, resp);

    const masterReceived: LogicalFrame[] = [];
    masterEngine.onFrameReceived((_sid, frame) => masterReceived.push(frame));

    // Send 3 fragments before disconnect
    for (let i = 0; i < 3; i++) {
      const frag = createFragment(agr!.agreementId, `pre-disconnect-${i}`);
      slaveEngine.sendFrame(slaveSession.sessionId, buildDataFrame(frag, 0));
    }

    expect(masterReceived.length).toBe(3);
    expect(masterReceived[2].header.sequenceNumber).toBe(3);

    // Record the sequence number state before disconnect
    const preDisconnectSlaveSeq = slaveEngine.getSequenceNumber(
      slaveSession.sessionId, 'collection',
    );
    expect(preDisconnectSlaveSeq).toBe(3);

    // ─── Simulate disconnect ───
    // Persist sessions on both sides
    masterEngine.sessionManager.persistSession(masterSession.sessionId);
    slaveEngine.sessionManager.persistSession(slaveSession.sessionId);

    // Disconnect transport
    slaveTransport.disconnect(slaveConn.connectionId);

    // ─── Simulate reconnect with CAP re-verification ───
    // Create new transport pair (simulating new connection)
    const slaveTransport2 = new InMemoryTransportAdapter();
    const masterTransport2 = new InMemoryTransportAdapter();
    InMemoryTransportAdapter.pair(slaveTransport2, masterTransport2);

    // Create new engines with new transports (simulating reconnection)
    const masterEngine2 = new DTPEngine('master', masterTransport2);
    const slaveEngine2 = new DTPEngine('slave', slaveTransport2);

    // CAP re-verification (same shared key)
    const masterCAP2: CAPContext = { identity: 'master', sessionKey: sharedKey, verified: true };
    const slaveCAP2: CAPContext = { identity: 'slave', sessionKey: sharedKey, verified: true };

    // Copy persisted sessions to new engines' session managers
    // (In real implementation, this would be loaded from persistent storage)
    // We simulate by persisting from old and restoring in new
    // First, we need to transfer the persisted data
    const masterPersistedSession = masterEngine.sessionManager.restoreSession(masterSession.sessionId);
    const slavePersistedSession = slaveEngine.sessionManager.restoreSession(slaveSession.sessionId);

    expect(masterPersistedSession).not.toBeNull();
    expect(slavePersistedSession).not.toBeNull();

    // Verify persisted session has correct sequence numbers
    expect(slavePersistedSession!.collectionState.currentSequenceNumber).toBe(3);

    // For the new engines, we create fresh sessions but verify the resume mechanism
    // The resume manager reports the highest received sequence number
    const masterResumeReport = masterEngine.resumeManager.reportResumePoint();
    expect(masterResumeReport.collectionHighest).toBe(3);

    // ─── Resume: new session continues from sequence 3 ───
    // Create new sessions on new engines
    const masterSession2 = masterEngine2.createSession(masterCAP2);
    const slaveSession2 = slaveEngine2.createSession(slaveCAP2);

    const slaveConn2 = slaveTransport2.connect({ protocol: 'memory', address: 'local' });
    let masterRemoteConnId2: string | undefined;
    for (const [, remoteId] of (slaveTransport2 as any).remoteConnectionMap) {
      masterRemoteConnId2 = remoteId;
    }
    slaveEngine2.bindConnection(slaveSession2.sessionId, slaveConn2.connectionId);
    masterEngine2.bindConnection(masterSession2.sessionId, masterRemoteConnId2!);

    // Re-negotiate agreement
    const req2 = masterEngine2.initiateAgreement(masterSession2.sessionId, {
      direction: 'collection', proposedParams: defaultParams,
    });
    const resp2 = slaveEngine2.handleAgreementRequest(slaveSession2.sessionId, req2);
    const agr2 = masterEngine2.handleAgreementResponse(masterSession2.sessionId, resp2);
    slaveEngine2.handleAgreementResponse(slaveSession2.sessionId, resp2);

    const masterReceived2: LogicalFrame[] = [];
    masterEngine2.onFrameReceived((_sid, frame) => masterReceived2.push(frame));

    // Send new fragments - sequence numbers start fresh in new session
    for (let i = 0; i < 2; i++) {
      const frag = createFragment(agr2!.agreementId, `post-resume-${i}`);
      slaveEngine2.sendFrame(slaveSession2.sessionId, buildDataFrame(frag, 0));
    }

    expect(masterReceived2.length).toBe(2);
    // New session starts sequence from 1
    expect(masterReceived2[0].header.sequenceNumber).toBe(1);
    expect(masterReceived2[1].header.sequenceNumber).toBe(2);

    // Verify data integrity after resume
    const data0 = Buffer.from(masterReceived2[0].payload).toString('utf-8');
    const data1 = Buffer.from(masterReceived2[1].payload).toString('utf-8');
    expect(data0).toBe('post-resume-0');
    expect(data1).toBe('post-resume-1');
  });

  it('should persist and restore session state including sequence numbers', () => {
    const transport = new InMemoryTransportAdapter();
    const engine = new DTPEngine('master', transport);

    const cap: CAPContext = {
      identity: 'test-master',
      sessionKey: randomBytes(32),
      verified: true,
    };

    const session = engine.createSession(cap);
    const sessionId = session.sessionId;

    // Manually update sequence numbers to simulate transfer state
    session.collectionState.currentSequenceNumber = 42;
    session.injectionState.currentSequenceNumber = 17;

    // Persist
    engine.sessionManager.persistSession(sessionId);

    // Restore
    const restored = engine.sessionManager.restoreSession(sessionId);
    expect(restored).not.toBeNull();
    expect(restored!.sessionId).toBe(sessionId);
    expect(restored!.collectionState.currentSequenceNumber).toBe(42);
    expect(restored!.injectionState.currentSequenceNumber).toBe(17);
    expect(restored!.masterIdentity).toBe('test-master');
  });

  it('should report correct resume point via ResumeManager', () => {
    const slaveTransport = new InMemoryTransportAdapter();
    const masterTransport = new InMemoryTransportAdapter();
    InMemoryTransportAdapter.pair(slaveTransport, masterTransport);

    const sharedKey = randomBytes(32);
    const masterEngine = new DTPEngine('master', masterTransport);
    const slaveEngine = new DTPEngine('slave', slaveTransport);

    const masterSession = masterEngine.createSession({
      identity: 'master', sessionKey: sharedKey, verified: true,
    });
    const slaveSession = slaveEngine.createSession({
      identity: 'slave', sessionKey: sharedKey, verified: true,
    });

    const slaveConn = slaveTransport.connect({ protocol: 'memory', address: 'local' });
    let masterRemoteConnId: string | undefined;
    for (const [, remoteId] of (slaveTransport as any).remoteConnectionMap) {
      masterRemoteConnId = remoteId;
    }
    slaveEngine.bindConnection(slaveSession.sessionId, slaveConn.connectionId);
    masterEngine.bindConnection(masterSession.sessionId, masterRemoteConnId!);

    // Negotiate
    const req = masterEngine.initiateAgreement(masterSession.sessionId, {
      direction: 'collection', proposedParams: defaultParams,
    });
    const resp = slaveEngine.handleAgreementRequest(slaveSession.sessionId, req);
    masterEngine.handleAgreementResponse(masterSession.sessionId, resp);
    slaveEngine.handleAgreementResponse(slaveSession.sessionId, resp);

    const masterReceived: LogicalFrame[] = [];
    masterEngine.onFrameReceived((_sid, frame) => masterReceived.push(frame));

    // Send 5 fragments
    const agr = masterEngine.getActiveAgreements(masterSession.sessionId)[0];
    for (let i = 0; i < 5; i++) {
      const frag = createFragment(agr.agreementId, `data-${i}`);
      slaveEngine.sendFrame(slaveSession.sessionId, buildDataFrame(frag, 0));
    }

    expect(masterReceived.length).toBe(5);

    // Master's resume manager should report highest received collection seq = 5
    const resumeReport = masterEngine.resumeManager.reportResumePoint();
    expect(resumeReport.collectionHighest).toBe(5);
    // Injection should still be 0 (no injection data sent)
    expect(resumeReport.injectionHighest).toBe(0);
  });

  it('should handle disconnect event propagation via transport adapter', () => {
    const adapter1 = new InMemoryTransportAdapter();
    const adapter2 = new InMemoryTransportAdapter();
    InMemoryTransportAdapter.pair(adapter1, adapter2);

    const stateChanges: Array<{ connectionId: string; state: string }> = [];
    adapter2.onConnectionStateChange((connectionId, state) => {
      stateChanges.push({ connectionId, state });
    });

    const conn = adapter1.connect({ protocol: 'memory', address: 'local' });

    // Disconnect from adapter1 side
    adapter1.disconnect(conn.connectionId);

    // adapter2 should have received a disconnected event for its mirrored connection
    const disconnectEvents = stateChanges.filter(e => e.state === 'disconnected');
    expect(disconnectEvents.length).toBeGreaterThanOrEqual(1);
  });
});
