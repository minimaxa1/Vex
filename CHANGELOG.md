## [0.3.0] - 2026-05-02

### Added
- **Weaviate connector** — full export + import, GraphQL cursor pagination, auto-create class, batch upsert, extractStream() for large datasets
- **pgvector connector** — full export + import, schema introspection, cursor-paginated export, ivfflat index auto-create, extractStream() for zero-memory large-table export
- **Re-embedding pipeline** — `--reembed` flag re-embeds from text field via OpenAI or Ollama; `--embed-model` to override
- **vec2vec adapter** — `--adapter` invokes @vektormemory/vex-adapter for projection without API call; `vex adapters` lists available pairs
- **Streaming for >100k vectors** — streamExport() via WriteStream, streamImport() in 500-record batches; migrate() auto-switches at 100k threshold
- **dimCheck() in core** — resolves dim mismatches: --adapter > --reembed > skip, per-batch during streaming import

### Connectors v0.3.0

| Connector | Export | Import | Notes |
|-----------|--------|--------|-------|
| vektor    | yes    | yes    | Round-trip complete |
| jsonl     | yes    | yes    | Stable |
| pinecone  | yes    | yes    | 4,900 vectors tested |
| qdrant    | yes    | yes    | Scroll export; auto-create on import |
| chroma    | yes    | yes    | Auto-create collection |
| weaviate  | yes    | yes    | v0.3 new; GraphQL cursor; extractStream |
| pgvector  | yes    | yes    | v0.3 new; schema introspection; extractStream |

### Fixed
- qdrant.js: spaced optional chain and nullish coalescing causing SyntaxError on Node 24
- qdrant.js: ambiguous ternary/optional-chain on colDim rewritten as clean nullish chain
- pgvector.js: extractStream() was outside connector object literal — fixed

---

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
