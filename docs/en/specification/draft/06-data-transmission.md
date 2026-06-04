# Chapter 6 Data Transmission

## 6.1 Bidirectional Data Flow

A DTP implementation **MUST** support the following two independent data flow directions:

| Direction | Name | Sender | Receiver |
|-----------|------|--------|----------|
| Terminal → Fay | Data Collection | Slave | Master |
| Fay → Terminal | Data Injection | Master | Slave |

Both directions **MUST** satisfy:

1. Use the same LogicalFrame format and processing flow.
2. Maintain independent sequence number spaces.
3. Maintain independent resume state (unacknowledged Fragment cache, highest acknowledged sequence number, etc.).
4. Be mutually non-interfering: state changes in one direction **MUST NOT** affect the other direction.

## 6.2 Data Collection Workflow (Terminal → Fay)

Data collection **MUST** follow this workflow:

### 6.2.1 Sender (DTP_Slave) Workflow

1. Receive the data submitted by the terminal application.
2. Build the Fragment:
   a. Generate a new Fragment_ID (UUID v4).
   b. Set `agreementId` to the Agreement_ID of the current active Agreement.
   c. Set `originTimestamp` to the UTC millisecond timestamp at which the data was **actually produced**. **MUST NOT** use the current instant.
   d. Attach structured ContextMetadata (see Section 4.11).
   e. Attach `dagDependencies` (**MAY** be an empty array).
3. Validate DAG dependencies:
   a. Invoke the DAG Manager to verify that no cycle would be formed (see Section 6.7).
   b. If a cycle is detected, **MUST** reject the Fragment and return the `DAG_CYCLE_DETECTED` error (4001).
4. Build the LogicalFrame:
   a. Set `frameType = "data"`.
   b. Apply Agreement_ID compression rules (see Section 4.5).
   c. Assign a monotonically increasing `sequenceNumber` (data collection direction).
   d. Set the encryption metadata.
5. Encrypt the Payload: encrypt the Fragment's `data` field using the key pre-negotiated by CAP.
6. Serialize the LogicalFrame.
7. Invoke the Transport_Adapter to send the binary data.
8. Add the Fragment to the unacknowledged cache (see Section 8.2).

### 6.2.2 Receiver (DTP_Master) Workflow

1. Receive the binary data delivered by the Transport_Adapter.
2. Deserialize into a LogicalFrame. If it fails, the frame **MUST** be discarded and the `FRAME_DESERIALIZATION_FAILED` error (1001) **MUST** be returned.
3. Validate the protocol version (see Chapter 10).
4. Parse the Agreement_ID (apply the compression rules in Section 4.5). If associated with an unknown Agreement, the frame **MUST** be discarded and the `AGREEMENT_NOT_FOUND` error (3001) **MUST** be returned.
5. Decrypt the Payload. If it fails, the frame **MUST** be discarded and the `DECRYPTION_FAILED` error (2001) **MUST** be returned.
6. Deserialize into a Fragment.
7. Validate DAG dependencies:
   a. If all target dependencies already exist, **MUST** accept and mark as `accepted`.
   b. If some target dependencies have not yet arrived, **MUST** mark as `pending` and cache (see Section 6.7).
   c. If a cycle is detected, **MUST** reject and return the `DAG_CYCLE_DETECTED` error (4001).
8. Update the receive state: set the Fragment's sequenceNumber as the highest received sequence number for that direction (if it advances).
9. Send an acknowledgment (see Chapter 8).
10. Persist the Fragment into the Personal Data Heap.

## 6.3 Data Injection Workflow (Fay → Terminal)

Data injection **MUST** follow this workflow:

### 6.3.1 Sender (DTP_Master) Workflow

1. Query the Personal Data Heap and filter the data per the Agreement's `dataRange` to produce a minimized data set.
2. Build the Fragment (same as steps 2-3 of Section 6.2.1).
3. Build the LogicalFrame, encrypt the Payload, serialize, and send (same as steps 4-8 of Section 6.2.1), but use the data injection direction's sequence number space.

### 6.3.2 Receiver (DTP_Slave) Workflow

1. Deserialize, validate version, parse Agreement_ID, decrypt, deserialize Fragment, validate DAG (same as steps 1-7 of Section 6.2.2).
2. Update the receive state and send an acknowledgment (same as steps 8-9 of Section 6.2.2).
3. Deliver the Fragment to the terminal application.

## 6.4 Agreement_ID Compression in Transmission

An implementation **MUST** strictly follow the Agreement_ID compression rules defined in Section 4.5.

### 6.4.1 Compression Example

The following is a transmission sequence that complies with the specification:

```
Fragment 1: agreementId = "abc-123"   (new Agreement, full ID)
Fragment 2: agreementId = null        (reuse "abc-123")
Fragment 3: agreementId = null        (reuse "abc-123")
Fragment 4: agreementId = "def-456"   (switch to a new Agreement, full ID)
Fragment 5: agreementId = null        (reuse "def-456")
```

### 6.4.2 Compression Constraints

An implementation **MUST** satisfy:

1. **MAY** choose not to compress (i.e. all Fragments carry the full Agreement_ID).
2. If compression is chosen, **MUST** strictly follow Section 4.5.
3. The receiver **MUST** support both compressed and uncompressed modes.
4. The context Agreement_ID **MUST** be reset to null after a Session is suspended and resumed (i.e. the first Fragment after resumption **MUST** carry the full ID).

## 6.5 Sequence Number Management

### 6.5.1 Monotonic Increase

The `sequenceNumber` of every Fragment **MUST** satisfy:

1. Be monotonically increasing within a single Session.
2. **SHOULD** be strictly contiguous (i.e. increment by 1 each time).
3. **MUST NOT** repeat or regress.

### 6.5.2 Per-Direction Independence

The data collection direction and the data injection direction **MUST** maintain independent sequence number spaces:

```
Data collection direction (collection):  seq 1, 2, 3, 4, 5, ...
Data injection direction (injection):    seq 1, 2, 3, 4, 5, ...
```

An implementation **MUST NOT** share the sequence number space between the two directions.

### 6.5.3 Restart and Sessions

Sequence numbers **MUST** satisfy:

1. The sequence number **MUST** be reset when a new Session begins (**SHOULD** start from 0 or 1).
2. When a Session is restored from `Suspended`, the sequence number **MUST** retain its value before suspension and **MUST NOT** be reset.
3. If the sequence number approaches the implementation-defined maximum, the sender **MUST** proactively establish a new Session to avoid overflow.

## 6.6 Origin Timestamp Preservation

An implementation **MUST** ensure that the Origin_Timestamp remains unchanged during transmission:

1. The sender **MUST** record the instant at which the data was **actually produced** as Origin_Timestamp.
2. Serialization, encryption, transmission, decryption, and deserialization **MUST NOT** modify the Origin_Timestamp.
3. The receiver **MUST NOT** modify the received Origin_Timestamp.
4. When persisting, the receiver **MUST** retain the Origin_Timestamp.

An implementation **SHOULD** maintain an independent "transmission timestamp" field outside the frame header (implementation-defined), but **MUST NOT** confuse it with Origin_Timestamp.

## 6.7 DAG Dependency Handling

### 6.7.1 Adding Fragments to the DAG

When the receiver receives a Fragment, it **MUST** process dependencies through the DAG Manager:

1. Extract the Fragment's `dagDependencies`.
2. For each dependency:
   a. Check whether the target Fragment_ID is already in the DAG.
   b. Check whether adding this edge would form a cycle.
3. Return one of the following three results based on the check outcome:

| Result | Meaning | Subsequent Action |
|--------|---------|-------------------|
| `accepted` | All dependencies are resolved; no cycle | **MUST** add the Fragment to the DAG |
| `pending` | Some dependencies are unresolved (target Fragments have not arrived); no cycle | **MUST** cache the Fragment and wait for dependency resolution |
| `rejected` | A cycle is detected | **MUST** reject the Fragment and return the `DAG_CYCLE_DETECTED` error (4001) |

### 6.7.2 Deferred Resolution

When a Fragment is in the `pending` state:

1. The implementation **MUST** continue to wait for dependencies in the cache for that Fragment.
2. When the target Fragments of dependencies arrive, **MUST** re-evaluate all related `pending` Fragments in the cache.
3. **MAY** set a maximum cache time (implementation-defined). After timeout, **SHOULD** return the `DAG_DEPENDENCY_UNRESOLVED` error (4002) and discard.

### 6.7.3 Cycle Detection Algorithm

An implementation **MUST** detect cycles before adding a new Fragment. The detection algorithm **SHOULD** use DFS (depth-first search) or Tarjan's algorithm.

Concretely: from each dependency target of the new Fragment, perform DFS. If the new Fragment itself is reachable from a dependency target, a cycle is formed.

## 6.8 Multi-Agreement Interleaved Transmission

When multiple active Agreements coexist, the sender **MUST**:

1. Associate each Fragment with the correct Agreement via the Agreement_ID in the frame header.
2. When switching Agreements (i.e. the next Fragment belongs to a different Agreement), **MUST** carry the full Agreement_ID in that Fragment (i.e. null compression cannot be used).
3. **SHOULD** schedule the sending order according to each Agreement's `priority`.
