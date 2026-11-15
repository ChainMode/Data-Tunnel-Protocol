# Data Tunnel Protocol (DTP)

Negotiated, end-to-end encrypted, resumable data-transfer channel protocol for the iFay ecosystem, featuring Master-Slave authority governance, RFC 8785 JCS + AES-256-GCM logical frame wire encoding, and DAG fragment provenance.

## Normative Wire Envelope (`dtp/1.0`)

```text
[ 4B big-endian uint32 header byte length ]
[ RFC 8785 JCS canonical UTF-8 JSON FrameHeader ]
[ 12B IV + AES-256-GCM ciphertext + 16B AuthTag ]
```

DTP guarantees backward and forward compatibility strictly within the same `MAJOR` protocol version (`1.x`); frames with a mismatched `MAJOR` version are rejected with `VERSION_INCOMPATIBLE` (`7001`).

## Repository Layout

| Path | Description |
| --- | --- |
| `docs/{locale}/blueprint/` | Protocol architectural blueprint (9 locales; `zh-CN` is canonical) |
| `docs/{locale}/specification/` | Normative DTP specification |
| `schemas/` | Frozen `dtp/1.0` machine-readable schemas (`dtp-1.0.json`, `dtp-1.0.cddl`) |
| `vectors/` | Official cross-language conformance test vectors (`dtp-1.0-conformance.json`) |
| `src/` | TypeScript reference implementation (including `EncryptedFileSessionStore`, `TcpTransportAdapter`, 29 `fast-check` property tests, and conformance suite) |
| `reference-impls/rust/` | Independent `#![forbid(unsafe_code)]` Rust reference implementation (`dtp-ref`) cross-verifying wire & cryptographic interoperability |
| `schema/` | Legacy historical JSON schema snapshots |

## Quick Start

```bash
# TypeScript reference engine & 310-test suite (unit + E2E + TCP loopback + 29 PBT + vectors)
npm install
npm run typecheck
npm test

# Rust reference implementation & cross-language vector suite
cd reference-impls/rust
cargo test
```

## License

**MIT (Reference Implementations, Schemas & Test Vectors) / CC BY 4.0 (Specifications & Blueprints)** — Copyright (c) 2025-2026 ChainMode contributors. See [`LICENSE`](./LICENSE) and [`LICENSE-DOCS`](./LICENSE-DOCS).
