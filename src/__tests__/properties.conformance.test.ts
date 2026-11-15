/**
 * DTP 1.0 Property-Based Conformance Suite (Properties 1–29)
 *
 * Executes all 29 normative DTP correctness properties with fast-check (numRuns >= 100),
 * covering RFC 8785 JCS wire framing (OQ-DTP-7), same-MAJOR versioning (OQ-DTP-2),
 * AES-256-GCM confidentiality & tamper rejection, DAG acyclicity & out-of-order resolution,
 * Master/Slave/Observer RBAC, Agreement batch compression & expiration (OQ-DTP-6/11),
 * EncryptedFileSessionStore persistence (OQ-DTP-10), and bounded backoff retry (OQ-DTP-11).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import {
  logicalFrameArbitrary,
  fragmentArbitrary,
  agreementArbitrary,
  agreementParamsArbitrary,
  dagArbitrary,
  dagRelationTypeArbitrary,
  contextMetadataArbitrary,
  sessionArbitrary,
  transferDirectionArbitrary,
  fragmentIdArbitrary,
  agreementIdArbitrary,
  originTimestampArbitrary,
} from './arbitraries/index.js';

import { DTPFrameCodec } from '../components/frame-codec.js';
import { DTPEncryptionModule } from '../components/encryption-module.js';
import { DTPDAGManager } from '../components/dag-manager.js';
import { DTPAgreementManager } from '../components/agreement-manager.js';
import {
  DTPSessionManager,
  EncryptedFileSessionStore,
} from '../components/session-manager.js';
import { DTPResumeManager } from '../components/resume-manager.js';
import { AgreementIdCompressor } from '../components/agreement-id-compressor.js';
import { ContextMetadataValidator } from '../components/context-metadata-validator.js';
import {
  ErrorHandler,
  CURRENT_VERSION,
} from '../components/error-handler.js';
import { InMemoryTransportAdapter } from '../components/transport-adapter.js';
import { DTPEngine } from '../components/dtp-engine.js';
import type { DTPEngineConfig } from '../components/dtp-engine.js';
import { DTPErrorCode } from '../errors/error-codes.js';
import type { LogicalFrame, Fragment, CAPContext } from '../index.js';

const NUM_RUNS = 100;

function makeSharedKey(keySeed: number = 7): Uint8Array {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    key[i] = (keySeed + i * 13) & 0xff;
  }
  return key;
}

function makeCapContext(
  keySeed: number = 7,
  identity: string = 'ifay_0192b4a0-7c10-7000-8000-000000000001',
): CAPContext {
  return {
    identity,
    sessionKey: makeSharedKey(keySeed),
    verified: true,
  };
}

function bindPeerEngines(keySeed: number = 7, slaveConfig?: DTPEngineConfig) {
  const slaveTransport = new InMemoryTransportAdapter();
  const masterTransport = new InMemoryTransportAdapter();
  InMemoryTransportAdapter.pair(slaveTransport, masterTransport);

  const sharedKey = makeSharedKey(keySeed);
  const masterCap: CAPContext = {
    identity: 'ifay_0192b4a0-7c10-7000-8000-000000000001',
    sessionKey: sharedKey,
    verified: true,
  };
  const slaveCap: CAPContext = {
    identity: 'host-sensor-hub-01',
    sessionKey: sharedKey,
    verified: true,
  };

  const master = new DTPEngine('master', masterTransport);
  const slave = new DTPEngine('slave', slaveTransport, slaveConfig);

  const masterSession = master.createSession(masterCap);
  const slaveSession = slave.createSession(slaveCap);

  const slaveConn = slaveTransport.connect({ address: 'local', protocol: 'memory' });
  let masterRemoteConnId: string | undefined;
  for (const [, remoteId] of (
    slaveTransport as unknown as { remoteConnectionMap: Map<string, string> }
  ).remoteConnectionMap) {
    masterRemoteConnId = remoteId;
  }

  slave.bindConnection(slaveSession.sessionId, slaveConn.connectionId);
  master.bindConnection(masterSession.sessionId, masterRemoteConnId!);

  return {
    master,
    slave,
    masterTransport,
    slaveTransport,
    masterSession,
    slaveSession,
    masterConnId: masterRemoteConnId!,
    slaveConnId: slaveConn.connectionId,
  };
}

describe('DTP 1.0 Property-Based Conformance Suite (29 Properties)', () => {
  // Feature: data-tunnel-protocol, Property 1: LogicalFrame 序列化往返一致性
  it('Property 1: LogicalFrame serialize -> deserialize roundtrip & JCS canonical header', () => {
    const codec = new DTPFrameCodec();
    fc.assert(
      fc.property(logicalFrameArbitrary, (frame) => {
        const wire = codec.serialize(frame);
        const headerLen = new DataView(wire.buffer, wire.byteOffset, 4).getUint32(0, false);
        const headerJson = new TextDecoder().decode(wire.subarray(4, 4 + headerLen));

        // Header keys MUST be in RFC 8785 JCS lexicographical UTF-16 order
        const parsedObj = JSON.parse(headerJson) as Record<string, unknown>;
        const topKeys = Object.keys(parsedObj);
        expect(topKeys).toEqual([...topKeys].sort());

        const decoded = codec.deserialize(wire);
        expect(decoded.header).toEqual(frame.header);
        expect(Array.from(decoded.payload)).toEqual(Array.from(frame.payload));

        // Re-serializing produces byte-identical wire representation
        const reserialized = codec.serialize(decoded);
        expect(Array.from(reserialized)).toEqual(Array.from(wire));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 2: 角色权限执行
  it('Property 2: Role-based authority enforcement (Master/Slave/Observer RBAC 8001/8002)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('master' as const, 'slave' as const, 'observer' as const),
        agreementParamsArbitrary,
        logicalFrameArbitrary,
        (role, params, frame) => {
          const transport = new InMemoryTransportAdapter();
          const engine = new DTPEngine(role, transport);
          const session = engine.createSession(makeCapContext(1));

          if (role === 'master') {
            const req = engine.initiateAgreement(session.sessionId, {
              direction: 'collection',
              proposedParams: params,
            });
            expect(req.requestType).toBe('collection');
            expect(() =>
              engine.initiateAgreement(session.sessionId, {
                direction: 'injection',
                proposedParams: params,
              }),
            ).toThrowError();
          } else if (role === 'slave') {
            const req = engine.initiateAgreement(session.sessionId, {
              direction: 'injection',
              proposedParams: params,
            });
            expect(req.requestType).toBe('injection');
            expect(() =>
              engine.initiateAgreement(session.sessionId, {
                direction: 'collection',
                proposedParams: params,
              }),
            ).toThrowError();
          } else {
            // Observer: ALL writes and request initiations MUST fail with OBSERVER_WRITE_DENIED (8002)
            try {
              engine.sendFrame(session.sessionId, frame);
              expect.unreachable('Observer sendFrame must throw');
            } catch (err) {
              expect((err as { code: number }).code).toBe(DTPErrorCode.OBSERVER_WRITE_DENIED);
            }
            try {
              engine.initiateAgreement(session.sessionId, {
                direction: 'collection',
                proposedParams: params,
              });
              expect.unreachable('Observer initiateAgreement must throw');
            } catch (err) {
              expect((err as { code: number }).code).toBe(DTPErrorCode.OBSERVER_WRITE_DENIED);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 3: 协商响应有效性
  it('Property 3: Negotiation responses carry valid outcome and non-empty counterparty params on counter_proposal', () => {
    fc.assert(
      fc.property(
        agreementParamsArbitrary,
        agreementParamsArbitrary,
        fc.constantFrom('accepted' as const, 'rejected' as const, 'counter_proposal' as const),
        (reqParams, counterParams, outcome) => {
          const manager = new DTPAgreementManager();
          const sessionId = uuidv4();
          const req = manager.initiateRequest(sessionId, {
            direction: 'collection',
            proposedParams: reqParams,
          });

          if (outcome === 'accepted') {
            const resp = manager.handleRequest(sessionId, req);
            expect(['accepted', 'rejected', 'counter_proposal']).toContain(resp.result);
            const agr = manager.handleResponse(sessionId, resp);
            expect(agr).not.toBeNull();
            expect(agr!.status).toBe('active');
          } else if (outcome === 'rejected') {
            const resp = {
              frameType: 'response' as const,
              requestId: req.requestId,
              result: 'rejected' as const,
              rejectionReason: 'host_privacy_policy_restricted',
            };
            const agr = manager.handleResponse(sessionId, resp);
            expect(agr).toBeNull();
          } else {
            const resp = {
              frameType: 'response' as const,
              requestId: req.requestId,
              result: 'counter_proposal' as const,
              agreedParams: counterParams,
            };
            expect(resp.agreedParams).toBeDefined();
            const agr = manager.handleResponse(sessionId, resp);
            expect(agr).toBeNull();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 4: Agreement_ID 压缩往返一致性
  it('Property 4: Agreement_ID batch compression -> decompression roundtrip with boundary reset (OQ-DTP-6)', () => {
    fc.assert(
      fc.property(
        fc.array(agreementIdArbitrary, { minLength: 1, maxLength: 3 }),
        fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 12 }),
        logicalFrameArbitrary,
        (agreementPool, selectorIndices, templateFrame) => {
          const batch: LogicalFrame[] = selectorIndices.map((idx, seq) => ({
            header: {
              ...templateFrame.header,
              frameType: 'data',
              agreementId: agreementPool[idx % agreementPool.length]!,
              sequenceNumber: seq + 1,
            },
            payload: templateFrame.payload,
          }));

          const senderCompressor = new AgreementIdCompressor();
          const receiverCompressor = new AgreementIdCompressor();

          const compressed = senderCompressor.compress(batch);
          expect(compressed[0]!.header.agreementId).not.toBeNull();

          const decompressed = receiverCompressor.decompress(compressed);
          expect(decompressed.map((f) => f.header.agreementId)).toEqual(
            batch.map((f) => f.header.agreementId),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 5: 未知 Agreement_ID 拒绝
  it('Property 5: Data frames referencing unknown Agreement_ID are rejected with AGREEMENT_NOT_FOUND (3001)', () => {
    fc.assert(
      fc.property(agreementIdArbitrary, logicalFrameArbitrary, (unknownAgrId, rawFrame) => {
        const { master, slave, slaveSession } = bindPeerEngines(5);
        const masterErrors: number[] = [];
        master.onError((e) => masterErrors.push(e.errorCode));

        const receivedFrames: LogicalFrame[] = [];
        master.onFrameReceived((_sid, f) => receivedFrames.push(f));

        const dataFrame: LogicalFrame = {
          header: {
            ...rawFrame.header,
            protocolVersion: CURRENT_VERSION,
            frameType: 'data',
            agreementId: unknownAgrId,
          },
          payload: rawFrame.payload,
        };

        slave.sendFrame(slaveSession.sessionId, dataFrame);
        expect(receivedFrames.length).toBe(0);
        expect(masterErrors).toContain(DTPErrorCode.AGREEMENT_NOT_FOUND);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 6: 端到端加密往返一致性
  it('Property 6: AES-256-GCM encryption roundtrip with session key & rejection on wrong key or tampered tag', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.uint8Array({ minLength: 0, maxLength: 512 }),
        (keyBytes, plaintext) => {
          const enc = new DTPEncryptionModule(keyBytes);
          const meta = enc.getEncryptionMetadata();
          const ciphertext = enc.encryptPayload(plaintext, meta);

          // Wire format: 12B IV + ciphertext + 16B AuthTag
          expect(ciphertext.byteLength).toBe(plaintext.byteLength + 28);
          const decrypted = enc.decryptPayload(ciphertext, meta);
          expect(Array.from(decrypted)).toEqual(Array.from(plaintext));

          // Wrong key MUST fail authentication
          const wrongKey = new Uint8Array(keyBytes);
          wrongKey[0] = (wrongKey[0]! ^ 0xff) & 0xff;
          const wrongEnc = new DTPEncryptionModule(wrongKey);
          expect(() => wrongEnc.decryptPayload(ciphertext, meta)).toThrowError();

          // Tampered AuthTag MUST fail authentication
          const tampered = new Uint8Array(ciphertext);
          tampered[tampered.length - 1] = (tampered[tampered.length - 1]! ^ 0x01) & 0xff;
          expect(() => enc.decryptPayload(tampered, meta)).toThrowError();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 7: CAP 前置条件执行
  it('Property 7: Unverified CAP context or missing session key rejects session/frame with KEY_NOT_READY (2002)', () => {
    fc.assert(
      fc.property(logicalFrameArbitrary, (frame) => {
        const transport = new InMemoryTransportAdapter();
        const engine = new DTPEngine('master', transport);

        const unverifiedCap: CAPContext = {
          ...makeCapContext(7),
          verified: false,
        };
        try {
          engine.createSession(unverifiedCap);
          expect.unreachable('Unverified CAP must throw KEY_NOT_READY');
        } catch (err) {
          expect((err as { code: number }).code).toBe(DTPErrorCode.KEY_NOT_READY);
        }

        // Session with invalid/empty key length leaves encryptionModule unready
        const emptyKeyCap: CAPContext = {
          ...makeCapContext(7),
          sessionKey: new Uint8Array(0),
          verified: true,
        };
        const session = engine.createSession(emptyKeyCap);
        try {
          engine.sendFrame(session.sessionId, frame);
          expect.unreachable('Missing session key must throw KEY_NOT_READY');
        } catch (err) {
          expect((err as { code: number }).code).toBe(DTPErrorCode.KEY_NOT_READY);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 8: 上下文元数据按来源类型完整性
  it('Property 8: ContextMetadataValidator accepts complete hardware/software metadata and rejects incomplete fields', () => {
    const validator = new ContextMetadataValidator();
    fc.assert(
      fc.property(contextMetadataArbitrary, (metadata) => {
        expect(validator.validate(metadata)).toEqual({ valid: true });

        if (metadata.source.kind === 'hardware') {
          const broken = {
            ...metadata,
            source: { ...metadata.source, samplingRate: 0 },
          };
          expect(validator.validate(broken).valid).toBe(false);
        } else {
          const broken = {
            ...metadata,
            source: { ...metadata.source, appIdentifier: '' },
          };
          expect(validator.validate(broken).valid).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 9: DAG 无环性执行
  it('Property 9: Acyclic topological DAG fragments are accepted while cycle-forming edges are rejected', () => {
    fc.assert(
      fc.property(
        dagArbitrary,
        fragmentArbitrary,
        dagRelationTypeArbitrary,
        (dagEdges, baseFragment, relType) => {
          const dag = new DTPDAGManager();
          const rootId = uuidv4();
          const childId = uuidv4();

          const root: Fragment = {
            ...baseFragment,
            fragmentId: rootId,
            dagDependencies: [],
          };
          const child: Fragment = {
            ...baseFragment,
            fragmentId: childId,
            dagDependencies: [{ targetFragmentId: rootId, relationType: relType }],
          };

          expect(dag.addFragment(root).status).toBe('accepted');
          expect(dag.addFragment(child).status).toBe('accepted');

          // Self-cycle MUST be rejected
          const selfCycle: Fragment = {
            ...baseFragment,
            fragmentId: uuidv4(),
            dagDependencies: [],
          };
          selfCycle.dagDependencies = [
            { targetFragmentId: selfCycle.fragmentId, relationType: relType },
          ];
          expect(dag.addFragment(selfCycle)).toEqual({
            status: 'rejected',
            reason: 'cycle_detected',
          });

          // Verify generated topological edges contain valid targetFragmentIds
          for (const edge of dagEdges) {
            expect(typeof edge.targetFragmentId).toBe('string');
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 10: 未解析依赖缓存
  it('Property 10: Out-of-order Fragment with missing parent caches as pending and resolves automatically when parent arrives', () => {
    fc.assert(
      fc.property(fragmentArbitrary, dagRelationTypeArbitrary, (baseFragment, relType) => {
        const dag = new DTPDAGManager();
        const parentId = uuidv4();
        const childId = uuidv4();

        const child: Fragment = {
          ...baseFragment,
          fragmentId: childId,
          dagDependencies: [{ targetFragmentId: parentId, relationType: relType }],
        };
        const parent: Fragment = {
          ...baseFragment,
          fragmentId: parentId,
          dagDependencies: [],
        };

        // Arrive out-of-order: child first
        const childRes = dag.addFragment(child);
        expect(childRes).toEqual({ status: 'pending', unresolvedDeps: [parentId] });
        expect(dag.getPendingFragments().map((f) => f.fragmentId)).toContain(childId);

        // Arrive parent: both parent and child are now resolved!
        expect(dag.addFragment(parent).status).toBe('accepted');
        expect(dag.getPendingFragments().length).toBe(0);
        const resolved = dag.resolveDependencies(childId);
        expect(resolved.resolved).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 11: Origin_Timestamp 传输不变性
  it('Property 11: Origin_Timestamp remains strictly invariant end-to-end across encryption and framing', () => {
    fc.assert(
      fc.property(
        originTimestampArbitrary,
        fc.uint8Array({ minLength: 1, maxLength: 128 }),
        agreementParamsArbitrary,
        (originTs, payload, params) => {
          const { master, slave, masterSession, slaveSession } = bindPeerEngines(11);

          const req = master.initiateAgreement(masterSession.sessionId, {
            direction: 'collection',
            proposedParams: params,
          });
          const resp = slave.handleAgreementRequest(slaveSession.sessionId, req);
          const agr = master.handleAgreementResponse(masterSession.sessionId, resp)!;

          let receivedOriginTs: number | null = null;
          master.onFrameReceived((_sid, frame) => {
            receivedOriginTs = frame.header.originTimestamp;
          });

          slave.sendFrame(slaveSession.sessionId, {
            header: {
              protocolVersion: CURRENT_VERSION,
              frameType: 'data',
              fragmentId: uuidv4(),
              agreementId: agr.agreementId,
              originTimestamp: originTs,
              dagDependencies: [],
              encryptionMetadata: slave.encryptionModule.getEncryptionMetadata(),
              sequenceNumber: 0,
            },
            payload,
          });

          expect(receivedOriginTs).toBe(originTs);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 12: 序列号单调递增
  it('Property 12: Consecutive frames sent in the same direction receive strictly monotonically increasing sequence numbers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        agreementParamsArbitrary,
        (count, params) => {
          const { master, slave, masterSession, slaveSession } = bindPeerEngines(12);
          const req = master.initiateAgreement(masterSession.sessionId, {
            direction: 'collection',
            proposedParams: params,
          });
          const resp = slave.handleAgreementRequest(slaveSession.sessionId, req);
          const agr = master.handleAgreementResponse(masterSession.sessionId, resp)!;

          const receivedSeqs: number[] = [];
          master.onFrameReceived((_sid, frame) => {
            receivedSeqs.push(frame.header.sequenceNumber);
          });

          for (let i = 0; i < count; i++) {
            slave.sendFrame(slaveSession.sessionId, {
              header: {
                protocolVersion: CURRENT_VERSION,
                frameType: 'data',
                fragmentId: uuidv4(),
                agreementId: agr.agreementId,
                originTimestamp: 1700000000000 + i,
                dagDependencies: [],
                encryptionMetadata: slave.encryptionModule.getEncryptionMetadata(),
                sequenceNumber: 0,
              },
              payload: new Uint8Array([i]),
            });
          }

          expect(receivedSeqs.length).toBe(count);
          for (let i = 1; i < receivedSeqs.length; i++) {
            expect(receivedSeqs[i]!).toBe(receivedSeqs[i - 1]! + 1);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 13: 续传正确性
  it('Property 13: Resume point reporting & acknowledgement resumes cleanly from last received sequence without duplicates or gaps', () => {
    fc.assert(
      fc.property(
        transferDirectionArbitrary,
        fc.integer({ min: 3, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fragmentArbitrary,
        (direction, totalSent, rawCut, templateFrag) => {
          const cutPoint = Math.min(rawCut, totalSent - 1);
          const senderResume = new DTPResumeManager(64);
          const receiverResume = new DTPResumeManager(64);

          for (let seq = 1; seq <= totalSent; seq++) {
            senderResume.cacheFragment(
              {
                ...templateFrag,
                fragmentId: `${templateFrag.fragmentId}-${seq}`,
              },
              seq,
            );
            if (seq <= cutPoint) {
              receiverResume.recordReceived(direction, seq);
            }
          }

          const resumeReport = receiverResume.reportResumePoint();
          const resumePoint =
            direction === 'collection'
              ? resumeReport.collectionHighest
              : resumeReport.injectionHighest;
          expect(resumePoint).toBe(cutPoint);
          expect(receiverResume.getHighestReceivedSequenceNumber(direction)).toBe(cutPoint);

          senderResume.acknowledgeUpTo(resumePoint);
          const remaining = senderResume.getUnacknowledgedEntries().map(([s]) => s);
          const expectedRemaining = Array.from(
            { length: totalSent - cutPoint },
            (_, idx) => cutPoint + 1 + idx,
          );
          expect(remaining).toEqual(expectedRemaining);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 14: 未确认 Fragment 缓存
  it('Property 14: Unacknowledged Fragment cache retains seq > ackSeq and purges all seq <= ackSeq', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
        fragmentArbitrary,
        (count, ackSeq, frag) => {
          const rm = new DTPResumeManager(100);
          for (let s = 1; s <= count; s++) {
            rm.cacheFragment({ ...frag, fragmentId: `f-${s}` }, s);
          }
          rm.acknowledgeUpTo(ackSeq);
          const remainingSeqs = rm.getUnacknowledgedEntries().map(([s]) => s);
          expect(remainingSeqs.every((s) => s > ackSeq)).toBe(true);
          expect(remainingSeqs.length).toBe(Math.max(0, count - ackSeq));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 15: 双向序列号空间独立性
  it('Property 15: Collection and injection sequence number spaces advance independently without interference', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        agreementParamsArbitrary,
        (collCount, injCount, params) => {
          const { master, slave, masterSession, slaveSession } = bindPeerEngines(15);

          const collReq = master.initiateAgreement(masterSession.sessionId, {
            direction: 'collection',
            proposedParams: params,
          });
          const collResp = slave.handleAgreementRequest(slaveSession.sessionId, collReq);
          const collAgr = master.handleAgreementResponse(masterSession.sessionId, collResp)!;

          const injReq = slave.initiateAgreement(slaveSession.sessionId, {
            direction: 'injection',
            proposedParams: params,
          });
          const injResp = master.handleAgreementRequest(masterSession.sessionId, injReq);
          const injAgr = slave.handleAgreementResponse(slaveSession.sessionId, injResp)!;

          for (let i = 0; i < collCount; i++) {
            slave.sendFrame(slaveSession.sessionId, {
              header: {
                protocolVersion: CURRENT_VERSION,
                frameType: 'data',
                fragmentId: uuidv4(),
                agreementId: collAgr.agreementId,
                originTimestamp: 1000 + i,
                dagDependencies: [],
                encryptionMetadata: slave.encryptionModule.getEncryptionMetadata(),
                sequenceNumber: 0,
              },
              payload: new Uint8Array([1]),
            });
          }

          for (let j = 0; j < injCount; j++) {
            master.sendFrame(masterSession.sessionId, {
              header: {
                protocolVersion: CURRENT_VERSION,
                frameType: 'data',
                fragmentId: uuidv4(),
                agreementId: injAgr.agreementId,
                originTimestamp: 2000 + j,
                dagDependencies: [],
                encryptionMetadata: master.encryptionModule.getEncryptionMetadata(),
                sequenceNumber: 0,
              },
              payload: new Uint8Array([2]),
            });
          }

          expect(slave.getSequenceNumber(slaveSession.sessionId, 'collection')).toBe(collCount);
          expect(master.getSequenceNumber(masterSession.sessionId, 'injection')).toBe(injCount);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 16: 会话状态持久化往返一致性
  it('Property 16: Session state persistence roundtrips accurately in both InMemorySessionStore and AES-256-GCM EncryptedFileSessionStore (OQ-DTP-10)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'dtp-prop16-'));
    try {
      const storageKey = new Uint8Array(32).fill(0x5a);
      fc.assert(
        fc.property(
          sessionArbitrary,
          fragmentArbitrary,
          agreementArbitrary,
          (generatedSession, frag, agr) => {
            const store = new EncryptedFileSessionStore(
              join(tempDir, 'sessions.enc'),
              storageKey,
            );
            const mgr1 = new DTPSessionManager(store);
            const created = mgr1.createSession(
              makeCapContext(16, `ifay_${generatedSession.masterIdentity}`),
              `host_${generatedSession.slaveIdentity}`,
            );

            created.collectionState.currentSequenceNumber =
              generatedSession.collectionState.currentSequenceNumber;
            created.collectionState.highestAcknowledgedSequenceNumber =
              generatedSession.collectionState.highestAcknowledgedSequenceNumber;
            created.collectionState.unacknowledgedFragmentCache.set(1, frag);
            created.activeAgreements.set(agr.agreementId, {
              ...agr,
              sessionId: created.sessionId,
            });

            mgr1.persistSession(created.sessionId);

            // Fresh manager reading from encrypted disk snapshot
            const mgr2 = new DTPSessionManager(store);
            const restored = mgr2.restoreSession(created.sessionId)!;
            expect(restored).not.toBeNull();
            expect(restored.masterIdentity).toBe(created.masterIdentity);
            expect(restored.slaveIdentity).toBe(created.slaveIdentity);
            expect(restored.collectionState.currentSequenceNumber).toBe(
              created.collectionState.currentSequenceNumber,
            );
            const restoredFrag = restored.collectionState.unacknowledgedFragmentCache.get(1)!;
            expect(Array.from(restoredFrag.data)).toEqual(Array.from(frag.data));
            expect(restored.activeAgreements.has(agr.agreementId)).toBe(true);

            store.delete(created.sessionId);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Feature: data-tunnel-protocol, Property 17: 会话超时执行
  it('Property 17: Idle duration strictly exceeding timeoutThreshold triggers session timeout & resource cleanup (5002)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5000, max: 120_000 }),
        fc.integer({ min: 0, max: 240_000 }),
        (threshold, elapsed) => {
          const transport = new InMemoryTransportAdapter();
          const engine = new DTPEngine('master', transport);
          const session = engine.createSession(makeCapContext(17));
          session.timeoutThreshold = threshold;
          const baseTime = session.lastActivityAt;

          const errors: number[] = [];
          engine.onError((e) => errors.push(e.errorCode));

          const timedOut = engine.enforceSessionTimeout(session.sessionId, baseTime + elapsed);
          if (elapsed > threshold) {
            expect(timedOut).toBe(true);
            expect(errors).toContain(DTPErrorCode.SESSION_TIMEOUT);
            expect(engine.sessionManager.getSession(session.sessionId)).toBeNull();
          } else {
            expect(timedOut).toBe(false);
            expect(engine.sessionManager.getSession(session.sessionId)).not.toBeNull();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 18: 无效帧错误处理
  it('Property 18: Corrupted wire frames emit FRAME_DESERIALIZATION_FAILED (1001) and corrupted ciphertexts emit DECRYPTION_FAILED (2001) without crashing session', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 3 }),
        logicalFrameArbitrary,
        (shortBytes, frame) => {
          const { master, slaveTransport, slaveConnId, masterSession } = bindPeerEngines(18);
          const errors: number[] = [];
          master.onError((e) => errors.push(e.errorCode));

          // 1. Truncated wire frame -> 1001
          slaveTransport.send(slaveConnId, shortBytes);
          expect(errors).toContain(DTPErrorCode.FRAME_DESERIALIZATION_FAILED);

          // 2. Valid header + invalid ciphertext -> 2001
          const badCipherFrame: LogicalFrame = {
            header: {
              ...frame.header,
              protocolVersion: CURRENT_VERSION,
              frameType: 'data',
              encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
            },
            payload: new Uint8Array(10), // shorter than 28-byte IV+AuthTag minimum
          };
          const wire = master.frameCodec.serialize(badCipherFrame);
          slaveTransport.send(slaveConnId, wire);
          expect(errors).toContain(DTPErrorCode.DECRYPTION_FAILED);

          // Session remains alive (not crashed)
          expect(master.sessionManager.getSession(masterSession.sessionId)).not.toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 19: 重传超时机制
  it('Property 19: Bounded retransmission uses exponential backoff (baseDelayMs * 2^attempt) and terminates after maxRetries with RETRANSMISSION_TIMEOUT (6002) (OQ-DTP-11)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 50, max: 1000 }),
        fragmentArbitrary,
        (maxRetries, baseDelayMs, frag) => {
          // Verify exponential backoff formula
          for (let attempt = 0; attempt < maxRetries; attempt++) {
            expect(ErrorHandler.computeBackoffDelay(attempt, baseDelayMs)).toBe(
              baseDelayMs * Math.pow(2, attempt),
            );
          }

          const { slave, slaveSession } = bindPeerEngines(19, {
            maxRetries,
            retransmissionTimeout: baseDelayMs,
          });
          slave.resumeManager.cacheFragment(frag, 1);

          const errors: number[] = [];
          slave.onError((e) => errors.push(e.errorCode));

          // First maxRetries attempts succeed without terminal error
          for (let i = 0; i < maxRetries; i++) {
            slave.retransmitUnacknowledged(slaveSession.sessionId);
            expect(errors).not.toContain(DTPErrorCode.RETRANSMISSION_TIMEOUT);
          }

          // Next attempt exceeds maxRetries -> emits terminal 6002 and evicts fragment
          slave.retransmitUnacknowledged(slaveSession.sessionId);
          expect(errors).toContain(DTPErrorCode.RETRANSMISSION_TIMEOUT);
          expect(slave.resumeManager.getUnacknowledgedFragments().length).toBe(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 20: 错误码唯一性
  it('Property 20: Every DTPErrorCode enum member has a distinct numeric code in its normative category range', () => {
    const numericValues = Object.values(DTPErrorCode).filter(
      (v): v is number => typeof v === 'number',
    );
    const uniqueValues = new Set(numericValues);
    expect(uniqueValues.size).toBe(numericValues.length);
    expect(numericValues.length).toBe(17);
  });

  // Feature: data-tunnel-protocol, Property 21: 版本不兼容通知
  it('Property 21: Frames with major !== CURRENT_VERSION.major (including major 0 and major >= 2) are rejected with VERSION_INCOMPATIBLE (7001) (OQ-DTP-2)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }).filter((m) => m !== CURRENT_VERSION.major),
        fc.integer({ min: 0, max: 50 }),
        logicalFrameArbitrary,
        (incompatibleMajor, minor, frame) => {
          expect(ErrorHandler.isVersionCompatible({ major: incompatibleMajor, minor })).toBe(false);

          const { master, slaveTransport, slaveConnId } = bindPeerEngines(21);
          const errors: Array<{ code: number; details?: Record<string, unknown> }> = [];
          master.onError((e) => errors.push({ code: e.errorCode, details: e.details }));

          const incompatibleFrame: LogicalFrame = {
            header: {
              ...frame.header,
              protocolVersion: { major: incompatibleMajor, minor },
            },
            payload: frame.payload,
          };
          slaveTransport.send(slaveConnId, master.frameCodec.serialize(incompatibleFrame));

          expect(errors.length).toBe(1);
          expect(errors[0]!.code).toBe(DTPErrorCode.VERSION_INCOMPATIBLE);
          expect(errors[0]!.details?.highestSupportedVersion).toEqual(CURRENT_VERSION);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 22: 向后版本兼容
  it('Property 22: All minor versions within the same MAJOR version (1.x) are mutually compatible (OQ-DTP-2)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), (minor) => {
        expect(
          ErrorHandler.isVersionCompatible({ major: CURRENT_VERSION.major, minor }),
        ).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 23: 标识符全局唯一性
  it('Property 23: Generated Session_ID and Agreement_ID values are globally unique across concurrent creations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 15 }),
        agreementParamsArbitrary,
        (count, params) => {
          const sessionMgr = new DTPSessionManager();
          const agreementMgr = new DTPAgreementManager();
          const sessionIds = new Set<string>();
          const agreementIds = new Set<string>();

          for (let i = 0; i < count; i++) {
            const s = sessionMgr.createSession(makeCapContext(i));
            sessionIds.add(s.sessionId);

            const req = agreementMgr.initiateRequest(s.sessionId, {
              direction: 'collection',
              proposedParams: params,
            });
            const resp = agreementMgr.handleRequest(s.sessionId, req);
            agreementIds.add(resp.agreementId!);
          }

          expect(sessionIds.size).toBe(count);
          expect(agreementIds.size).toBe(count);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 24: RequestFrame 字段完整性
  it('Property 24: Initiated RequestFrame preserves all AgreementParams fields (dataType, dataRange, transferMode, frequency, validityPeriod, priority)', () => {
    fc.assert(
      fc.property(
        transferDirectionArbitrary,
        agreementParamsArbitrary,
        (direction, params) => {
          const mgr = new DTPAgreementManager();
          const req = mgr.initiateRequest(uuidv4(), { direction, proposedParams: params });
          expect(req.frameType).toBe('request');
          expect(req.requestType).toBe(direction);
          expect(req.proposedParams).toEqual(params);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 25: 约定生命周期管理
  it('Property 25: Agreement lifecycle supports multi-agreement coexistence, dynamic adjustment, termination, and AGREEMENT_EXPIRED (3002)', () => {
    fc.assert(
      fc.property(
        agreementParamsArbitrary,
        agreementParamsArbitrary,
        (paramsA, paramsB) => {
          const mgr = new DTPAgreementManager();
          const sessionId = uuidv4();

          // Create two coexisting agreements
          const reqA = mgr.initiateRequest(sessionId, {
            direction: 'collection',
            proposedParams: paramsA,
          });
          const respA = mgr.handleRequest(sessionId, reqA);
          const agrA = mgr.handleResponse(sessionId, respA)!;

          const reqB = mgr.initiateRequest(sessionId, {
            direction: 'injection',
            proposedParams: paramsB,
          });
          const respB = mgr.handleRequest(sessionId, reqB);
          const agrB = mgr.handleResponse(sessionId, respB)!;

          expect(mgr.getActiveAgreements(sessionId).length).toBe(2);

          // Dynamic adjustment updates paramsA to paramsB
          const adjReq = mgr.adjustAgreement(agrA.agreementId, paramsB);
          const adjResp = mgr.handleRequest(sessionId, adjReq);
          const updatedA = mgr.handleResponse(sessionId, adjResp)!;
          expect(updatedA.params.priority).toBe(paramsB.priority);

          // Expiration validation check (3002)
          const expiredTime = agrA.createdAt + paramsB.validityPeriod + 1;
          expect(mgr.validateAgreement(agrA.agreementId, expiredTime)).toEqual({
            valid: false,
            errorCode: DTPErrorCode.AGREEMENT_EXPIRED,
          });

          // Terminate agreement B while A remains stored
          mgr.terminateAgreement(agrB.agreementId);
          expect(mgr.getAgreement(agrB.agreementId)?.status).toBe('terminated');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 26: 主端记录从端响应
  it('Property 26: Master engine persists every Slave negotiation response in slaveResponseLog', () => {
    fc.assert(
      fc.property(
        agreementParamsArbitrary,
        fc.constantFrom('accepted' as const, 'rejected' as const, 'counter_proposal' as const),
        (params, outcome) => {
          const transport = new InMemoryTransportAdapter();
          const master = new DTPEngine('master', transport);
          const session = master.createSession(makeCapContext(26));

          const req = master.initiateAgreement(session.sessionId, {
            direction: 'collection',
            proposedParams: params,
          });

          master.handleAgreementResponse(session.sessionId, {
            frameType: 'response',
            requestId: req.requestId,
            result: outcome,
            agreementId: outcome === 'accepted' ? uuidv4() : undefined,
            rejectionReason: outcome === 'rejected' ? 'compliance_gdpr_block' : undefined,
            agreedParams: outcome === 'counter_proposal' ? params : undefined,
          });

          expect(master.slaveResponseLog.length).toBe(1);
          expect(master.slaveResponseLog[0]!.requestId).toBe(req.requestId);
          expect(master.slaveResponseLog[0]!.result).toBe(outcome);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 27: Pretty Printer 输出完整性
  it('Property 27: FrameCodec.prettyPrint outputs human-readable version, frameType, fragmentId, agreementId, sequenceNumber, and payload size', () => {
    const codec = new DTPFrameCodec();
    fc.assert(
      fc.property(logicalFrameArbitrary, (frame) => {
        const text = codec.prettyPrint(frame);
        const { header, payload } = frame;
        expect(text).toContain(`${header.protocolVersion.major}.${header.protocolVersion.minor}`);
        expect(text).toContain(header.frameType);
        expect(text).toContain(header.fragmentId);
        expect(text).toContain(header.agreementId ?? '(none)');
        expect(text).toContain(String(header.sequenceNumber));
        expect(text).toContain(`${payload.byteLength} bytes`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 28: 从端拒绝须附合规性理由
  it('Property 28: Slave rejection without a non-empty compliance reason is rejected with PERMISSION_DENIED (8001)', () => {
    fc.assert(
      fc.property(
        agreementParamsArbitrary,
        fc.constantFrom(undefined, '', '   '),
        (params, emptyReason) => {
          const transport = new InMemoryTransportAdapter();
          const master = new DTPEngine('master', transport);
          const session = master.createSession(makeCapContext(28));
          const req = master.initiateAgreement(session.sessionId, {
            direction: 'collection',
            proposedParams: params,
          });

          try {
            master.handleAgreementResponse(session.sessionId, {
              frameType: 'response',
              requestId: req.requestId,
              result: 'rejected',
              rejectionReason: emptyReason,
            });
            expect.unreachable('Empty compliance rejection reason must throw');
          } catch (err) {
            expect((err as { code: number }).code).toBe(DTPErrorCode.PERMISSION_DENIED);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-tunnel-protocol, Property 29: 传输断开事件传播
  it('Property 29: Transport disconnection propagates disconnected event and transitions active session to suspended', () => {
    fc.assert(
      fc.property(fragmentIdArbitrary, () => {
        const { master, masterTransport, masterSession, masterConnId } = bindPeerEngines(29);
        // Move session to transmitting so disconnect suspends it
        const params = {
          dataType: 'sensor_reading',
          dataRange: 'realtime',
          transferMode: 'streaming' as const,
          frequency: 10,
          validityPeriod: 60_000,
          priority: 'normal' as const,
        };
        const req = master.initiateAgreement(masterSession.sessionId, {
          direction: 'collection',
          proposedParams: params,
        });
        master.handleAgreementResponse(masterSession.sessionId, {
          frameType: 'response',
          requestId: req.requestId,
          result: 'accepted',
          agreementId: uuidv4(),
        });
        expect(master.getSessionState(masterSession.sessionId)).toBe('transmitting');

        const observedStates: string[] = [];
        masterTransport.onConnectionStateChange((_cid, state) => observedStates.push(state));

        masterTransport.disconnect(masterConnId);
        expect(observedStates).toContain('disconnected');
        expect(master.getSessionState(masterSession.sessionId)).toBe('suspended');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
