# Data Tunnel Protocol (DTP)

[![Docs CI](https://github.com/ChainMode/Data-Tunnel-Protocol/actions/workflows/docs-ci.yml/badge.svg)](https://github.com/ChainMode/Data-Tunnel-Protocol/actions/workflows/docs-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Docs: CC BY 4.0](https://img.shields.io/badge/Docs-CC%20BY%204.0-lightgrey.svg)](./LICENSE-DOCS)
[![Website: ifay.ai](https://img.shields.io/badge/Website-ifay.ai-blue)](https://ifay.ai)

**Data Tunnel Protocol (`dtp/1.0`)** is the negotiated, end-to-end encrypted, resumable data-transfer channel protocol for **Fay** avatars and **Host** endpoints in the **iFay** ecosystem. It enforces Master-Slave authority governance, RFC 8785 JCS + AES-256-GCM authenticated frame encoding, and verifiable DAG fragment provenance.

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

## 30-Second Runnable Quickstart (`dtp-collector` & Minimal Injection)

```bash
# Run the end-to-end Personal Context Collector + Privacy-Filtered Minimal Injection demo
npm run demo

# Run the 316-test TypeScript suite (unit + E2E + TCP loopback + 29 PBT + vectors + collector)
npm run typecheck
npm test

# CLI usage (after npm run build)
npx dtp-collector collect --workspace ./notes --heap ./personal-heap --key my-secret --activity deep_work
npx dtp-collector inspect --heap ./personal-heap --key my-secret
npx dtp-collector inject  --heap ./personal-heap --key my-secret --app-id bistro --purpose dining --request dietary_preference,text --allow dietary_preference

# Rust reference implementation & cross-language vector suite
cd reference-impls/rust
cargo test
```

## Developer Integration (`dtp-collector` SDK)

```ts
import {
  collectWorkspaceToHeap,
  deriveCollectorKeyFromHexOrPassphrase,
  requestMinimalContextFromIfay,
} from 'data-tunnel-protocol';

const heapKey = deriveCollectorKeyFromHexOrPassphrase(process.env.IFAY_HEAP_SECRET!);

// Flow 1 (Host Terminal -> iFay): Encrypted contextual note collection into Personal Data Heap
// Wire frames are 100% compatible with @ifay/soul ingestDtpContextFrame()
const collected = collectWorkspaceToHeap({
  workspaceDir: './authorized-notes',
  heapDir: './personal-data-heap',
  sessionKey: heapKey,
  ambientContext: {
    timezone: 'Asia/Shanghai',
    ambient_activity: 'deep_work',
    device_class: 'laptop_workstation',
    source_app: 'obsidian',
  },
});

// Flow 2 (iFay -> External App): Privacy-filtered minimal data injection over encrypted DTP frame
// Strips all raw prose, file paths, and Human Prime / Fay identifiers automatically
const injection = requestMinimalContextFromIfay(
  { heapDir: './personal-data-heap', heapSessionKey: heapKey },
  {
    appId: 'bistro-booker',
    purpose: 'dinner_reservation',
    requestedFields: ['dietary_preference', 'schedule_window', 'text', 'human_prime_id'],
  },
  {
    approvedFields: ['dietary_preference', 'schedule_window'],
    allowedPurposes: ['dinner_reservation'],
  },
);
```

## License

**MIT (Reference Implementations, Schemas & Test Vectors) / CC BY 4.0 (Specifications & Blueprints)** — Copyright (c) 2025-2026 ChainMode contributors. See [`LICENSE`](./LICENSE) and [`LICENSE-DOCS`](./LICENSE-DOCS).
