# Data Tunnel Protocol (DTP) Specification

**Version**: Draft
**Target Version**: 2025-10-25
**Status**: Draft, awaiting review
**Protocol Layer**: Application Layer

## Introduction

This specification defines the wire format, state machine, negotiation mechanism, encryption requirements, error handling, and version management rules of the Data Tunnel Protocol (DTP). DTP is the application-layer protocol used in the iFay ecosystem for bidirectional data collection and injection between terminal devices and Fay.

This specification is the **normative** document of DTP. Any implementation conforming to this specification ought to be capable of interoperating with other conforming implementations.

## Keywords Convention

The keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be interpreted as described in RFC 2119 and RFC 8174, and only have normative meaning when they appear in **bold** form.

## Document Structure

This specification consists of 10 chapters:

| Chapter | Title | Scope |
|---------|-------|-------|
| Chapter 1 | Overview and Positioning | DTP's role, design goals, relationship with other protocols, and version management & compatibility (§1.7, normative) |
| Chapter 2 | Terminology and Definitions | Normative terminology definitions |
| Chapter 3 | Protocol Architecture | Protocol layering, components, and state machine |
| Chapter 4 | Logical Frame Structure | Binary format of frame header and payload |
| Chapter 5 | Negotiation Mechanism | Agreement negotiation, adjustment, and termination |
| Chapter 6 | Data Transmission | Data collection and injection workflows |
| Chapter 7 | Security and Encryption | End-to-end encryption requirements |
| Chapter 8 | Reliability | Resume, acknowledgment, and session management |
| Chapter 9 | Error Handling | Error codes and notification mechanism |
| Chapter 10 | Version Management | Operational mechanisms and governance flow of version management (authoritative policy in Chapter 1 §1.7) |

## Conformance

Any entity claiming to implement DTP (hereinafter referred to as "implementation") **MUST** satisfy the following conformance requirements:

1. The implementation **MUST** fully support all **MUST** rules defined in this specification.
2. The implementation **SHOULD** support all **SHOULD** rules defined in this specification. If unsupported, the implementation **MUST** explicitly disclose the deviation in its documentation.
3. The implementation **MAY** choose whether to support **MAY** rules.
4. The implementation **MUST NOT** introduce extensions that conflict with this specification. Any extension **MUST** be implemented through the extension mechanisms defined in this specification (see Chapter 4 custom fields, Chapter 5 agreement parameter extensions).

## Normative References

- **RFC 2119** — Key words for use in RFCs to Indicate Requirement Levels
- **RFC 8174** — Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words
- **RFC 4122** — A Universally Unique IDentifier (UUID) URN Namespace (used for Fragment_ID, Agreement_ID, Session_ID)
- **RFC 3339** — Date and Time on the Internet: Timestamps (UTC timestamp format)
- **CAP Specification** — Control Authorization Protocol; DTP relies on CAP for identity authentication and key exchange

## Related Documents

- **DTP Blueprint** (`docs/en/blueprint/`): Non-normative introductory material for DTP, providing motivation, design rationale, and examples
- **DTP Schema** (`schema/draft/schema.ts`): Reference TypeScript type definitions for DTP
