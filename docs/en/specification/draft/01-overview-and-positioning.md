# Chapter 1 Overview and Positioning

This chapter defines DTP's protocol scope (§1.1), protocol positioning (§1.2), relationship with CAP (§1.3), design goals (§1.4), master-slave model (§1.5), and conformance levels (§1.6), and in §1.7 "Version Management & Compatibility" gives DTP's version management rules in **normative** form — so that this protocol **carries its own version description**, allowing standard implementers to consult it directly without searching external documents.

## 1.1 Protocol Scope

The Data Tunnel Protocol (DTP) **SHALL** be the application-layer protocol responsible for bidirectional data transmission between terminal devices and Fay instances within the iFay ecosystem.

DTP **MUST** implement the following two core data flows:

1. **Data Collection**: From a terminal (Slave) to Fay (Master), used to persist data produced by the terminal into iFay's Personal Data Heap.
2. **Data Injection**: From Fay (Master) to a terminal (Slave), used to temporarily provide a minimized data set, filtered by iFay, to terminal applications.

DTP **MUST NOT** be used for other purposes.

## 1.2 Protocol Positioning

DTP **MUST** operate as an application-layer protocol on top of existing transport protocols, including but not limited to BLE, RTSP, WebSocket, and TCP.

DTP **MUST** interact with concrete transport protocols through the `Transport_Adapter` abstraction layer (see Section 3.4). The DTP core **MUST NOT** depend on the implementation details of any specific transport protocol.

## 1.3 Relationship with CAP

DTP **MUST** work in concert with the Control Authorization Protocol (CAP) and follow this division of responsibilities:

- **CAP** is responsible for connection authorization, identity authentication, and key exchange.
- **DTP** is responsible for negotiation-based data stream transmission.

A DTP implementation **MUST** begin data transmission only after CAP has completed identity authentication and key exchange. If CAP is not ready, the DTP implementation **MUST** refuse to send data and return the `KEY_NOT_READY` error (error code 2002, see Chapter 9).

## 1.4 Design Goals

A DTP implementation **MUST** satisfy the following design goals:

| Goal | Normative Requirement |
|------|------------------------|
| Transport Independence | The DTP core logic **MUST** be decoupled from any specific transport protocol |
| Negotiation First | All data transmission **MUST** be based on an established Agreement |
| Data Sovereignty | The Master **MUST** hold the final decision authority over data flows |
| End-to-End Encryption | The Payload **MUST** be transmitted in encrypted form |
| Context Preservation | Every Fragment **MUST** carry structured context metadata |
| Recoverability | The implementation **MUST** support sequence-number-based resume |

## 1.5 Master-Slave Model

DTP **MUST** distinguish between the following two roles:

- **Master**: A natural person user or Fay (iFay / coFay). **MUST** hold the right to initiate data collection and the right to decide on data injection.
- **Slave**: A software or hardware terminal. **MAY** only initiate data injection requests; **MUST NOT** initiate data collection requests.

A DTP implementation **MUST** enforce the following constraints:

1. At any moment, a single Slave **MUST NOT** be controlled by more than one Fay (Controller).
2. A Controller **MAY** invite other Fays to act as Observers.
3. Observers **MUST NOT** initiate requests or modify Agreements; they **MUST** only receive read-only copies of data streams.
4. When the Master initiates a data collection request, the Slave **SHOULD** accept it. The Slave **MAY** refuse, but the refusal **MUST** be accompanied by a compliance-related reason (see Section 5.3.1).
5. When the Slave initiates a data injection request, the Master **MUST** hold full decision authority and **MAY** accept, reject, or propose an alternative.

## 1.6 Conformance Levels

An implementation **MUST** declare its conformance level:

- **Full Conformance**: The implementation satisfies all **MUST** and **SHOULD** rules.
- **Core Conformance**: The implementation satisfies all **MUST** rules but **MAY** fail to satisfy some **SHOULD** rules.
- **Non-Conformance**: The implementation fails to satisfy a **MUST** rule. An implementation claiming to be DTP **MUST NOT** be in this state.

## 1.7 Version Management & Compatibility

> **This section is Normative.** This section is the **Single Source of Truth** for DTP version management rules. Wherever version rules are referenced elsewhere in the body (including Chapter 10 "Version Management" and the changelog, if any), those references **MUST** defer to this section and **MUST NOT** redefine the rules established here.

This section is organized in the following fixed order: three orthogonal version axes (§1.7.1) → `MAJOR.MINOR` semantics and change classification (§1.7.2) → version negotiation and compatibility rules (§1.7.3) → editorial edition and errata (§1.7.4) → version-number landing table and implementer checklist (§1.7.5).

### 1.7.1 Three Orthogonal Version Axes

DTP version information **MUST** be managed along three **mutually orthogonal** axes. These three axes **MUST NOT** be merged into a single version number; each axis has its own value space, record location, and progression rule, and a change on one axis **MUST NOT** force a change on the other two (the observable definition of orthogonality).

| Axis | Meaning | Value Space | Record Location | Enters Wire Format? |
|------|---------|-------------|-----------------|---------------------|
| Protocol Version | Interoperability contract | `dtp/MAJOR.MINOR` (two levels, **no PATCH**; both `MAJOR` and `MINOR` are non-negative integers) | Frame header `protocolVersion` field, schema filename | **Yes** |
| Document Status | Document lifecycle | Enum `Draft / Final / Deprecated / Obsolete` (exactly one value at any time) | Front matter `status` field | **No** |
| Editorial Edition | Errata and clarifications | Publication-date-anchored `YYYY-MM-DD` (e.g. `2025-10-25`) | Front matter `date` field and publication directory name | **No** |

Key constraints on document status and directories (the complete directory conventions and finalization governance flow are in Chapter 10, anchored to the rules in this section):

- Document status **MUST** be a front matter marker and **MUST NOT** be encoded into a file path or directory name.
- Whether a published edition is currently `Final`, `Deprecated`, or `Obsolete` is determined **only** by its files' `status` field and **MUST NOT** be inferred from the directory name.

### 1.7.2 `MAJOR.MINOR` Semantics and Change Classification

#### MAJOR (Major Version)

`MAJOR` is used for **interoperability-breaking** changes. The decision baseline: if a peer that strictly implements the old `MAJOR.0` version would **reject or misinterpret** a new message, the change breaks interoperability. Such changes include but are not limited to:

- Changing the semantics of an authoritative schema field;
- Removing a message or error code;
- Redefining an error code;
- Changing a state-machine absorbing state.

WHEN an interoperability-breaking change occurs, `MAJOR` **MUST** increment by 1 and `MINOR` **MUST** reset to 0.

Interoperability is **NOT** guaranteed across different `MAJOR` versions.

#### MINOR (Minor Version)

`MINOR` is used for **backward-compatible** additions, including but not limited to: adding optional fields, adding messages, adding error codes, adding parameters, adding attributes. The decision baseline: a peer strictly implementing the old `MAJOR.0` version would neither reject nor misinterpret the new message.

WHEN a backward-compatible addition occurs, `MINOR` **MUST** increment by 1 and `MAJOR` **MUST** remain unchanged. Within the same `MAJOR`, a higher `MINOR` **MUST** be backward compatible down to `MAJOR.0`.

#### Change Classification Rule (Ordered, Decidable)

For any change, its landing **MUST** be classified in the following order, producing a unique tier:

1. If a peer strictly implementing the old `MAJOR.0` version would **reject or misinterpret** the new message → classify as **MAJOR**;
2. Otherwise, if the change adds **wire-format-visible content** (header/message/error-code/parameter or other on-the-wire visible structure) → classify as **MINOR**;
3. Otherwise (text-only change, no wire-format change) → do **NOT** change the protocol version; use an editorial edition instead (see §1.7.4).
4. If a change matches multiple tiers simultaneously, the **higher tier MUST** be taken.

### 1.7.3 Version Negotiation and Compatibility Rules

This subsection is **Normative**.

#### Wire-Format Constraints

- **Only** the protocol version's `MAJOR.MINOR` enters the wire format (i.e. the frame header `protocolVersion` field and the schema filename).
- The protocol version **MUST** always enter the wire format; an implementation **MUST NOT** provide any configuration that excludes the protocol version from the wire format.
- Document status and editorial edition **MUST NOT** enter the wire format. An implementation **MUST NOT** change message-processing behavior based on document status or editorial edition — that is, two messages identical in wire format **MUST NOT** produce differing processing results due to differing values on these two axes.
- IF a received message lacks protocol-version information in the wire format (the header lacks `protocolVersion`, or lacks the `major` / `minor` subfield, or its value is not a non-negative integer), THEN the implementation **MUST** reject the message with a protocol error and **MUST NOT** process it under a default or inferred version.

#### Negotiation Rules

- WHEN performing a handshake or bootstrap, both parties **MUST** each declare their supported protocol-version set, which **MUST NOT** be empty.
- Version selection **MUST** follow: first take the highest `MAJOR` commonly supported by both, then take the highest `MINOR` commonly supported under that `MAJOR`.
- The party with the higher `MINOR` **MUST** be able to serve the lower-`MINOR` peer: it **MUST** process the peer's messages at the peer's declared lower-version semantics and **MUST NOT** reject merely because the peer's `MINOR` is lower.
- IF the two parties share no common `MAJOR`, THEN the implementation **MUST** reject directly with a protocol error and **MUST NOT** perform a best-effort downgrade. (The concrete binding of this error is `VERSION_INCOMPATIBLE` / 7001 in Chapter 10.)
- WHEN receiving a message with the same `MAJOR` but a higher `MINOR`, the implementation **MUST** interpret known fields at its own highest `MINOR` semantics and **ignore** unrecognized optional fields; it **MUST NOT** reject, discard, or raise an error.

#### Credentials and Cipher Suites

- WHEN performing a rolling version upgrade, the implementation **MUST** keep existing, unexpired credentials or tokens valid and **MUST NOT** invalidate them merely because of the version change.
- WHERE the protocol already has a cipher-suite negotiation mechanism, version negotiation **MUST** reuse the same approach (each declares, take the common highest).

> The negotiation sequence (Hello / Hello_Ack) and the "single version within a session, no mid-session switching" operational mechanism are in Chapter 10.

### 1.7.4 Editorial Edition and Errata

The constraints in this subsection are **Non-normative** governance constraints; however, the "MUST NOT disguise as an upgrade" rule is binding on the correctness of the protocol version number.

- WHEN performing pure-text errata after finalization (fixing typos, adding examples, clarifying wording, fixing links), the protocol version number (`MAJOR.MINOR`) **MUST** remain unchanged; the errata **MUST** be carried by a **new publication-date directory**, and existing published directories **MUST** remain frozen so that old references and links **MUST NOT** be broken.
- An editorial edition **SHOULD** be registered under an `Editorial` category in the changelog (if any); front matter **MUST** mark its edition with the `edition` / `date` fields.
- An editorial edition **only** permits non-normative changes and **MUST NOT** touch wire-format semantics, normative statements, error codes, the state machine, or interoperability behavior.
- **Hard constraint**: IF a modification touches wire-format semantics, THEN it **MUST** increment `MINOR` or `MAJOR` per §1.7.2 and **MUST NOT** be disguised as an errata (editorial edition) release.

### 1.7.5 Version-Number Landing Table and Implementer Checklist

#### Landing Table

| Landing Point | What Goes There | Normative Constraint |
|---------------|-----------------|----------------------|
| Wire envelope `protocolVersion` field | `MAJOR.MINOR` | Carries **only** `MAJOR.MINOR`, no other level |
| Schema filename | Follows `MAJOR.MINOR` | **MUST NOT** be renamed with the editorial edition (keeps references stable) |
| content-type | `application/dtp` | Identifies the protocol family; its `version=` parameter is **only** a gateway-routing convenience and is **NOT** wire-format semantics |
| Front matter `status` / `date` | Document governance markers | **NOT** in the wire format |
| git tag | `dtp-v<MAJOR.MINOR>-<status>` | The tag **MUST** cover body + test vectors + schema together |

#### Implementer Checklist (Must-Read)

- Judge interoperability **only** by the protocol version (`MAJOR.MINOR`); **MUST NOT** rely on document status or editorial edition.
- The same `MAJOR` **MUST** be backward compatible down to `MAJOR.0`.
- **MUST NOT** treat errata (editorial editions) as protocol upgrades.
- **MUST NOT** rely on the schema filename to encode the editorial edition.
- During `Draft` there is **NO** compatibility promise.

> The complete directory and status conventions, and the standard finalization (Draft → Final) actions, are in Chapter 10 "Protocol Evolution and Governance"; the git tag format, status enumeration, and editorial-edition definition referenced therein **MUST** be anchored to this section (§1.7).
