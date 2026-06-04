# Chapter 3 Protocol Architecture

## 3.1 Protocol Layering

A DTP implementation **MUST** be organized according to the following layering:

```
+-----------------------------------------------+
|             Application Layer                  |
|   iFay / coFay / Personal Data Heap            |
|   Terminal Applications                        |
+-----------------------------------------------+
|             DTP Protocol Layer                 |
|   DTP_Engine (DTP_Master / DTP_Slave)          |
|   - Agreement Manager                          |
|   - Frame Codec                                |
|   - DAG Manager                                |
|   - Encryption Module                          |
|   - Session Manager                            |
|   - Resume Manager                             |
+-----------------------------------------------+
|             Adapter Layer                      |
|   Transport_Adapter                            |
+-----------------------------------------------+
|             Transport Layer                    |
|   BLE / WebSocket / TCP / RTSP / ...           |
+-----------------------------------------------+
```

An implementation **MUST NOT** invoke across layers (for example, the application layer **MUST NOT** access the adapter layer interface directly).

## 3.2 Core Components

The DTP_Engine **MUST** comprise the following six core components:

### 3.2.1 Agreement Manager

The Agreement Manager **MUST** provide the following capabilities:

1. **Negotiation flow management**: Handle the sending and receiving of Request_Frame and Response_Frame.
2. **Agreement lifecycle management**: Maintain Agreement state transitions from `negotiating` to `terminated`.
3. **Unique identifier generation**: Generate a UUID v4 conforming to RFC 4122 as the Agreement_ID for each established Agreement.
4. **Multi-Agreement concurrency support**: **MUST** support maintaining multiple active Agreements simultaneously within a single Session.

### 3.2.2 Frame Codec

The Frame Codec **MUST** provide the following capabilities:

1. **Serialization**: Encode a LogicalFrame object into a binary byte sequence.
2. **Deserialization**: Decode a binary byte sequence into a LogicalFrame object.
3. **Round-trip consistency**: For any valid LogicalFrame object, serializing and then deserializing **MUST** produce a LogicalFrame equivalent to the original object.
4. **Pretty Printer**: **SHOULD** provide the ability to convert a LogicalFrame into human-readable text, and **SHOULD** include all key fields of the frame header.

### 3.2.3 DAG Manager

The DAG Manager **MUST** provide the following capabilities:

1. **Cycle detection**: Before adding a Fragment to the DAG, **MUST** verify that no cycle would be formed. When a cycle is detected, the Fragment **MUST** be rejected and the `DAG_CYCLE_DETECTED` error (4001) **MUST** be returned.
2. **Dependency resolution**: When a target dependency declared by a Fragment has not yet arrived, the Fragment **MUST** be marked as "pending dependency resolution" and cached.
3. **Deferred resolution**: When the depended-upon Fragment arrives, previously cached Fragments **MUST** be resolved automatically.
4. **Relation type support**: **MUST** support the three relation types `derived_from`, `annotates`, and `supersedes`.

### 3.2.4 Encryption Module

The Encryption Module **MUST** provide the following capabilities:

1. **Payload encryption**: Encrypt the Payload using the key pre-negotiated by CAP.
2. **Payload decryption**: Decrypt the received Payload using the key pre-negotiated by CAP.
3. **Key readiness check**: Before any encryption operation, **MUST** verify that CAP has completed key exchange.
4. **Encryption metadata generation**: **MUST** include encryption metadata (algorithm identifier and key version) in plaintext form within the frame header.

### 3.2.5 Session Manager

The Session Manager **MUST** provide the following capabilities:

1. **Session lifecycle management**: Establish, maintain, and close Sessions.
2. **State persistence**: When the underlying connection is interrupted, **MUST** persist the Session state.
3. **State restoration**: After the connection is restored and CAP re-verification passes, **MUST** be able to restore the previous Session state.
4. **Timeout detection**: **MUST** implement Session idle timeout detection.

### 3.2.6 Resume Manager

The Resume Manager **MUST** provide the following capabilities:

1. **Sequence number assignment**: Assign a monotonically increasing sequence number to each Fragment sent.
2. **Unacknowledged cache**: Cache Fragments locally until acknowledged by the receiver.
3. **Breakpoint reporting**: When the connection is restored, report the highest successfully received sequence number to the peer.
4. **Cache management**: **MUST** implement a cache capacity upper bound check. When the cache reaches its limit, sending **MUST** be paused and the `BUFFER_FULL` error (6001) **MUST** be returned.

## 3.3 State Machine

The DTP_Engine **MUST** implement the following state machine:

```
                 [Idle]
                    |
                    | Connection request received
                    v
             [WaitingForCAP]
                    |
                    | CAP authentication + key exchange complete
                    v
             [SessionEstablished]
                    |
                    | Send or receive Request_Frame
                    v
              [Negotiating]
                    |
                    | Agreement reached
                    v
              [Transmitting]
                    |
                    | Connection interrupted
                    v
                [Suspended]
                    |
                    | Connection restored + CAP re-verified
                    v
                [Resuming]
                    |
                    | Resume handshake complete
                    v
              [Transmitting]
```

The complete state transition rules **MUST** comply with the following table:

| Current State | Triggering Event | Target State | Notes |
|---------------|-----------------|--------------|-------|
| `Idle` | Connection request received | `WaitingForCAP` | |
| `WaitingForCAP` | CAP authentication + key exchange complete | `SessionEstablished` | |
| `WaitingForCAP` | CAP failure or timeout | `Idle` | **MUST** release related resources |
| `SessionEstablished` | Send or receive Request_Frame | `Negotiating` | |
| `SessionEstablished` | Session timeout | `Idle` | **MUST** close the Session |
| `Negotiating` | Agreement reached | `Transmitting` | |
| `Negotiating` | Negotiation failed or rejected | `SessionEstablished` | |
| `Transmitting` | Continued Fragment transmission | `Transmitting` | Self-loop |
| `Transmitting` | Adjustment-type Request_Frame received | `Negotiating` | |
| `Transmitting` | Underlying connection disconnected | `Suspended` | **MUST** persist Session state |
| `Transmitting` | Agreement terminated and no other active Agreements | `SessionEstablished` | |
| `Suspended` | Connection restored and CAP re-verification passed | `Resuming` | |
| `Suspended` | Session timeout | `Idle` | **MUST** release resources |
| `Resuming` | Resume handshake complete | `Transmitting` | |
| `Resuming` | Restoration failed | `Idle` | **MUST** close the Session |

An implementation **MUST NOT** introduce state transitions not listed in the above table.

## 3.4 Transport_Adapter Interface

The Transport_Adapter **MUST** provide the following interface:

```typescript
interface Transport_Adapter {
  // Connection management
  connect(endpoint: TransportEndpoint): Connection;
  disconnect(connectionId: ConnectionID): void;

  // Data transmission
  send(connectionId: ConnectionID, data: Uint8Array): void;
  onReceive(handler: (connectionId: ConnectionID, data: Uint8Array) => void): void;

  // State events
  onConnectionStateChange(handler: (connectionId: ConnectionID, state: ConnectionState) => void): void;
}
```

A concrete Transport_Adapter implementation **MUST** satisfy the following normative requirements:

1. The `send()` operation **MUST** be non-blocking.
2. When the underlying connection state changes, the DTP_Engine **MUST** be notified through the `onConnectionStateChange` callback.
3. **MUST** provide a unified interface implementation for each supported transport protocol (BLE, WebSocket, TCP, RTSP).
4. **MUST NOT** modify the binary data passed in by the DTP_Engine.

## 3.5 Master-Slave Interaction Sequence

A complete DTP interaction **MUST** comply with the following five phases:

### Phase 1: CAP Pre-processing

The DTP_Engine **MUST** wait for CAP to complete identity authentication and key exchange. During this phase, DTP **MUST NOT** send any data frame.

### Phase 2: DTP Session Establishment

After CAP completes, the DTP_Engine **MUST** generate a unique Session_ID (UUID v4) and enter the `SessionEstablished` state.

### Phase 3: Negotiation

Phase 3a (Data Collection Negotiation): The Master **MAY** send a Request_Frame with `requestType = collection`, and the Slave **MUST** reply with a Response_Frame indicating `accepted`, `rejected`, or `counter_proposal`.

Phase 3b (Data Injection Negotiation): The Slave **MAY** send a Request_Frame with `requestType = injection`, and the Master **MUST** reply with a Response_Frame.

### Phase 4: Data Transmission

After an Agreement is reached, the sender **MUST** transmit Fragments through data frames, and each Fragment **MUST** carry the Agreement_ID it belongs to (or omit it to inherit context, see Section 4.5).

### Phase 5: Connection Interruption and Recovery

When the underlying connection is interrupted, the DTP_Engine **MUST** enter the `Suspended` state and persist the Session. After the connection is restored, CAP re-verification **MUST** be performed, and then the Engine **MUST** enter the `Resuming` state to complete the resume handshake.
