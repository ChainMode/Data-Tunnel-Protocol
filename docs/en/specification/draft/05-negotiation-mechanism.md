# Chapter 5 Negotiation Mechanism

## 5.1 Negotiation Principles

A DTP implementation **MUST** enforce the following negotiation principles:

1. **Negotiation first**: Before any Fragment data transmission, an Agreement in the `active` state **MUST** already exist.
2. **No raw transmission**: An implementation **MUST NOT** allow data transmission that does not rely on an Agreement.
3. **Bidirectional negotiation**: The Master **MAY** initiate data collection negotiation; the Slave **MAY** initiate data injection negotiation.
4. **Dynamic adjustment**: Both sides **MAY** adjust the parameters of an Agreement while it is in the `active` state.
5. **Explicit termination**: Both sides **MAY** explicitly terminate an Agreement. After termination, data transmission under that Agreement **MUST** stop immediately.

## 5.2 Negotiation Frame Types

Negotiation **MUST** be carried out through two frame types: Request_Frame and Response_Frame.

### 5.2.1 Request_Frame

A Request_Frame **MUST** contain the following fields:

```typescript
interface RequestFrame {
  frameType: "request";
  requestId: string;
  requestorRole: "master" | "slave";
  requestType: "collection" | "injection" | "adjustment" | "termination";
  targetAgreementId?: AgreementID;
  proposedParams: AgreementParams;
}
```

| Field | Normative Requirement |
|-------|------------------------|
| `frameType` | **MUST** be the literal `"request"` |
| `requestId` | **MUST** be a unique identifier of the request. **SHOULD** use UUID v4 |
| `requestorRole` | **MUST** be `"master"` or `"slave"`, identifying the request originator |
| `requestType` | **MUST** be one of the four types in the table below |
| `targetAgreementId` | **MUST** be provided when `requestType` is `"adjustment"` or `"termination"` |
| `proposedParams` | **MUST** provide complete AgreementParams (see Section 5.4) |

### 5.2.2 RequestType

| Value | Semantics | Constraint |
|-------|-----------|------------|
| `"collection"` | Data collection request | **MUST** be initiated by `requestorRole = "master"` |
| `"injection"` | Data injection request | **MUST** be initiated by `requestorRole = "slave"` |
| `"adjustment"` | Adjust an existing Agreement | **MUST** provide `targetAgreementId`; the target Agreement **MUST** be in the `active` state |
| `"termination"` | Terminate an existing Agreement | **MUST** provide `targetAgreementId` |

An implementation **MUST** reject any request that does not satisfy the above constraints and return the corresponding error (see Chapter 9).

### 5.2.3 Response_Frame

A Response_Frame **MUST** contain the following fields:

```typescript
interface ResponseFrame {
  frameType: "response";
  requestId: string;
  result: NegotiationResult;
  agreedParams?: AgreementParams;
  agreementId?: AgreementID;
  rejectionReason?: string;
}
```

| Field | Normative Requirement |
|-------|------------------------|
| `frameType` | **MUST** be the literal `"response"` |
| `requestId` | **MUST** be the `requestId` of the corresponding Request_Frame |
| `result` | **MUST** be one of `NegotiationResult` |
| `agreedParams` | **MUST** be provided when `result` is `accepted` or `counter_proposal` |
| `agreementId` | **MUST** be provided when `result` is `accepted`; **MUST** be a newly generated UUID v4 |
| `rejectionReason` | **MUST** be provided when `result` is `rejected` |

### 5.2.4 NegotiationResult

`NegotiationResult` **MUST** be one of the following three values:

| Value | Semantics |
|-------|-----------|
| `"accepted"` | Accept the request |
| `"rejected"` | Reject the request |
| `"counter_proposal"` | Propose an alternative |

An implementation **MUST NOT** return result values not listed.

## 5.3 Negotiation Workflow

### 5.3.1 Data Collection Negotiation (Master-initiated)

Data collection negotiation **MUST** follow this workflow:

1. The Master sends a Request_Frame with `requestType = "collection"` and `requestorRole = "master"`.
2. The Slave **MUST** reply with a Response_Frame containing one of the following three results:
   - `"accepted"`: Agree to transmit per `proposedParams`. **MUST** include the newly generated `agreementId` in the Response_Frame.
   - `"rejected"`: Refuse to transmit. **MUST** state a compliance-related constraint (e.g. DLP policy) in `rejectionReason`. **MUST NOT** refuse for non-compliance reasons.
   - `"counter_proposal"`: Propose alternative parameters. **MUST** provide the modified parameters in `agreedParams`.
3. If the Slave replies with `counter_proposal`, the Master **MAY** send a new Request_Frame to accept, reject, or continue negotiating.
4. The Master **MUST** persistently record the Slave's response result for each data collection request.

### 5.3.2 Data Injection Negotiation (Slave-initiated)

Data injection negotiation **MUST** follow this workflow:

1. The Slave sends a Request_Frame with `requestType = "injection"` and `requestorRole = "slave"`.
2. The Master **MUST** reply with a Response_Frame containing one of the following three results:
   - `"accepted"`: Agree to provide data. **MUST** describe the filtered data scope (minimized data set) in `agreedParams`. **MUST** include the newly generated `agreementId` in the Response_Frame.
   - `"rejected"`: Refuse to provide data. **SHOULD** state the reason in `rejectionReason`.
   - `"counter_proposal"`: Provide data of a different scope or format. **MUST** describe the alternative in `agreedParams`.
3. The Master **MUST** hold full decision authority in data injection decisions, and **MUST NOT** be forced to accept the request.

### 5.3.3 Negotiation Timeout

An implementation **MUST** set a timeout threshold for Request_Frame. If a peer's Response_Frame is not received within the threshold:

1. The requestor **SHOULD** retransmit the Request_Frame; the retry count **MUST NOT** exceed the implementation-configured upper bound.
2. After the retry upper bound is reached, the requestor **MUST** terminate the negotiation and notify the upper-layer application of the `AGREEMENT_NEGOTIATION_FAILED` error (3003).

## 5.4 AgreementParams

AgreementParams **MUST** contain the following fields:

```typescript
interface AgreementParams {
  dataType: string;
  dataRange: string;
  transferMode: TransferMode;
  frequency: number | null;
  validityPeriod: number;
  priority: Priority;
}
```

| Field | Type | Normative Requirement |
|-------|------|------------------------|
| `dataType` | `string` | **MUST** be non-empty. Identifies the data type |
| `dataRange` | `string` | **MUST** be non-empty. Describes the data scope |
| `transferMode` | `TransferMode` | **MUST** be one of the three values in the table below |
| `frequency` | `number \| null` | In Hz. **MUST** be null when `transferMode = "one_time"`; **MUST** be a positive number for other modes |
| `validityPeriod` | `number` | In milliseconds. **MUST** be a positive integer |
| `priority` | `Priority` | **MUST** be one of the four values in the table below |

### 5.4.1 TransferMode

| Value | Semantics |
|-------|-----------|
| `"one_time"` | One-time transmission. The Agreement **SHOULD** terminate automatically after the transmission completes |
| `"periodic"` | Periodic transmission. **MUST** set `frequency` |
| `"streaming"` | Streaming transmission. **MUST** set `frequency` |

### 5.4.2 Priority

| Value | Semantics |
|-------|-----------|
| `"low"` | Low priority |
| `"normal"` | Normal priority (default) |
| `"high"` | High priority |
| `"critical"` | Critical priority |

An implementation **SHOULD** schedule resource contention among multiple Agreements according to `priority`.

## 5.5 Agreement Lifecycle

### 5.5.1 State Definitions

`AgreementStatus` **MUST** be one of the following four values:

| State | Semantics |
|-------|-----------|
| `"negotiating"` | Negotiation in progress |
| `"active"` | Agreement in effect; data being transmitted |
| `"suspended"` | Connection interrupted; Agreement suspended |
| `"terminated"` | Agreement terminated |

### 5.5.2 State Transitions

The Agreement state **MUST** comply with the following transition rules:

| Current State | Triggering Event | Target State |
|---------------|------------------|--------------|
| (none) | Request_Frame issued | `negotiating` |
| `negotiating` | Response_Frame returns `accepted` | `active` |
| `negotiating` | Response_Frame returns `rejected` | (terminated) |
| `active` | Underlying connection disconnected | `suspended` |
| `active` | `termination`-type Request_Frame received | `terminated` |
| `active` | `validityPeriod` expired | `terminated` |
| `suspended` | Connection restored and CAP re-verification passed | `active` |
| `suspended` | Persistence timeout | `terminated` |
| `terminated` | (terminal state) | (none) |

### 5.5.3 Auto-Termination of One-Time Agreements

When `transferMode = "one_time"` and the data transmission completes:

1. The sender **MUST** terminate the Agreement after the last Fragment by sending a Request_Frame with `requestType = "termination"`.
2. The receiver **MUST** set the Agreement state to `terminated` after receiving and acknowledging all Fragments.

## 5.6 Multi-Agreement Concurrency

A DTP implementation **MUST** support maintaining multiple Agreements in the `active` state simultaneously within a single Session.

The implementation **MUST** satisfy:

1. Each Fragment is associated with a specific Agreement via its Agreement_ID.
2. Fragments belonging to different Agreements **MAY** be interleaved in the transmission stream.
3. The actual transmission method for multiple Agreements (serial or parallel) **DEPENDS** on the capabilities of the underlying Transport_Adapter.
4. The implementation **MUST NOT** limit the maximum number of active Agreements in a single Session below 16. **SHOULD** support an arbitrary number.

## 5.7 Observer Negotiation Restrictions

The Observer role **MUST** satisfy:

1. **MUST NOT** send Request_Frame. If an Observer attempts to send one, the DTP_Engine **MUST** reject the operation and return the `OBSERVER_WRITE_DENIED` error (8002).
2. **MUST NOT** receive any decision authority over Response_Frame.
3. **MAY** receive read-only copies of data frames.
4. **MUST** be explicitly authorized by the Controller upon joining as an Observer.
