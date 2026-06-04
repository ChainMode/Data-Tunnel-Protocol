# Chapter 9 Error Handling

## 9.1 Error Handling Model

A DTP implementation **MUST** follow a three-stage "detect-notify-recover" error handling model:

1. **Detect**: identify abnormal conditions.
2. **Notify**: send error information to the peer or upper layer.
3. **Recover**: take recovery actions according to the error type.

An implementation **MUST NOT** silently drop frames upon detecting an error without notification.

## 9.2 Error Code System

DTP **MUST** use the following error code system. Error codes **MUST** be non-negative integers, divided into eight ranges by functional module:

| Range | Category | Handling Strategy |
|-------|----------|-------------------|
| 1xxx | Frame processing errors | Drop frame + notify sender |
| 2xxx | Encryption errors | Drop frame + notify sender + may trigger key re-negotiation |
| 3xxx | Agreement errors | Drop Fragment + notify sender + may trigger re-negotiation |
| 4xxx | DAG errors | Reject Fragment + notify sender, or cache and wait |
| 5xxx | Session errors | Attempt Session recovery + close and notify upper layer on failure |
| 6xxx | Resume errors | Pause sending + notify upper-layer application |
| 7xxx | Version errors | Send version-incompatible notification + attempt downgrade |
| 8xxx | Permission errors | Reject operation + notify requester |

## 9.3 Error Code Definitions

An implementation **MUST** use the following normative error code definitions. **MUST NOT** use unlisted error codes. Any extension **MUST** be defined in a subsequent version of this specification.

### 9.3.1 Frame Processing Errors (1xxx)

| Code | Name | Trigger Condition |
|------|------|-------------------|
| 1001 | `FRAME_DESERIALIZATION_FAILED` | The received binary data cannot be deserialized into a LogicalFrame |
| 1002 | `FRAME_INVALID_FORMAT` | The LogicalFrame structure is invalid or required fields are missing |

### 9.3.2 Encryption Errors (2xxx)

| Code | Name | Trigger Condition |
|------|------|-------------------|
| 2001 | `DECRYPTION_FAILED` | Payload decryption failed (wrong key or corrupted data) |
| 2002 | `KEY_NOT_READY` | CAP key exchange has not yet completed; data transmission is refused |

### 9.3.3 Agreement Errors (3xxx)

| Code | Name | Trigger Condition |
|------|------|-------------------|
| 3001 | `AGREEMENT_NOT_FOUND` | The Fragment references an unknown Agreement_ID |
| 3002 | `AGREEMENT_EXPIRED` | The referenced Agreement has expired (exceeded `validityPeriod`) |
| 3003 | `AGREEMENT_NEGOTIATION_FAILED` | Negotiation cannot complete (timeout, peer refusal to re-negotiate, etc.) |

### 9.3.4 DAG Errors (4xxx)

| Code | Name | Trigger Condition |
|------|------|-------------------|
| 4001 | `DAG_CYCLE_DETECTED` | Adding the Fragment would form a DAG cycle |
| 4002 | `DAG_DEPENDENCY_UNRESOLVED` | The Fragment's dependencies are not resolved within the cache timeout |

### 9.3.5 Session Errors (5xxx)

| Code | Name | Trigger Condition |
|------|------|-------------------|
| 5001 | `SESSION_NOT_FOUND` | The referenced Session_ID does not exist |
| 5002 | `SESSION_TIMEOUT` | The Session has timed out due to inactivity |
| 5003 | `SESSION_RESTORE_FAILED` | Session restoration after reconnection failed |

### 9.3.6 Resume Errors (6xxx)

| Code | Name | Trigger Condition |
|------|------|-------------------|
| 6001 | `BUFFER_FULL` | The sender's unacknowledged Fragment cache has reached its capacity |
| 6002 | `RETRANSMISSION_TIMEOUT` | Fragment retransmission timeout without acknowledgment (retry count exhausted) |

### 9.3.7 Version Errors (7xxx)

| Code | Name | Trigger Condition |
|------|------|-------------------|
| 7001 | `VERSION_INCOMPATIBLE` | The protocol version of the received frame is higher than the version supported by this implementation |

### 9.3.8 Permission Errors (8xxx)

| Code | Name | Trigger Condition |
|------|------|-------------------|
| 8001 | `PERMISSION_DENIED` | The current role is not allowed to perform this operation |
| 8002 | `OBSERVER_WRITE_DENIED` | An Observer attempted a write operation (Observers are read-only) |

## 9.4 Error Code Uniqueness

An implementation **MUST** guarantee error code uniqueness:

1. Each error code **MUST** correspond to a unique error type.
2. Different error types **MUST NOT** share the same error code.
3. The implementation **MUST NOT** redefine error codes already assigned by this specification.

## 9.5 Error Notification Mechanism

### 9.5.1 ErrorNotificationFrame

Error notifications **MUST** be conveyed via a ControlFrame, defined as follows:

```typescript
interface ErrorNotificationFrame {
  frameType: "control";
  controlType: "error_notification";
  errorCode: DTPErrorCode;
  errorMessage: string;
  relatedFrameId?: FragmentID;
  relatedAgreementId?: AgreementID;
  details?: Record<string, unknown>;
}
```

| Field | Normative Requirement |
|-------|------------------------|
| `frameType` | **MUST** be `"control"` |
| `controlType` | **MUST** be `"error_notification"` |
| `errorCode` | **MUST** be one of the error codes defined in Section 9.3 |
| `errorMessage` | **MUST** be a human-readable error description. **SHOULD** use a language understandable to the peer |
| `relatedFrameId` | **OPTIONAL**. When the error is triggered by a specific frame, **MUST** include that frame's fragmentId |
| `relatedAgreementId` | **OPTIONAL**. When the error is related to a specific Agreement, **MUST** include the Agreement_ID |
| `details` | **OPTIONAL**. **MAY** include additional information for debugging |

### 9.5.2 Error Notification Transport

An ErrorNotificationFrame **MUST** be transmitted over the regular LogicalFrame channel and **MUST** have its Payload encrypted.

If the error itself prevents encryption (e.g. the `KEY_NOT_READY` error), the implementation **MAY** return the error through an implementation-defined out-of-band channel, but **MUST NOT** send the error in plaintext on the encrypted channel.

## 9.6 Key Error Handling Workflows

### 9.6.1 Deserialization Failure (1001)

When a received LogicalFrame cannot be deserialized, the receiver **MUST**:

1. Drop the frame.
2. Send the `FRAME_DESERIALIZATION_FAILED` error notification.
3. **MUST NOT** close the Session due to a deserialization failure.

### 9.6.2 Decryption Failure (2001)

When a received Payload cannot be decrypted, the receiver **MUST**:

1. Drop the frame.
2. Send the `DECRYPTION_FAILED` error notification.
3. Count the number of consecutive decryption failures.
4. If consecutive failures exceed a threshold (**RECOMMENDED** as 3), **SHOULD** trigger CAP to re-negotiate keys.

### 9.6.3 DAG Cycle Detection (4001)

When a DAG cycle is detected:

1. The receiver **MUST** reject the Fragment.
2. **MUST** return the `DAG_CYCLE_DETECTED` error.
3. **MUST NOT** add the Fragment to the DAG.
4. **MUST NOT** affect the state of existing Fragments.

### 9.6.4 Unknown Agreement (3001)

When a Fragment references an unknown Agreement_ID:

1. The receiver **MUST** drop the Fragment.
2. Return the `AGREEMENT_NOT_FOUND` error.
3. **MAY** trigger re-negotiation (implementation-defined).

### 9.6.5 Key Not Ready (2002)

When data transmission is attempted before CAP key exchange completes:

1. The DTP_Engine **MUST** refuse to send.
2. **MUST** return the `KEY_NOT_READY` error to the upper-layer caller.
3. **MUST NOT** respond in plaintext over the communication channel.

### 9.6.6 Buffer Full (6001)

When the unacknowledged Fragment cache reaches its upper bound:

1. The sender **MUST** pause sending new Fragments.
2. Send a `BUFFER_FULL` notification to the upper-layer application.
3. Resume sending after cache space is freed by acknowledgments.
4. **MUST NOT** drop already cached Fragments.

### 9.6.7 Retransmission Timeout (6002)

When the Fragment retransmission count is exhausted:

1. The sender **MUST** notify the upper-layer application of the `RETRANSMISSION_TIMEOUT` error.
2. **SHOULD** trigger Session suspension or termination.
3. **MUST NOT** retransmit indefinitely.

### 9.6.8 Version Incompatibility (7001)

When a frame with an incompatible protocol version is received (see Chapter 10 for details):

1. The receiver **MUST** not process the frame.
2. **MUST** return the `VERSION_INCOMPATIBLE` error.
3. **MUST** include the highest version it supports in the error's `details` field.

### 9.6.9 Permission Denied (8001, 8002)

For illegal role operations:

1. The DTP_Engine **MUST** reject the operation.
2. Observer write operations **MUST** return `OBSERVER_WRITE_DENIED` (8002).
3. Other permission denials **MUST** return `PERMISSION_DENIED` (8001).

## 9.7 Error Recovery Strategy

An implementation **MUST** adopt the corresponding recovery strategy by error type:

| Error Category | Recovery Strategy |
|----------------|-------------------|
| 1xxx Frame processing | Drop frame, log it, continue receiving subsequent frames |
| 2xxx Encryption | Single failure: drop frame; consecutive failures: trigger key re-negotiation |
| 3xxx Agreement | Drop Fragment; may trigger re-negotiation |
| 4xxx DAG | Cycle: reject; unresolved: cache and wait |
| 5xxx Session | Attempt Session recovery; close on failure |
| 6xxx Resume | Pause sending, wait for peer response or upper-layer intervention |
| 7xxx Version | Send version notification; attempt downgrade |
| 8xxx Permission | Reject operation; **MUST NOT** automatically retry |

An implementation **MUST NOT** automatically retry the same operation when a permission error (8xxx) occurs.
