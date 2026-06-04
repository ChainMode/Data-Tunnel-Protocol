# Chapter 10 Version Management

> **Single Source of Truth Declaration.** The **policy** of DTP version management is defined by Chapter 1 §1.7 "Version Management & Compatibility" as the **Single Source of Truth**. This chapter **MUST NOT** redefine the policy already specified in §1.7; this chapter only provides the **operational mechanisms** of the §1.7 rules (wire-format binding, concrete error-code payloads, negotiation sequence, implementation-declaration template) and the **governance flow** (directory and status conventions, finalization actions). Whenever any statement in this chapter is ambiguous with §1.7, §1.7 **MUST** prevail.

## 10.1 Version Number Format (Operational Reference)

The semantics of the DTP protocol version number, the two-level `MAJOR.MINOR` structure (no PATCH), the change classification rule, and the orthogonal-axis definitions are in §1.7.1 and §1.7.2 and are not repeated here.

Wire-format binding: the frame header of every LogicalFrame **MUST** carry the complete `ProtocolVersion` field (see Section 4.4):

```typescript
interface ProtocolVersion {
  major: number;  // non-negative integer
  minor: number;  // non-negative integer
}
```

The initial protocol version defined by this specification **MUST** be `{ major: 1, minor: 0 }` (i.e. `dtp/1.0`).

## 10.2 Version Compatibility Matrix (Operational Supplement to §1.7.3)

> The normative rules of compatibility and negotiation are in §1.7.3. The table below is its operational realization at the frame-processing level and **MUST** be read per §1.7.3; if ambiguous, §1.7.3 prevails.

| Received Frame Version | Handling |
|------------------------|----------|
| Equal to receiver's highest version | Process normally |
| Equal to the previous major version of the receiver's highest version (major - 1) | Compatibility handling (process per the older specification) |
| Higher than the receiver's highest version | **MUST** return `VERSION_INCOMPATIBLE` (7001) |
| Major version lower than (receiver's highest version - 1) | **MUST** return `VERSION_INCOMPATIBLE` (7001) |
| Same major version, lower minor version | Process normally (backward-compatible) |
| Same major version, higher minor version | **SHOULD** process (ignore unrecognized optional fields) |

### 10.2.1 Minor Version Tolerance (Operational Realization of §1.7.3)

When an implementation receives a frame with the same major version but a higher minor version, it **MUST**:

1. Process known fields;
2. **SHOULD** ignore unknown optional fields;
3. **MUST NOT** reject the entire frame due to unknown optional fields;
4. **MUST NOT** raise an error.

## 10.3 Version Incompatibility Handling (Operational Mechanism)

### 10.3.1 Receiver Handling

When the receiver receives a LogicalFrame whose protocol version is higher than the version it supports (and exceeds the compatibility range), it **MUST**:

1. **Not process** the frame;
2. Send the `VERSION_INCOMPATIBLE` error (7001) to the sender;
3. Include its highest supported version in the error notification's `details` field:

```typescript
{
  errorCode: 7001,
  errorMessage: "Protocol version higher than supported",
  details: {
    supportedMaxVersion: { major: 1, minor: 0 }
  }
}
```

> The semantics of error code `7001` are governed by the Chapter 9 error-code table and the schema; this chapter does not redefine it.

### 10.3.2 Sender Handling

After receiving the `VERSION_INCOMPATIBLE` error, the sender **MAY** choose:

1. **Downgrade to the version supported by the peer** and resend the frame (**SHOULD** be preferred, provided a common `MAJOR` exists; no downgrade across `MAJOR`, see §1.7.3);
2. **Notify the upper-layer application** of the version incompatibility, and **MUST NOT** automatically retry indefinitely.

An implementation **MUST NOT** immediately close the Session after receiving a version-incompatible error, and **SHOULD** allow opportunity for downgrade.

### 10.3.3 In-Session Version Consistency and Negotiation Sequence

When a DTP Session is established, both parties **MUST** negotiate a consistent protocol version (negotiation rules in §1.7.3). During the session:

1. The unified version **MUST** be used throughout the entire session;
2. Protocol versions **MUST NOT** be switched mid-session.

Version negotiation **SHOULD** follow the sequence below; the concrete carrier (CAP extensions, the first Request_Frame/Response_Frame, etc.) **MAY** be chosen by the implementation, but negotiation **MUST** complete before the first data frame is sent:

```
DTP_A                              DTP_B
  |                                   |
  |-- Hello (supported_versions) --->|
  |                                   |
  |<-- Hello_Ack (chosen_version) ---|
  |                                   |
  |    [both sides use chosen_version]|
```

## 10.4 Protocol Evolution and Governance

This section provides the operational flow of the §1.7 governance rules. The git tag format, document status enumeration, and editorial-edition definition referenced herein **MUST** be anchored to §1.7; this section does not redefine them.

### 10.4.1 Directory and Status Conventions (Consistent with Faying Protocol)

- Document status is a front matter marker and **MUST NOT** be encoded into the path (see §1.7.1).
- Under `specification/`, exactly one mutable working area `draft/` **MUST** be kept (rolling-updated).
- All directories other than `draft/` **MUST** be named by publication date (e.g. `2025-10-25/`), representing a **frozen** published edition; "not draft means published".
- Whether a published edition is currently `Final`, `Deprecated`, or `Obsolete` is determined **only** by its files' `status` field and **MUST NOT** be inferred from the directory name.
- Creating status-named directories (e.g. `final/`) is **FORBIDDEN** — otherwise deprecating an edition would require moving directories and breaking links.
- WHEN a status transition occurs, **only** the front matter `status` **MUST** be modified, and directories **MUST NOT** be moved.

### 10.4.2 Draft and Official Versions

- Draft: documents reside in `docs/{lang}/specification/draft/`, schema in `schema/draft/`; draft version numbers **MAY** use `{ major: 0, minor: N }`. During `Draft` there is **NO** compatibility promise (see §1.7.5), and drafts **MUST NOT** be used in production.
- Official version: **MUST** have undergone full review and public discussion and have an immutable version snapshot; documents reside in `docs/{lang}/specification/{YYYY-MM-DD}/`, schema in `schema/{YYYY-MM-DD}/`. The first official version is `2025-10-25`, corresponding to protocol version `dtp/1.0`.
- Version snapshot immutability: once an official version is released it **MUST** remain immutable; pure-text errata are carried by a **new publication-date directory** per §1.7.4 with existing directories frozen, and the specification content or schema of a released snapshot **MUST NOT** be rewritten in place.

### 10.4.3 Standard Finalization Actions (Draft → Final)

WHEN performing finalization, the Doc Governance Process **MUST** complete the following actions in order:

1. Use `git mv` to migrate all files under `draft/` to the publication-date directory (filenames unchanged) and empty `draft/`;
2. Per file, change `status` from `Draft` to `Final`;
3. Freeze `date` to the official publication date, lock `editors` to the finalization signing roster, and keep `version` unchanged;
4. Write the `replaces` history chain (pointing to the draft directory and its finalization commit short-hash) in the README front matter;
5. Tag `dtp-v<MAJOR.MINOR>-final`, which **MUST** cover body + test vectors + schema together;
6. When multiple languages / files are involved, they **MUST** be migrated together in the same commit; unilateral release is **forbidden**.

### 10.4.4 Deprecation and Removal

An implementation **SHOULD** deprecate functionality through the following process:

1. **Mark as deprecated**: mark the functionality as deprecated in a `MINOR` version, but **MUST** continue to support it;
2. **Transition period**: at least one full `MAJOR` version cycle;
3. **Removal**: remove in the next `MAJOR` version.

An implementation **MUST NOT** remove deprecated functionality in a `MINOR` version.

## 10.5 Implementation Declaration

A DTP implementation **MUST** declare in its documentation:

1. The highest supported protocol version;
2. All supported previous major versions;
3. Whether forward compatibility is supported (handling frames with higher minor versions);
4. Implementation-defined extensions, if any.

For example:

> **Version Declaration of DTP Implementation X:**
>
> - Highest supported protocol version: 1.0
> - Compatible previous versions: none (first official version)
> - Forward compatibility: supported; ignores unknown optional fields
> - Encryption algorithms: AES-256-GCM, ChaCha20-Poly1305
> - Transport adapters: BLE, WebSocket, TCP
