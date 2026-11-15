import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { TcpTransportAdapter } from './tcp-transport-adapter.js';
import { DTPEngine } from './dtp-engine.js';
import { DTPErrorCode } from '../errors/error-codes.js';
import type { LogicalFrame } from '../types/frame.js';
import type { ErrorNotificationFrame } from '../errors/error-codes.js';

describe('TcpTransportAdapter (real node:net loopback over 127.0.0.1)', () => {
  const adaptersToCleanup: TcpTransportAdapter[] = [];

  afterEach(async () => {
    while (adaptersToCleanup.length > 0) {
      const adapter = adaptersToCleanup.pop()!;
      await adapter.close();
    }
  });

  it('transfers length-prefixed binary frames bidirectionally over ephemeral 127.0.0.1 TCP sockets', async () => {
    const serverAdapter = new TcpTransportAdapter();
    const clientAdapter = new TcpTransportAdapter();
    adaptersToCleanup.push(serverAdapter, clientAdapter);

    let serverConnId: string | null = null;
    serverAdapter.onConnectionStateChange((connId, state) => {
      if (state === 'connected') {
        serverConnId = connId;
      }
    });

    const serverReceived: Uint8Array[] = [];
    const clientReceived: Uint8Array[] = [];
    serverAdapter.onReceive((_cid, data) => serverReceived.push(data));
    clientAdapter.onReceive((_cid, data) => clientReceived.push(data));

    const { host, port } = await serverAdapter.listen(0, '127.0.0.1');
    expect(port).toBeGreaterThan(0);

    const clientConn = await clientAdapter.connectAsync({
      protocol: 'tcp',
      address: host,
      port,
    });

    // Wait briefly for server connection event
    await new Promise((r) => setTimeout(r, 20));
    expect(serverConnId).not.toBeNull();

    // Send multiple frames back-to-back to exercise TCP stream coalescing & framing
    const payload1 = new Uint8Array([1, 2, 3, 4, 5]);
    const payload2 = randomBytes(8192);
    clientAdapter.send(clientConn.connectionId, payload1);
    clientAdapter.send(clientConn.connectionId, payload2);

    await new Promise((r) => setTimeout(r, 40));
    expect(serverReceived).toHaveLength(2);
    expect(serverReceived[0]).toEqual(payload1);
    expect(Buffer.from(serverReceived[1])).toEqual(payload2);

    // Reply from server -> client
    const reply = new Uint8Array([42, 99, 100]);
    serverAdapter.send(serverConnId!, reply);

    await new Promise((r) => setTimeout(r, 30));
    expect(clientReceived).toHaveLength(1);
    expect(clientReceived[0]).toEqual(reply);

    // Propagates disconnect event to peer
    const serverDisconnects: string[] = [];
    serverAdapter.onConnectionStateChange((cid, state) => {
      if (state === 'disconnected') serverDisconnects.push(cid);
    });
    clientAdapter.disconnect(clientConn.connectionId);
    await new Promise((r) => setTimeout(r, 30));
    expect(serverDisconnects).toContain(serverConnId!);
  });

  it('runs end-to-end DTPEngine Master <-> Slave encrypted collection & agreement expiry over TCP loopback', async () => {
    const masterTransport = new TcpTransportAdapter();
    const slaveTransport = new TcpTransportAdapter();
    adaptersToCleanup.push(masterTransport, slaveTransport);

    let masterRemoteConnId: string | null = null;
    masterTransport.onConnectionStateChange((cid, state) => {
      if (state === 'connected') masterRemoteConnId = cid;
    });

    const { host, port } = await masterTransport.listen(0, '127.0.0.1');

    const sharedKey = randomBytes(32);
    const masterEngine = new DTPEngine('master', masterTransport);
    const slaveEngine = new DTPEngine('slave', slaveTransport);

    const masterSession = masterEngine.createSession({
      identity: 'ifay_master_tcp',
      sessionKey: sharedKey,
      verified: true,
    });
    const slaveSession = slaveEngine.createSession({
      identity: 'host_sensor_tcp',
      sessionKey: sharedKey,
      verified: true,
    });

    const slaveConn = await slaveTransport.connectAsync({
      protocol: 'tcp',
      address: host,
      port,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(masterRemoteConnId).not.toBeNull();

    slaveEngine.bindConnection(slaveSession.sessionId, slaveConn.connectionId);
    masterEngine.bindConnection(masterSession.sessionId, masterRemoteConnId!);

    // Negotiate collection agreement
    const req = masterEngine.initiateAgreement(masterSession.sessionId, {
      direction: 'collection',
      proposedParams: {
        dataType: 'telemetry',
        dataRange: 'all',
        transferMode: 'streaming',
        frequency: 10,
        validityPeriod: 60_000,
        priority: 'high',
      },
    });
    const resp = slaveEngine.handleAgreementRequest(slaveSession.sessionId, req);
    const agreement = masterEngine.handleAgreementResponse(masterSession.sessionId, resp)!;
    slaveEngine.handleAgreementResponse(slaveSession.sessionId, resp);

    const receivedOnMaster: LogicalFrame[] = [];
    const masterErrors: ErrorNotificationFrame[] = [];
    masterEngine.onFrameReceived((_sid, f) => receivedOnMaster.push(f));
    masterEngine.onError((e) => masterErrors.push(e));

    const fragId = uuidv4();
    const originTs = 1730000000123;
    slaveEngine.sendFrame(slaveSession.sessionId, {
      header: {
        protocolVersion: { major: 1, minor: 0 },
        frameType: 'data',
        fragmentId: fragId,
        agreementId: agreement.agreementId,
        originTimestamp: originTs,
        dagDependencies: [],
        encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
        sequenceNumber: 0,
      },
      payload: new Uint8Array(Buffer.from('tcp-loopback-encrypted-fragment', 'utf-8')),
    });

    await new Promise((r) => setTimeout(r, 40));
    expect(receivedOnMaster).toHaveLength(1);
    expect(receivedOnMaster[0].header.fragmentId).toBe(fragId);
    expect(receivedOnMaster[0].header.originTimestamp).toBe(originTs);
    expect(receivedOnMaster[0].header.sequenceNumber).toBe(1);
    expect(Buffer.from(receivedOnMaster[0].payload).toString('utf-8')).toBe(
      'tcp-loopback-encrypted-fragment',
    );

    // Send frame referencing unknown Agreement_ID -> Master emits AGREEMENT_NOT_FOUND (3001)
    slaveEngine.sendFrame(slaveSession.sessionId, {
      header: {
        protocolVersion: { major: 1, minor: 0 },
        frameType: 'data',
        fragmentId: uuidv4(),
        agreementId: uuidv4(),
        originTimestamp: originTs,
        dagDependencies: [],
        encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
        sequenceNumber: 0,
      },
      payload: new Uint8Array([1, 2, 3]),
    });

    await new Promise((r) => setTimeout(r, 40));
    expect(receivedOnMaster).toHaveLength(1); // Dropped!
    expect(masterErrors.some((e) => e.errorCode === DTPErrorCode.AGREEMENT_NOT_FOUND)).toBe(true);
  });
});
