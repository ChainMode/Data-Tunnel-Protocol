# Security Policy — Data Tunnel Protocol (DTP)

## Supported Protocol & Artifact Versions

Security advisories and patches are maintained for the following released DTP baseline and reference implementations:

| Protocol Version | Normative Artifacts | Security Support |
| --- | --- | --- |
| `1.0` (`dtp/1.0`) | `schemas/dtp-1.0.cddl`, `schemas/dtp-1.0.json`, `vectors/dtp-1.0-conformance.json`, `src/`, `reference-impls/rust/` | Supported |
| `< 1.0` (pre-release drafts) | Historical snapshots under `schema/` | Unsupported |

> **Note on Test Vectors**: Symmetric keys, IVs, and session fixtures in `vectors/dtp-1.0-conformance.json` are deterministic public conformance test vectors and MUST NOT be reused in production deployments.

## Security Scope

Vulnerability reports are welcomed across the DTP `1.0` wire protocol, TypeScript engine (`src/`), and `#![forbid(unsafe_code)]` Rust verifier (`reference-impls/rust/`), particularly covering:

1. **RFC 8785 JCS Frame Integrity & Framing Bounds**: Canonicalization discrepancies in `FrameHeader` JCS serialization, header-length prefix integer/buffer parsing bugs, cross-major version confusion (`VERSION_INCOMPATIBLE` / `7001`), or DAG fragment provenance tampering.
2. **AES-256-GCM AEAD Confidentiality & Authenticity**: IV/nonce reuse hazards, authentication tag verification bypasses, AAD binding omissions between canonical `FrameHeader` bytes and encrypted payload frames, or key-derivation flaws.
3. **Replay Protection & `AGREEMENT_EXPIRED (3002)` Enforcement**: Sequence/window replay acceptance, Master-Slave authority inversion under **Human Prime** mandate rules, or failure to immediately reject tunnel transfers and resumption attempts once a negotiated agreement expires (`AGREEMENT_EXPIRED` / `3002`).
4. **Encrypted Session Store Persistence**: Plaintext key, resumption token, or metadata leakage on **Host** local storage in `EncryptedFileSessionStore`, or file-permission/corruption handling flaws during resumable transfer recovery.

## Reporting a Vulnerability Privately

**Please do NOT disclose unpatched security vulnerabilities in public GitHub Issues, Discussions, or Pull Requests.**

### 1. Primary Channel — GitHub Private Vulnerability Reporting

Submit your report confidentially through **GitHub Security Advisories**:

- **Report URL**: https://github.com/ChainMode/Data-Tunnel-Protocol/security/advisories/new

### 2. Fallback Channel — Security Email

If GitHub Security Advisories are unavailable, send your report via email:

- **Email**: **jah.g@ifay.ai**
- Include `[SECURITY][DTP]` in the subject line along with affected module/schema paths, minimal frame or vector reproduction data, and security impact details.

## Response & Coordinated Disclosure Timeline

- **Initial Acknowledgment**: Within **72 hours** of receiving the report.
- **Triage & Assessment**: Within **7 calendar days** to validate root cause across TypeScript and Rust implementations.
- **Coordinated Disclosure Window**: **90 days** from report submission to prepare patched implementations, regression vectors, and a coordinated public Security Advisory (crediting the reporter unless anonymity is requested).
