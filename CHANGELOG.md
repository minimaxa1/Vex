# CHANGELOG.md

## [0.2.0] - 2026-05-02

### Added
- **Qdrant export** — full `extract()` via scroll API, paginated, namespace filter, limit flag
- **Pinecone export** — two-step: list IDs (`/vectors/list`) + batch fetch (`/vectors/fetch`), paginated
- **VEKTOR import** — `load()` writes records back into SQLite as Float32Array blobs, batched transactions (500/tx)
- **ChromaDB connector** — full `extract()` + `load()`, collection auto-create, namespace filter
- **`--namespace` flag** — filter export by namespace on vektor, qdrant, pinecone, chroma
- **`--limit` flag** — cap export at N records on all connectors
- CLI redesigned — multi-depth blue palette (navy → cobalt → steel → sky → ice → powder), grey/white type scale
- Banner uses three-colour split: cobalt / steel / sky blue on ASCII art
- All box chrome in steel blue, labels in silver, values in ice, metadata in grey
- v0.2.0 shown in banner

### Connectors — Phase 2 status

| Connector | Export | Import | Notes |
|-----------|--------|--------|-------|
| vektor    | ✅     | ✅     | Round-trip complete |
| jsonl     | ✅     | ✅     | Stable |
| pinecone  | ✅     | ✅     | List + fetch export; 4,900 vectors tested |
| qdrant    | ✅     | ✅     | Scroll export; auto-create on import |
| chroma    | ✅     | ✅     | v0.2 new; auto-create collection |

---

## [0.1.0] - 2026-05-02

### Added
- `vex import` command
- Pinecone import (tested — 4,900 vectors)
- Qdrant import (tested — 3,917 vectors, auto-create)
- `utils/checksum.js` — SHA-256 on record arrays
- `utils/batch.js` — retry with backoff (3x)
- `utils/progress.js` — `summary()` block
- `formats/vmig.js` — checksum in sidecar meta
- CLI v0.1: banner, colors, inspect, validate, interactive menu

---

## [0.0.1] - 2026-05-01

### Added
- Initial scaffold
- `.vmig.jsonl` format spec v1.0.0
- `formats/vmig.js` — reader, writer, validator
- Connectors: jsonl, vektor (export only)
- CLI: `vex export --from vektor --output file.vmig.jsonl`
