# Data Tunnel Protocol (DTP)

Negotiated, encrypted, resumable data-transfer channel protocol for the iFay ecosystem, featuring Master-Slave authority governance, logical frame wire encoding, and DAG fragment provenance.

## Repository Layout

| Path | Description |
| --- | --- |
| `docs/{locale}/blueprint/` | Protocol architectural blueprint (9 locales; `zh-CN` is canonical) |
| `docs/{locale}/specification/` | Normative DTP specification |
| `schema/` | Protocol JSON / wire schemas |
| `src/` | TypeScript reference implementation & 249-test property/unit/e2e suite |

## Quick Start

```bash
pnpm install
pnpm typecheck
pnpm test
```

## License

See [LICENSE](./LICENSE).
