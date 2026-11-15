/**
 * Official DTP 1.0 Cross-Language Conformance Vector Suite (TypeScript Runner)
 *
 * Validates that the TypeScript reference implementation achieves 100% pass rate
 * against vectors/dtp-1.0-conformance.json (both byte-exact encoding/encryption
 * and decoding/decryption/error-code enforcement), and verifies schema artifacts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { DTPFrameCodec } from '../components/frame-codec.js';
import { DTPEncryptionModule } from '../components/encryption-module.js';
import { DTPAgreementManager } from '../components/agreement-manager.js';
import { AgreementIdCompressor } from '../components/agreement-id-compressor.js';
import { DTPDAGManager } from '../components/dag-manager.js';
import { DTPResumeManager } from '../components/resume-manager.js';
import { ErrorHandler } from '../components/error-handler.js';
import { InMemoryTransportAdapter } from '../components/transport-adapter.js';
import { DTPEngine } from '../components/dtp-engine.js';
import { DTPErrorCode } from '../errors/error-codes.js';
import type { FrameHeader, LogicalFrame, Fragment } from '../index.js';

const ROOT = resolve(import.meta.dirname, '../..');
const vectorsRaw = JSON.parse(
  readFileSync(resolve(ROOT, 'vectors/dtp-1.0-conformance.json'), 'utf-8'),
);

function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

describe('Official DTP 1.0 Schemas & Cross-Language Conformance Vectors', () => {
  it('ships frozen machine-readable schemas at schemas/dtp-1.0.json and schemas/dtp-1.0.cddl', () => {
    const jsonSchemaPath = resolve(ROOT, vectorsRaw.normativeSchemaJson);
    const cddlSchemaPath = resolve(ROOT, vectorsRaw.normativeSchemaCddl);
    expect(existsSync(jsonSchemaPath)).toBe(true);
    expect(existsSync(cddlSchemaPath)).toBe(true);

    const jsonSchema = JSON.parse(readFileSync(jsonSchemaPath, 'utf-8'));
    expect(jsonSchema.$id).toBe('https://faying.org/schemas/dtp-1.0.json');
    expect(jsonSchema.$defs.ProtocolVersion.properties.major.const).toBe(1);
    expect(jsonSchema.$defs.FrameHeader.required).toEqual([
      'agreementId',
      'dagDependencies',
      'encryptionMetadata',
      'fragmentId',
      'frameType',
      'originTimestamp',
      'protocolVersion',
      'sequenceNumber',
    ]);

    const cddlText = readFileSync(cddlSchemaPath, 'utf-8');
    expect(cddlText).toContain('dtp-wire-envelope');
    expect(cddlText).toContain('aes256gcm-payload');
  });

  describe('Positive Wire + AES-256-GCM + JCS Vectors', () => {
    for (const vec of vectorsRaw.wireCryptoPositiveVectors) {
      it(`${vec.id}: decodes, decrypts, and (when canonical 1.0) re-encodes byte-for-byte`, () => {
        const codec = new DTPFrameCodec();
        const enc = new DTPEncryptionModule(fromHex(vec.sessionKeyHex));

        const wireBytes = fromHex(vec.wireFrameHex);
        const decoded = codec.deserialize(wireBytes);

        expect(ErrorHandler.isVersionCompatible(decoded.header.protocolVersion)).toBe(true);
        expect(decoded.header).toEqual(vec.expectedHeader);
        expect(toHex(decoded.payload)).toBe(vec.encryptedPayloadHex);

        const decrypted = enc.decryptPayload(decoded.payload, decoded.header.encryptionMetadata);
        expect(toHex(decrypted)).toBe(vec.plaintextHex);

        if (vec.reencodeExactMatch) {
          const reencrypted = enc.encryptPayloadWithIv(
            fromHex(vec.plaintextHex),
            fromHex(vec.ivHex),
            vec.expectedHeader.encryptionMetadata,
          );
          expect(toHex(reencrypted)).toBe(vec.encryptedPayloadHex);

          const reencoded = codec.serialize({
            header: vec.expectedHeader as FrameHeader,
            payload: reencrypted,
          });
          expect(toHex(reencoded)).toBe(vec.wireFrameHex);
        }
      });
    }
  });

  describe('Negative Wire, Crypto Tamper & Same-MAJOR Version Vectors', () => {
    for (const vec of vectorsRaw.wireCryptoNegativeVectors) {
      it(`${vec.id}: rejects with normative error code ${vec.expectedErrorCode} (${vec.expectedErrorName})`, () => {
        const slaveTransport = new InMemoryTransportAdapter();
        const masterTransport = new InMemoryTransportAdapter();
        InMemoryTransportAdapter.pair(slaveTransport, masterTransport);

        const key = fromHex(vec.sessionKeyHex);
        const master = new DTPEngine('master', masterTransport);
        const masterSession = master.createSession({
          identity: 'ifay_0192b4a0-7c10-7000-8000-000000000001',
          sessionKey: key,
          verified: true,
        });

        const slaveConn = slaveTransport.connect({ protocol: 'memory', address: 'local' });
        let masterConnId = '';
        for (const [, remoteId] of (
          slaveTransport as unknown as { remoteConnectionMap: Map<string, string> }
        ).remoteConnectionMap) {
          masterConnId = remoteId;
        }
        master.bindConnection(masterSession.sessionId, masterConnId);

        const observedCodes: number[] = [];
        master.onError((err) => observedCodes.push(err.errorCode));

        slaveTransport.send(slaveConn.connectionId, fromHex(vec.wireFrameHex));
        expect(observedCodes).toEqual([vec.expectedErrorCode]);
      });
    }
  });

  describe('RBAC Authority Vectors (8001 / 8002)', () => {
    const sampleParams = {
      dataType: 'sensor_reading',
      dataRange: 'realtime',
      transferMode: 'streaming' as const,
      frequency: 10,
      validityPeriod: 60_000,
      priority: 'normal' as const,
    };

    for (const vec of vectorsRaw.rbacVectors) {
      it(`${vec.id}: enforces ${vec.role} -> ${vec.action}`, () => {
        const engine = new DTPEngine(vec.role, new InMemoryTransportAdapter());
        const session = engine.createSession({
          identity: 'ifay_rbac_test',
          sessionKey: new Uint8Array(32).fill(0x11),
          verified: true,
        });

        const executeAction = () => {
          if (vec.action === 'initiate_collection') {
            engine.initiateAgreement(session.sessionId, {
              direction: 'collection',
              proposedParams: sampleParams,
            });
          } else if (vec.action === 'initiate_injection') {
            engine.initiateAgreement(session.sessionId, {
              direction: 'injection',
              proposedParams: sampleParams,
            });
          } else if (vec.action === 'send_frame') {
            engine.sendFrame(session.sessionId, {
              header: {
                protocolVersion: { major: 1, minor: 0 },
                frameType: 'data',
                fragmentId: 'frag-rbac',
                agreementId: 'agr-rbac',
                originTimestamp: 1,
                dagDependencies: [],
                encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
                sequenceNumber: 1,
              },
              payload: new Uint8Array([1]),
            });
          }
        };

        if (vec.allowed) {
          expect(executeAction).not.toThrow();
        } else {
          try {
            executeAction();
            expect.unreachable(`Expected ${vec.id} to throw ${vec.expectedErrorCode}`);
          } catch (err) {
            expect((err as { code: number }).code).toBe(vec.expectedErrorCode);
          }
        }
      });
    }
  });

  it('executes Agreement batch compression, boundary reset, missing context (3001), and expiration (3002) vectors', () => {
    const compVec = vectorsRaw.agreementVectors.batchCompression;
    const batch: LogicalFrame[] = compVec.inputFrames.map(
      (item: { frameType: 'data' | 'control'; agreementId: string | null }, idx: number) => ({
        header: {
          protocolVersion: { major: 1, minor: 0 },
          frameType: item.frameType,
          fragmentId: `f-${idx}`,
          agreementId: item.agreementId,
          originTimestamp: 1000 + idx,
          dagDependencies: [],
          encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
          sequenceNumber: idx + 1,
        },
        payload: new Uint8Array(0),
      }),
    );

    const compressor = new AgreementIdCompressor();
    const compressed = compressor.compress(batch);
    expect(compressed.map((f) => f.header.agreementId)).toEqual(compVec.expectedCompressedIds);

    const decompressed = compressor.decompress(compressed);
    expect(decompressed.map((f) => f.header.agreementId)).toEqual(compVec.expectedDecompressedIds);

    // Missing context -> 3001
    try {
      compressor.decompress([
        {
          ...batch[0]!,
          header: { ...batch[0]!.header, frameType: 'data', agreementId: null },
        },
      ]);
      expect.unreachable('Expected 3001');
    } catch (err) {
      expect((err as { code: number }).code).toBe(
        vectorsRaw.agreementVectors.missingContextError.expectedErrorCode,
      );
    }

    // Expiration -> 3002
    const expVec = vectorsRaw.agreementVectors.expirationCheck;
    const mgr = new DTPAgreementManager();
    const req = mgr.initiateRequest('sess-1', {
      direction: 'collection',
      proposedParams: {
        dataType: 'sensor_reading',
        dataRange: 'realtime',
        transferMode: 'streaming',
        frequency: 10,
        validityPeriod: expVec.validityPeriod,
        priority: 'normal',
      },
    });
    const resp = mgr.handleRequest('sess-1', req);
    const agr = mgr.getAgreement(resp.agreementId!)!;
    agr.createdAt = expVec.createdAt;
    expect(mgr.validateAgreement(agr.agreementId, expVec.checkAtValid).valid).toBe(true);
    expect(mgr.validateAgreement(agr.agreementId, expVec.checkAtExpired)).toEqual({
      valid: false,
      errorCode: expVec.expectedExpiredErrorCode,
    });
  });

  it('executes DAG out-of-order resolution and cycle detection (4001) vectors', () => {
    const dag = new DTPDAGManager();
    const baseFrag = (id: string, deps: Fragment['dagDependencies']): Fragment => ({
      fragmentId: id,
      agreementId: 'agr-dag',
      originTimestamp: 1,
      contextMetadata: {
        dataType: 'sensor_reading',
        source: { kind: 'hardware', sensorType: 'gps', precision: 'high', samplingRate: 1 },
        customFields: {},
      },
      dagDependencies: deps,
      data: new Uint8Array(0),
    });

    for (const step of vectorsRaw.dagVectors.outOfOrderResolution.steps) {
      const res = dag.addFragment(baseFrag(step.fragmentId, step.dependencies));
      expect(res.status).toBe(step.expectedStatus);
    }
    expect(dag.getPendingFragments().length).toBe(
      vectorsRaw.dagVectors.outOfOrderResolution.expectedPendingAfterAll,
    );

    const selfId = vectorsRaw.dagVectors.cycleRejection.selfCycleFragmentId;
    const cycleRes = dag.addFragment(
      baseFrag(selfId, [{ targetFragmentId: selfId, relationType: 'derived_from' }]),
    );
    expect(cycleRes).toEqual({ status: 'rejected', reason: 'cycle_detected' });
    expect(ErrorHandler.createDagCycleError(selfId).errorCode).toBe(
      vectorsRaw.dagVectors.cycleRejection.expectedErrorCode,
    );
  });

  it('executes bounded exponential backoff retry vector (6002, OQ-DTP-11)', () => {
    const rv = vectorsRaw.retryBackoffVector;
    const rm = new DTPResumeManager(16, rv.maxRetries, rv.baseDelayMs);
    rm.cacheFragment(
      {
        fragmentId: 'frag-retry',
        agreementId: 'agr-1',
        originTimestamp: 1,
        contextMetadata: {
          dataType: 'sensor_reading',
          source: { kind: 'hardware', sensorType: 'gps', precision: 'high', samplingRate: 1 },
          customFields: {},
        },
        dagDependencies: [],
        data: new Uint8Array([0xaa]),
      },
      1,
    );

    for (const expected of rv.expectedSchedule) {
      const decision = rm.recordRetryAttempt(1);
      expect(decision.allowed).toBe(expected.allowed);
      expect(decision.delayMs).toBe(expected.delayMs);
      if (!expected.allowed) {
        expect(
          ErrorHandler.createRetransmissionExhaustedError('frag-retry', decision.attempt, rv.maxRetries)
            .errorCode,
        ).toBe(DTPErrorCode.RETRANSMISSION_TIMEOUT);
      }
    }
  });
});
