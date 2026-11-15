# Contributing to Data Tunnel Protocol (DTP)

Thank you for contributing to **Data Tunnel Protocol (DTP)**! This guide outlines our development setup, cross-language verification suites, schema stability rules, DCO 1.1 commit sign-off, terminology conventions, and dual-track licensing.

## Code of Conduct & Security

- Please read and follow our [Code of Conduct](./CODE_OF_CONDUCT.md) (contact: **jah.g@ifay.ai**).
- Report security vulnerabilities privately via [SECURITY.md](./SECURITY.md); never post undisclosed exploits in public issues or pull requests.

## Contribution Workflow

1. Fork `https://github.com/ChainMode/Data-Tunnel-Protocol` on GitHub.
2. Clone your fork and add `upstream`:
   ```bash
   git clone https://github.com/<your-username>/Data-Tunnel-Protocol.git
   cd Data-Tunnel-Protocol
   git remote add upstream https://github.com/ChainMode/Data-Tunnel-Protocol.git
   ```
3. Branch from `main` using a descriptive prefix (`feat/`, `fix/`, `docs/`, `schema/`, `test/`, `chore/`).
4. Verify both the TypeScript reference engine and the `#![forbid(unsafe_code)]` Rust reference crate before submitting a Pull Request.

## Build, Test & Conformance Vector Verification

DTP `1.0` requires cross-language wire parity across TypeScript (`src/`) and Rust (`reference-impls/rust/`) against `vectors/dtp-1.0-conformance.json`:

```bash
# 1. TypeScript reference implementation (unit, E2E, TCP loopback, 29 PBT & conformance vectors)
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build

# 2. Rust reference implementation & cross-language conformance vectors
cd reference-impls/rust
cargo test
cd ../..
```

## Schema & Conformance Vector Discipline

- **Frozen `1.0` Baseline**: `schemas/dtp-1.0.cddl`, `schemas/dtp-1.0.json`, and `vectors/dtp-1.0-conformance.json` define the normative `dtp/1.0` wire contract and are **frozen** once released.
- **Additive Minor Evolution**: Backward-compatible `1.x` extensions MUST ship in new versioned schema and vector files (for example `schemas/dtp-1.1.*`) while maintaining `1.0` interoperability; incompatible wire framing changes require a new major version (`VERSION_INCOMPATIBLE` / `7001`).
- **Cryptographic & Wire Rigor**: Changes touching `FrameHeader` RFC 8785 JCS canonicalization, AES-256-GCM AEAD framing, `AGREEMENT_EXPIRED` (`3002`) checks, or `EncryptedFileSessionStore` MUST include deterministic regression tests.

## Ecosystem Terminology Rules

Maintain canonical positive iFay terminology across all specifications, comments, and documentation:

- **`Human Prime`** (`人类原型`): Exclusively denotes the natural person mapped and served by an `iFay`.
- **`Host`** (`宿主`): Strictly denotes a runtime terminal hardware device, storage endpoint, or client software application.
- **`Fay`** (`iFay` + `coFay`): Denotes an accountable digital avatar operating under verifiable authority.
- **`GMChain`** (`公誉链`) & **`MeriToken`** (`美誉值` / `Merit Unit`): Denotes the ecosystem's strictly non-monetary social contribution reputation metric.

## Commit Convention & DCO 1.1 Sign-Off

Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat`, `fix`, `docs`, `schema`, `refactor`, `test`, `chore`).

Every commit MUST include a **Developer Certificate of Origin v1.1 (DCO 1.1)** `Signed-off-by` trailer (`git commit -s`) per https://developercertificate.org/:

```text
fix(session): enforce AGREEMENT_EXPIRED check prior to resume frame decode

Signed-off-by: Your Legal Name <you@example.com>
```

## Dual-Track Inbound = Outbound Licensing

By contributing (`Inbound = Outbound`), you license your work under this repository's dual-track model (`Copyright (c) 2025-2026 ChainMode contributors`):

- **MIT License** ([`LICENSE`](./LICENSE)) for reference implementations (`src/`, `reference-impls/`), machine-readable schemas (`schemas/`, `schema/`), and conformance test vectors (`vectors/`).
- **Creative Commons Attribution 4.0 International (`CC BY 4.0`)** ([`LICENSE-DOCS`](./LICENSE-DOCS)) for protocol specifications and architectural blueprint documents under `docs/`.
