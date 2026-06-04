# Chapter 4 Logical Frame Structure

## 4.1 Overall Structure

A LogicalFrame **MUST** consist of two parts:

```
+----------------+
|     Header     |   (plaintext)
+----------------+
|     Payload    |   (encrypted)
+----------------+
```

Formal definition of LogicalFrame:

```typescript
interface LogicalFrame {
  header: FrameHeader;
  payload: Uint8Array;  // encrypted
}
```

## 4.2 FrameHeader

The frame header **MUST** contain the following fields. The order in the table below is the normative order:

| Field | Type | Required | Encrypted | Description |
|-------|------|----------|-----------|-------------|
| `protocolVersion` | `ProtocolVersion` | **REQUIRED** | No | Protocol version |
| `frameType` | `FrameType` | **REQUIRED** | No | Frame type |
| `fragmentId` | `FragmentID` | **REQUIRED** | No | Unique Fragment identifier |
| `agreementId` | `AgreementID \| null` | **REQUIRED** | No | Agreement ID (**MAY** be null) |
| `originTimestamp` | `OriginTimestamp` | **REQUIRED** | No | Origin timestamp (UTC ms) |
| `dagDependencies` | `DAGEdge[]` | **REQUIRED** | No | DAG dependency list (**MAY** be empty array) |
| `encryptionMetadata` | `EncryptionMetadata` | **REQUIRED** | No | Encryption metadata |
| `sequenceNumber` | `SequenceNumber` | **REQUIRED** | No | Transmission sequence number |

The frame header **MUST NOT** be encrypted. All fields **MUST** be transmitted in plaintext.

## 4.3 FrameType

`FrameType` **MUST** be one of the following four enumerated values:

| Value | Purpose | Payload Content |
|-------|---------|-----------------|
| `"data"` | Carries actual Fragment data | The `data` field of a Fragment |
| `"request"` | Initiates a data request or adjusts a transmission Agreement | The serialized content of a RequestFrame |
| `"response"` | Replies to a data request | The serialized content of a ResponseFrame |
| `"control"` | Conveys control information such as error notifications and Agreement termination | The serialized content of a ControlFrame |

An implementation **MUST NOT** introduce frame types not listed.

## 4.4 ProtocolVersion

`ProtocolVersion` **MUST** consist of two non-negative integers:

```typescript
interface ProtocolVersion {
  major: number;
  minor: number;
}
```

Version number semantics and the change classification rule **MUST** comply with the rules defined in Chapter 1 §1.7.2 (the authoritative source).

## 4.5 Agreement_ID Compression

The `agreementId` field **MAY** be `null` for compression purposes. The compression rules **MUST** comply with the following requirements:

1. Within a batch of consecutive Fragments belonging to the same Agreement, **only** the first Fragment's frame header **MUST** carry the full Agreement_ID.
2. The `agreementId` field of subsequent Fragments **MAY** be set to `null`, indicating reuse of the most recent non-null Agreement_ID.
3. The receiver **MUST** maintain a "current context Agreement_ID" and interpret it according to the following rules:
   - When a Fragment with non-null `agreementId` is received, its value **MUST** be updated as the current context Agreement_ID.
   - When a Fragment with `agreementId` set to null is received, it **MUST** be associated with the current context Agreement_ID.
4. If the receiver receives a Fragment with `agreementId` set to null while the current context Agreement_ID is also null, it **MUST** drop the Fragment and return the `AGREEMENT_NOT_FOUND` error (3001).
5. If the receiver receives a Fragment referencing an unknown Agreement_ID, it **MUST** drop the Fragment and return the `AGREEMENT_NOT_FOUND` error (3001).

The receiver's current context Agreement_ID **MUST** be maintained independently for each transmission direction.

## 4.6 Origin_Timestamp

`originTimestamp` **MUST** satisfy:

1. **MUST** use the UTC time zone.
2. **MUST** carry millisecond precision.
3. **MUST** be a non-negative integer (Unix timestamp in milliseconds).
4. **MUST** record the instant at which the data was actually produced at the source, and **MUST NOT** record the transmission time.
5. After traversing the complete transmission chain (serialization → encryption → transmission → decryption → deserialization), it **MUST** be exactly the same as before sending.
6. The receiver **MUST NOT** modify the received Origin_Timestamp.

## 4.7 DAG Dependencies (DAGEdge)

`DAGEdge` **MUST** contain the following fields:

```typescript
interface DAGEdge {
  targetFragmentId: FragmentID;
  relationType: DAGRelationType;
}
```

`DAGRelationType` **MUST** be one of the following three enumerated values:

| Value | Semantics |
|-------|-----------|
| `"derived_from"` | This Fragment is derived from the target Fragment |
| `"annotates"` | This Fragment annotates/explains the target Fragment |
| `"supersedes"` | This Fragment supersedes the target Fragment |

The `dagDependencies` array **MAY** be empty (i.e. the Fragment has no dependencies).

## 4.8 EncryptionMetadata

`EncryptionMetadata` **MUST** contain the following fields:

```typescript
interface EncryptionMetadata {
  algorithm: string;
  keyVersion: number;
}
```

| Field | Normative Requirement |
|-------|------------------------|
| `algorithm` | **MUST** be the identifier string of the encryption algorithm (e.g. `"AES-256-GCM"`). **SHOULD** use IANA-registered algorithm names |
| `keyVersion` | **MUST** be a non-negative integer. Used to support key rotation |

The encryption metadata itself **MUST NOT** be encrypted, and **MUST** be included in plaintext form within the frame header.

## 4.9 Sequence_Number

`sequenceNumber` **MUST** satisfy:

1. **MUST** be a non-negative integer.
2. **MUST** be monotonically increasing within a single Session.
3. **MUST** be maintained independently for each transmission direction (data collection, data injection).
4. The sequence number space **MUST NOT** be shared between the two directions.
5. **SHOULD** start from 0 or 1.
6. If the sequence number overflows (an implementation-defined maximum value), the implementation **MUST** handle it by establishing a new Session, and **MUST NOT** wrap around.

## 4.10 Fragment Structure

A Fragment **MUST** contain the following fields:

```typescript
interface Fragment {
  fragmentId: FragmentID;
  agreementId: AgreementID;
  originTimestamp: OriginTimestamp;
  contextMetadata: ContextMetadata;
  dagDependencies: DAGEdge[];
  data: Uint8Array;
}
```

Note: When a Fragment's `agreementId` field is serialized into a LogicalFrame, it may appear as null in the LogicalFrame header due to compression rules (see Section 4.5), but the logical `agreementId` of the Fragment itself **MUST** always be non-null.

## 4.11 ContextMetadata

`ContextMetadata` **MUST** contain the following fields:

```typescript
interface ContextMetadata {
  dataType: string;
  source: DataSource;
  customFields: Record<string, unknown>;
}
```

`DataSource` **MUST** be one of the following two structures (a discriminated union distinguished by the `kind` field):

### 4.11.1 HardwareSource

When data originates from a hardware sensor, `source` **MUST** be:

```typescript
interface HardwareSource {
  kind: "hardware";
  sensorType: string;
  precision: string;
  samplingRate: number;
}
```

| Field | Normative Requirement |
|-------|------------------------|
| `kind` | **MUST** be the literal string `"hardware"` |
| `sensorType` | **MUST** be a non-empty string. **SHOULD** use standardized naming (e.g. `"accelerometer"`, `"heart_rate_monitor"`) |
| `precision` | **MUST** be a non-empty string describing the sensor precision (e.g. `"±0.1°C"`) |
| `samplingRate` | **MUST** be a positive number, in Hz |

### 4.11.2 SoftwareSource

When data originates from software sharing, `source` **MUST** be:

```typescript
interface SoftwareSource {
  kind: "software";
  appIdentifier: string;
  sharingMethod: string;
}
```

| Field | Normative Requirement |
|-------|------------------------|
| `kind` | **MUST** be the literal string `"software"` |
| `appIdentifier` | **MUST** be a non-empty string. **SHOULD** use reverse domain-name notation (e.g. `"com.example.app"`) |
| `sharingMethod` | **MUST** be a non-empty string describing the sharing method (e.g. `"api_push"`, `"clipboard_capture"`) |

### 4.11.3 Custom Fields

`customFields` **MUST** be a map from string to arbitrary value, and **MAY** be the empty object `{}`. An implementation **MUST NOT** repeat information already present in `dataType` or `source` within `customFields`.

## 4.12 Serialization Requirements

The serialization of a LogicalFrame **MUST** satisfy the following normative requirements:

1. **Determinism**: The same LogicalFrame object **MUST** produce the same binary output.
2. **Round-trip consistency**: For any valid LogicalFrame, serializing and then deserializing **MUST** produce a LogicalFrame equivalent to the original object.
3. **Completeness**: The serialized output **MUST** contain all fields of the frame header.
4. **Payload encryption**: Before serialization, the Payload **MUST** already be encrypted using the algorithm specified in EncryptionMetadata.

The concrete binary layout of serialization (byte order, field encoding) will be specified in subsequent drafts; mature binary formats such as CBOR (RFC 8949) or Protocol Buffers **SHOULD** be preferred.

## 4.13 Physical Fragmentation

When the underlying transport requires fragmentation (e.g. due to BLE MTU limits):

1. The fragmentation operation **MUST** be performed by the Transport_Adapter.
2. The LogicalFrame **MUST** remain whole at the DTP_Engine layer.
3. The receiver's Transport_Adapter **MUST** reassemble the complete LogicalFrame before passing it to the DTP_Engine.
