# Vex — Vector Exchange

> Cross-standard vector DB migration tool. Export, import, and migrate agent memory between vector stores using the open `.vmig.jsonl` interchange format.

```bash
npx @vektormemory/vex export --from vektor --db slipstream-memory.db --output memories.vmig.jsonl
npx @vektormemory/vex import --from memories.vmig.jsonl --to pinecone --api-key $KEY --index my-index --host $HOST
npx @vektormemory/vex import --from memories.vmig.jsonl --to qdrant --collection memories
npx @vektormemory/vex migrate --from vektor --to qdrant --db memory.db --url http://localhost:6333 --collection memories
```

## Why

Every vector DB has a different API, a different format, and zero interop. Moving your agent memory from VEKTOR to Pinecone, or Qdrant to Weaviate, means writing a one-off script every time.

`vex` fixes that with a single open format and a growing connector library. Your memory is always exportable, always portable, always yours.

## Connectors

| Connector  | Export | Import | Status |
|------------|--------|--------|--------|
| `vektor`   | ✅ | ✅ | Stable |
| `jsonl`    | ✅ | ✅ | Stable |
| `pinecone` | ✅ | ✅ | Stable — tested 4,900 vectors |
| `qdrant`   | ✅ | ✅ | Stable — tested 3,917 vectors, auto-create |
| `chroma`   | ✅ | ✅ | v0.2 |
| `weaviate` | 🔜 | 🔜 | Phase 3 |
| `pgvector` | 🔜 | 🔜 | Phase 3 |

## Install

```bash
# Global install
npm install -g @vektormemory/vex

# Or run without installing
npx @vektormemory/vex --help

# Vex CLI
npm i @vektormemory/vex

# Vex Adapter (vec2vec embeddings — optional)
npm i @vektormemory/vex-adapter
```

**Requirements:** Node.js >= 18 (native fetch required). No extra dependencies for Pinecone, Qdrant, or Chroma — connectors use the built-in fetch API.

## Commands

### Export

```bash
# Export VEKTOR memory to portable .vmig.jsonl file
vex export --from vektor --db ./slipstream-memory.db --output memories.vmig.jsonl

# Export a specific namespace only
vex export --from vektor --db ./memory.db --namespace trading --output trading.vmig.jsonl

# Export from Qdrant
vex export --from qdrant --collection memories --output memories.vmig.jsonl

# Export from Pinecone
vex export --from pinecone --api-key $PINECONE_API_KEY --index my-index --host $HOST --output memories.vmig.jsonl

# Export from ChromaDB
vex export --from chroma --collection memories --output memories.vmig.jsonl
```

### Import

```bash
# → Pinecone
vex import --from memories.vmig.jsonl --to pinecone \
  --api-key $PINECONE_API_KEY \
  --index my-index \
  --host https://my-index-xxxx.svc.pinecone.io

# → Qdrant (auto-creates collection if missing)
vex import --from memories.vmig.jsonl --to qdrant \
  --url https://xxxx.cloud.qdrant.io:6333 \
  --collection my-collection \
  --api-key $QDRANT_API_KEY

# → Qdrant local (no auth)
vex import --from memories.vmig.jsonl --to qdrant --collection memories

# → ChromaDB
vex import --from memories.vmig.jsonl --to chroma --collection memories
```

### Migrate (direct — no intermediate file)

```bash
# VEKTOR → Qdrant in one command
vex migrate --from vektor --to qdrant \
  --db ./memory.db \
  --url http://localhost:6333 \
  --collection memories
```

## .vmig.jsonl Format

One JSON object per line. UTF-8. Portable across any vector store.

```json
{
  "id": "1234",
  "text": "Pepe trending #5 on CoinGecko (+2.0% 24h)",
  "vector": [0.021, -0.043, 0.018, "...384 or 768 floats"],
  "model": "bge-small-en-v1.5",
  "dims": 384,
  "namespace": "trading",
  "score": null,
  "metadata": {
    "tags": "crypto,trending",
    "importance": 1.0,
    "agent_id": "default"
  },
  "created_at": "2025-01-15T10:23:00.000Z",
  "source_store": "vektor",
  "vex_version": "1.0.0"
}
```

**Key decisions:**
- Metadata is **flat** — Pinecone compatible out of the box
- `namespace` is top-level — structural routing, not descriptive metadata
- `text` field always preserved — enables cross-model re-embedding in v0.3
- `score` field included — useful for search-result exports
- Sidecar `.vmig.meta.json` for file-level metadata (record count, SHA-256 checksum, source store)

## Embedding Handling

| Scenario | Behaviour |
|----------|-----------|
| Same model, same dims | Vectors copied directly — no re-embedding |
| Dim mismatch with target | Records skipped with warning + count in summary |
| `null` vector | Record skipped with warning |
| Different model *(v0.3)* | Re-embed from `text` field via vex-adapter |

## Sidecar Metadata

```json
{
  "exported_at": "2025-01-15T10:23:00.000Z",
  "source_store": "vektor",
  "record_count": 5026,
  "checksum": "sha256:abc123...",
  "vex_version": "1.0.0"
}
```

After import, the sidecar is updated with `imported_to` and `imported_at` fields for full auditability.

## Progress & Summary
[████████████████████] 100% pinecone (4900/4900)
┌─ pinecone summary ─────────────────────────
│  total records   : 4900
│  upserted        : 4900
│  skipped         : 0
│  duration        : 87.3s
└────────────────────────────────────────────

## Roadmap

**v0.0.1 — shipped**
- VEKTOR export
- JSONL round-trip
- Format spec v1.0.0

**v0.1.0 — shipped**
- Pinecone import (tested: 4,900 vectors)
- Qdrant import (tested: 3,917 vectors, auto-create collection)
- SHA-256 checksum in sidecar meta
- Batch retry with backoff (3x)
- Progress bar + summary block

**v0.2.0 — shipped**
- Completes bidirectional support for all three major connectors and adds filtering flags across the board.
- Pinecone export — paginated ID listing + batched vector fetch, namespace filter, --limit support
- Qdrant export — scroll API with cursor pagination, namespace filter, --limit support
- ChromaDB connector — full import + export, auto-create collection, tenant/database options
- namespace flag on all export connectors
- limit flag on all export connectors

**v0.3**
- Weaviate, pgvector connectors
- Re-embedding pipeline (different model → re-embed from `text` field via vex-adapter)
- Streaming for large datasets (>100k vectors)

**v0.4 (premium)**
- Pre-trained vex-adapter weights (vec2vec translation — no re-embedding required)
- Multimodal support

## Contributing

PRs welcome — especially new connectors.

Each connector is a single file in `connectors/` implementing two functions:

```js
{ extract(opts), load(records, opts) }
```

See `connectors/qdrant.js` as the reference implementation. The Vex core handles batching, dimension filtering, retry, progress, and sidecar generation.

## License

Apache 2.0 — free to use, fork, and build on.

---

Built by [VEKTOR](https://vektormemory.com) — persistent semantic memory for AI agents.
