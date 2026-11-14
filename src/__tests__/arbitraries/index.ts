/**
 * Custom fast-check Arbitrary generators for DTP types.
 * Used across all property-based tests.
 */
import fc from 'fast-check';
import type { LogicalFrame, FrameHeader, FrameType, ProtocolVersion, FragmentID, AgreementID, OriginTimestamp, SequenceNumber, SessionID } from '../../types/frame.js';
import type { DAGEdge, DAGRelationType } from '../../types/dag.js';
import type { EncryptionMetadata } from '../../types/encryption.js';
import type { ContextMetadata, HardwareSource, SoftwareSource, DataSource } from '../../types/context-metadata.js';
import type { Fragment } from '../../types/fragment.js';
import type { AgreementParams, TransferMode, Priority, AgreementStatus, TransferDirection, Agreement } from '../../types/agreement.js';
import type { Session, SessionState, DirectionalTransferState } from '../../types/session.js';

// ─── Primitive Generators ───

/** Generate a UUID v4 string */
export const uuidArbitrary: fc.Arbitrary<string> = fc.uuid();

/** Generate a FragmentID (UUID v4) */
export const fragmentIdArbitrary: fc.Arbitrary<FragmentID> = fc.uuid();

/** Generate an AgreementID (UUID v4) */
export const agreementIdArbitrary: fc.Arbitrary<AgreementID> = fc.uuid();

/** Generate a SessionID (UUID v4) */
export const sessionIdArbitrary: fc.Arbitrary<SessionID> = fc.uuid();

/** Generate an OriginTimestamp (UTC milliseconds) */
export const originTimestampArbitrary: fc.Arbitrary<OriginTimestamp> = fc.integer({ min: 0, max: 2_000_000_000_000 });

/** Generate a SequenceNumber (non-negative integer) */
export const sequenceNumberArbitrary: fc.Arbitrary<SequenceNumber> = fc.integer({ min: 0, max: 1_000_000 });

/** Generate a ProtocolVersion */
export const protocolVersionArbitrary: fc.Arbitrary<ProtocolVersion> = fc.record({
  major: fc.integer({ min: 0, max: 10 }),
  minor: fc.integer({ min: 0, max: 99 }),
});

/** Generate a FrameType */
export const frameTypeArbitrary: fc.Arbitrary<FrameType> = fc.constantFrom('data', 'request', 'response', 'control');

/** Generate a DAGRelationType */
export const dagRelationTypeArbitrary: fc.Arbitrary<DAGRelationType> = fc.constantFrom('derived_from', 'annotates', 'supersedes');

/** Generate a TransferMode */
export const transferModeArbitrary: fc.Arbitrary<TransferMode> = fc.constantFrom('one_time', 'periodic', 'streaming');

/** Generate a Priority */
export const priorityArbitrary: fc.Arbitrary<Priority> = fc.constantFrom('low', 'normal', 'high', 'critical');

/** Generate an AgreementStatus */
export const agreementStatusArbitrary: fc.Arbitrary<AgreementStatus> = fc.constantFrom('negotiating', 'active', 'suspended', 'terminated');

/** Generate a TransferDirection */
export const transferDirectionArbitrary: fc.Arbitrary<TransferDirection> = fc.constantFrom('collection', 'injection');

/** Generate a SessionState */
export const sessionStateArbitrary: fc.Arbitrary<SessionState> = fc.constantFrom('idle', 'waiting_for_cap', 'established', 'negotiating', 'transmitting', 'suspended', 'resuming');

/** Generate EncryptionMetadata */
export const encryptionMetadataArbitrary: fc.Arbitrary<EncryptionMetadata> = fc.record({
  algorithm: fc.constantFrom('AES-256-GCM', 'AES-128-GCM', 'ChaCha20-Poly1305'),
  keyVersion: fc.integer({ min: 1, max: 100 }),
});

// ─── DAG Generators ───

/** Generate a single DAGEdge */
export const dagEdgeArbitrary: fc.Arbitrary<DAGEdge> = fc.record({
  targetFragmentId: fragmentIdArbitrary,
  relationType: dagRelationTypeArbitrary,
});


/**
 * Generate a list of DAGEdge[] that form a valid DAG (no cycles).
 * Strategy: generate a set of node IDs, then only create edges from
 * higher-indexed nodes to lower-indexed nodes (topological ordering),
 * which guarantees acyclicity.
 */
export const dagArbitrary: fc.Arbitrary<DAGEdge[]> = fc
  .array(fragmentIdArbitrary, { minLength: 2, maxLength: 8 })
  .chain((nodeIds) => {
    // Unique node IDs form a topological order by their array index.
    // Edges only go from a higher index to a lower index → no cycles.
    const uniqueIds = [...new Set(nodeIds)];
    if (uniqueIds.length < 2) {
      return fc.constant([] as DAGEdge[]);
    }
    // For each node (except the first), optionally create an edge to a preceding node
    const edgeArbitraries = uniqueIds.slice(1).map((_, idx) => {
      const sourceIdx = idx + 1;
      return fc.tuple(
        fc.boolean(), // whether to include this edge
        fc.integer({ min: 0, max: sourceIdx - 1 }), // target index (always < source)
        dagRelationTypeArbitrary,
      ).map(([include, targetIdx, relationType]): DAGEdge | null => {
        if (!include) return null;
        return {
          targetFragmentId: uniqueIds[targetIdx],
          relationType,
        };
      });
    });
    return fc.tuple(...edgeArbitraries).map((edges) =>
      edges.filter((e): e is DAGEdge => e !== null)
    );
  });

// ─── ContextMetadata Generators ───

/** Generate a HardwareSource */
export const hardwareSourceArbitrary: fc.Arbitrary<HardwareSource> = fc.record({
  kind: fc.constant('hardware' as const),
  sensorType: fc.constantFrom('accelerometer', 'gyroscope', 'gps', 'temperature', 'heart_rate', 'barometer'),
  precision: fc.constantFrom('high', 'medium', 'low', '0.01', '0.001'),
  samplingRate: fc.integer({ min: 1, max: 1000 }),
});

/** Generate a SoftwareSource */
export const softwareSourceArbitrary: fc.Arbitrary<SoftwareSource> = fc.record({
  kind: fc.constant('software' as const),
  appIdentifier: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', '.', '-', '0', '1'), { minLength: 3, maxLength: 30 }),
  sharingMethod: fc.constantFrom('clipboard', 'intent', 'api_call', 'file_export', 'direct_share'),
});

/** Generate a DataSource (randomly hardware or software) */
export const dataSourceArbitrary: fc.Arbitrary<DataSource> = fc.oneof(
  hardwareSourceArbitrary,
  softwareSourceArbitrary,
);

/** Generate random custom fields */
const customFieldsArbitrary: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', '_'), { minLength: 1, maxLength: 10 }),
  fc.oneof(
    fc.string({ maxLength: 20 }),
    fc.integer(),
    fc.boolean(),
  ),
  { minKeys: 0, maxKeys: 3 },
);

/** Generate a ContextMetadata (randomly hardware or software source) */
export const contextMetadataArbitrary: fc.Arbitrary<ContextMetadata> = fc.record({
  dataType: fc.constantFrom('sensor_reading', 'user_input', 'app_state', 'location', 'biometric', 'media'),
  source: dataSourceArbitrary,
  customFields: customFieldsArbitrary,
});

// ─── Fragment Generator ───

/** Generate a random Fragment with 0-3 DAG dependencies */
export const fragmentArbitrary: fc.Arbitrary<Fragment> = fc.record({
  fragmentId: fragmentIdArbitrary,
  agreementId: agreementIdArbitrary,
  originTimestamp: originTimestampArbitrary,
  contextMetadata: contextMetadataArbitrary,
  dagDependencies: fc.array(dagEdgeArbitrary, { minLength: 0, maxLength: 3 }),
  data: fc.uint8Array({ minLength: 0, maxLength: 256 }),
});

// ─── Agreement Generators ───

/** Generate random AgreementParams (covering all transfer modes and priorities) */
export const agreementParamsArbitrary: fc.Arbitrary<AgreementParams> = transferModeArbitrary.chain(
  (mode) =>
    fc.record({
      dataType: fc.constantFrom('sensor_reading', 'user_input', 'app_state', 'location', 'biometric'),
      dataRange: fc.constantFrom('last_24h', 'last_7d', 'all', 'realtime', 'specific_range'),
      transferMode: fc.constant(mode),
      frequency: mode === 'one_time' ? fc.constant(null) : fc.integer({ min: 1, max: 100 }),
      validityPeriod: fc.integer({ min: 1000, max: 86_400_000 }),
      priority: priorityArbitrary,
    }),
);

/** Generate a random Agreement */
export const agreementArbitrary: fc.Arbitrary<Agreement> = fc.record({
  agreementId: agreementIdArbitrary,
  sessionId: sessionIdArbitrary,
  direction: transferDirectionArbitrary,
  initiator: fc.constantFrom('master' as const, 'slave' as const),
  params: agreementParamsArbitrary,
  status: agreementStatusArbitrary,
  createdAt: originTimestampArbitrary,
});

// ─── LogicalFrame Generator ───

/** Generate a FrameHeader */
export const frameHeaderArbitrary: fc.Arbitrary<FrameHeader> = fc.record({
  protocolVersion: protocolVersionArbitrary,
  frameType: frameTypeArbitrary,
  fragmentId: fragmentIdArbitrary,
  agreementId: fc.oneof(agreementIdArbitrary, fc.constant(null)),
  originTimestamp: originTimestampArbitrary,
  dagDependencies: fc.array(dagEdgeArbitrary, { minLength: 0, maxLength: 3 }),
  encryptionMetadata: encryptionMetadataArbitrary,
  sequenceNumber: sequenceNumberArbitrary,
});

/** Generate a random valid LogicalFrame (covering all 4 frame types) */
export const logicalFrameArbitrary: fc.Arbitrary<LogicalFrame> = fc.record({
  header: frameHeaderArbitrary,
  payload: fc.uint8Array({ minLength: 0, maxLength: 512 }),
});

// ─── Session Generator ───

/** Generate a DirectionalTransferState */
export const directionalTransferStateArbitrary: fc.Arbitrary<DirectionalTransferState> = fc
  .tuple(
    sequenceNumberArbitrary,
    sequenceNumberArbitrary,
  )
  .map(([seq, ack]) => ({
    currentSequenceNumber: Math.max(seq, ack),
    highestAcknowledgedSequenceNumber: Math.min(seq, ack),
    unacknowledgedFragmentCache: new Map<SequenceNumber, Fragment>(),
  }));

/** Generate a random Session (covering all session states) */
export const sessionArbitrary: fc.Arbitrary<Session> = fc.record({
  sessionId: sessionIdArbitrary,
  masterIdentity: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', '0', '1', '2', '-'), { minLength: 5, maxLength: 20 }),
  slaveIdentity: fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', '0', '1', '2', '-'), { minLength: 5, maxLength: 20 }),
  state: sessionStateArbitrary,
  activeAgreements: fc.constant(new Map<AgreementID, Agreement>()),
  collectionState: directionalTransferStateArbitrary,
  injectionState: directionalTransferStateArbitrary,
  createdAt: originTimestampArbitrary,
  lastActivityAt: originTimestampArbitrary,
  timeoutThreshold: fc.integer({ min: 5000, max: 300_000 }),
});
