# Chapter 8 Reliability

## 8.1 Reliability Model

A DTP implementation **MUST** provide the following reliability guarantees:

1. **Resume**: After the underlying connection is interrupted, transmission is resumed; data already successfully received **MUST NOT** be retransmitted.
2. **Acknowledgment**: The receiver **MUST** acknowledge to the sender Fragments that have been successfully received.
3. **Retransmission**: The sender **MUST** retransmit unacknowledged Fragments when an acknowledgment is not received within the timeout.
4. **Session persistence**: When the underlying connection is interrupted, the Session state **MUST** be persisted.

## 8.2 Resume Mechanism

### 8.2.1 Resume Protocol

Resume **MUST** be implemented based on sequence numbers, following this workflow:

```
Sender                                Receiver
   |                                     |
   |-- Fragment (seq=1) ---------------->|  ✓ received
   |-- Fragment (seq=2) ---------------->|  ✓ received
   |-- Fragment (seq=3) ---------------->|  ✓ received
   |-- Fragment (seq=4) -------- ✗ -----|  connection lost
   |                                     |
   |        [connection restored]        |
   |                                     |
   |<-- ResumeReport (highest=3) --------|
   |                                     |
   |-- Fragment (seq=4) ---------------->|  resume from breakpoint
   |-- Fragment (seq=5) ---------------->|
```

### 8.2.2 ResumeReport

After the connection is restored, the receiver **MUST** send a ResumeReport defined as follows:

```typescript
interface ResumeReport {
  collectionHighest: SequenceNumber;
  injectionHighest: SequenceNumber;
}
```

| Field | Normative Requirement |
|-------|------------------------|
| `collectionHighest` | **MUST** be the highest sequence number successfully received by the receiver in the data collection direction |
| `injectionHighest` | **MUST** be the highest sequence number successfully received by the receiver in the data injection direction |

If a direction has not yet received any Fragment, the corresponding field **MUST** be -1 or an implementation-defined "not received" sentinel value.

### 8.2.3 Resume Consistency

After receiving a ResumeReport, the sender **MUST** strictly follow:

1. **Continue from the next sequence number**: resume sending starting at `highest + 1`.
2. **No duplicate sending**: **MUST NOT** resend any Fragment with sequence number `<= highest`.
3. **No skipping**: **MUST NOT** skip unacknowledged Fragments (i.e. those not confirmed in cache).

## 8.3 Acknowledgment Mechanism

### 8.3.1 Acknowledgment Methods

An implementation **MUST** provide Fragment receipt acknowledgment. Acknowledgment **MAY** be implemented through one of the following methods:

1. **Explicit ACK control frame**: The receiver sends a ControlFrame with `controlType = "ack"`, where `details` contains the highest acknowledged sequence number.
2. **Cumulative ACK**: Carry the highest received sequence number of the reverse direction in an extension field of each data frame (**RECOMMENDED**).
3. **Batch ACK**: Send one ACK every N received Fragments (N is implementation-defined; **RECOMMENDED** as 16).

The specific acknowledgment method **MAY** be chosen by the implementation, but the receiver and sender **MUST** agree on the chosen method.

### 8.3.2 Acknowledgment Timing

The receiver **MUST** satisfy:

1. Only acknowledge after the Fragment has passed decryption, Agreement validation, and DAG validation.
2. **MUST NOT** acknowledge while the DAG state is `pending` (acknowledgment should be deferred until dependencies are resolved).
3. The highest sequence number in the ACK **MUST** be the maximum of the contiguous prefix of the acknowledged sequence number set.

## 8.4 Retransmission Mechanism

### 8.4.1 Retransmission Strategy

The sender **MUST** retransmit under the following conditions:

1. The ACK for a given sequence number is not received within the protocol-configured retransmission timeout.
2. Upon receiving a ResumeReport, retransmit unacknowledged Fragments.

### 8.4.2 Retransmission Configuration

An implementation **SHOULD** provide the following configurable parameters:

| Parameter | Default (**RECOMMENDED**) | Description |
|-----------|---------------------------|-------------|
| Initial retransmission timeout | 5 seconds | Wait time for the first retransmission |
| Retransmission backoff factor | 2 | Timeout doubles after each retransmission (exponential backoff) |
| Maximum retransmission count | 5 | Notify the upper layer of failure beyond this count |
| Maximum retransmission timeout | 60 seconds | Upper bound on the retransmission timeout |

An implementation **MUST** implement an exponential backoff algorithm.

### 8.4.3 Retransmission Failure Handling

When the retransmission count exceeds the upper bound:

1. The sender **MUST** notify the upper-layer application of the `RETRANSMISSION_TIMEOUT` error (6002).
2. The sender **SHOULD** trigger Session suspension or termination (implementation-defined).
3. The implementation **MUST NOT** retransmit indefinitely.

## 8.5 Cache Management

### 8.5.1 Unacknowledged Fragment Cache

The sender **MUST** maintain an unacknowledged Fragment cache that satisfies:

1. Every Fragment that has been sent but not yet acknowledged **MUST** be retained in the cache.
2. After receiving an acknowledgment, the acknowledged Fragment **MUST** be removed from the cache.
3. The cache **MUST** have a capacity upper bound (implementation-defined; **RECOMMENDED** as no fewer than 1024 Fragments or 16 MB).

### 8.5.2 Cache-Full Handling

When the cache reaches its capacity upper bound, the sender **MUST**:

1. Pause sending new Fragments.
2. Notify the upper-layer application via the `BUFFER_FULL` error (6001).
3. Resume sending after cache space is freed by acknowledgments.
4. **MUST NOT** silently drop Fragments.

## 8.6 Session Management

### 8.6.1 Session Establishment

After CAP completes identity authentication and key exchange, the DTP_Engine **MUST** establish a DTP Session:

1. **MUST** generate a unique Session_ID (UUID v4) conforming to RFC 4122.
2. **MUST** initialize the Session data structure (see Section 8.6.3).
3. **MUST** transition the state from `WaitingForCAP` to `SessionEstablished`.

### 8.6.2 Session State Maintenance

During a Session, the DTP_Engine **MUST** maintain bidirectional transmission state:

```typescript
interface DirectionalTransferState {
  currentSequenceNumber: SequenceNumber;
  highestAcknowledgedSequenceNumber: SequenceNumber;
  unacknowledgedFragmentCache: Map<SequenceNumber, Fragment>;
}
```

The implementation **MUST** maintain an independent DirectionalTransferState for each transmission direction:

| Direction | Field Name |
|-----------|------------|
| Data collection (Terminal → Fay) | `collectionState` |
| Data injection (Fay → Terminal) | `injectionState` |

### 8.6.3 Session Data Structure

The complete Session structure **MUST** contain:

```typescript
interface Session {
  sessionId: SessionID;
  masterIdentity: string;
  slaveIdentity: string;
  state: SessionState;
  activeAgreements: Map<AgreementID, Agreement>;
  collectionState: DirectionalTransferState;
  injectionState: DirectionalTransferState;
  createdAt: number;
  lastActivityAt: number;
  timeoutThreshold: number;
}
```

### 8.6.4 Session Persistence

When the underlying transport connection is disconnected, the DTP_Engine **MUST**:

1. Immediately transition the SessionState from `Transmitting` to `Suspended`.
2. Persist the following to non-volatile storage:
   - The complete Session object (including all active Agreements)
   - The bidirectional DirectionalTransferState
   - The unacknowledged Fragment cache
3. Persistence **MUST** be atomic (either all succeed or all fail).

### 8.6.5 Session Restoration

After the underlying connection is re-established, the DTP_Engine **MUST** follow the following recovery workflow:

1. Wait for CAP re-verification.
2. After CAP verification succeeds, enter the `Resuming` state.
3. Restore the Session state from persistent storage.
4. The receiver sends a ResumeReport (see Section 8.2.2).
5. Based on the ResumeReport, the sender resumes transmission from the breakpoint.
6. After the resume handshake completes, transition to `Transmitting`.

If restoration fails, the DTP_Engine **MUST**:

1. Transition to the `Idle` state.
2. Release all related resources.
3. Notify the upper layer via the `SESSION_RESTORE_FAILED` error (5003).

### 8.6.6 Session Timeout

An implementation **MUST** implement a Session timeout mechanism:

1. **MUST** maintain a `lastActivityAt` field recording the last activity time.
2. When `now - lastActivityAt > timeoutThreshold`, the Session **MUST** be marked as timed out.
3. A timed-out Session **MUST** be closed and related resources **MUST** be released.
4. The default `timeoutThreshold` is **RECOMMENDED** as 30 minutes (1,800,000 ms).

## 8.7 Bidirectional Independence

An implementation **MUST** strictly guarantee the independence of the two transmission directions:

1. State changes in the data collection direction **MUST NOT** affect the data injection direction.
2. A connection anomaly in one direction **MUST NOT** automatically trigger a state change in the other direction (unless the underlying connection is fully disconnected).
3. The sequence numbers of one direction **MUST NOT** enter the sequence number space of the other direction.
4. The cache of one direction **MUST NOT** consume the cache quota of the other direction.
