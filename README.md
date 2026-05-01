# Vex — Vector Exchange

> Cross-standard vector DB migration tool. Export, import, and migrate agent memory between vector stores using the open `.vmig.jsonl` interchange format.

```bash
npx vex export --from vektor --db slipstream-memory.db --output memories.vmig.jsonl
npx vex import --from memories.vmig.jsonl --to pinecone --api-key $KEY --index my-index --host $HOST
npx vex migrate --from vektor --to qdrant --db memory.db --url http://localhost:6333 --collection mem
```

## Why

Every vector DB has a different API, a different format, and zero interop. Moving your agent memory from VEKTOR to Pinecone, or Qdrant to Weaviate, means writing a one-off script every time. `vex` fixes that with a single open format and a growing connector library.

## Connectors

| Connector | Export | Import | Status |
|-----------|--------|--------|--------|
| `vektor` | ✅ | 🔜 v0.1 | Stable |
| `jsonl` | ✅ | ✅ | Stable |
| `pinecone` | 🔜 | ✅ | Tested |
| `qdrant` | 🔜 | ✅ | Tested |
| `chroma` | 🔜 | 🔜 | Phase 2 |
| `weaviate` | 🔜 | 🔜 | Phase 2 |
| `pgvector` | 🔜 | 🔜 | Phase 2 |

## Install

```bash
npm install -g vex
# or run without installing
npx vex
```

**Requirements:** Node.js >= 18 (native fetch required). No other dependencies for Pinecone or Qdrant — connectors use the built-in fetch API.

## Commands

### Export

```bash
vex export --from vektor --db ./slipstream-memory.db --output memories.vmig.jsonl
vex export --from vektor --db ./memory.db --namespace trading --output trading.vmig.jsonl
```

### Import

```bash
# Pinecone
vex import --from memories.vmig.jsonl --to pinecone \
  --api-key $PINECONE_API_KEY \
  --index my-index \
  --host https://my-index-xxxx.svc.pinecone.io

# Qdrant
vex import --from memories.vmig.jsonl --to qdrant \
  --url https://xxxx.cloud.qdrant.io:6333 \
  --collection my-collection \
  --api-key $QDRANT_API_KEY
```

### Migrate (direct, no intermediate file)

```bash
vex migrate --from vektor --to qdrant \
  --db ./memory.db \
  --url http://localhost:6333 \
  --collection memories
```

## .vmig.jsonl Format

One JSON object per line. Designed to be portable across any vector store.

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
- `score` field included — useful for search-result exports
- Sidecar `.vmig.meta.json` for file-level metadata (record count, checksum, source version)

## Embedding Handling

| Scenario | Behaviour |
|----------|-----------|
| Same model, same dims | Vectors copied directly — no re-embedding |
| Dim mismatch with target index | Records skipped with warning |
| `null` vector | Record skipped with warning |
| Different model (v0.2) | Re-embed from `text` field |

The connector auto-detects target index dimension (Pinecone: queries index metadata, Qdrant: queries collection config) and filters records accordingly.

## Sidecar Metadata

Each export produces a `.vmig.meta.json` alongside the data file:

```json
{
  "exported_at": "2025-01-15T10:23:00.000Z",
  "source_store": "vektor",
  "source_version": "1.5.2",
  "record_count": 5026,
  "checksum": "sha256:abc123..."
}
```

## Roadmap

**v0.0.1 — now**
- VEKTOR export
- JSONL round-trip
- Pinecone import (tested: 4,900 vectors)
- Qdrant import (tested: 3,917 vectors)

**v0.1**
- VEKTOR import (round-trip complete)
- ChromaDB connector
- `--namespace` filter on all connectors
- `--limit` flag for partial exports

**v0.2**
- Weaviate, pgvector connectors
- Re-embedding pipeline (different model → re-embed from text)
- Streaming for large datasets

**v0.3 (premium)**
- Pre-trained Drift-Adapter weights (vec2vec translation without re-embedding)
- Multimodal support

## Science

Mixed-model migration in v0.2+ is based on:
- [vec2vec (Jha et al., Cornell 2025)](https://arxiv.org/abs/arXiv:2505.12540) cross-model vector translation
- Drift-Adapter — lightweight adapter for embedding space alignment

## Contributing

PRs welcome — especially new connectors. Each connector is a single file in `connectors/` implementing `{ extract(opts), load(records, opts) }`.

See `connectors/qdrant.js` as the reference implementation.

## License

Apache 2.0 — free to use, fork, clone, build on or turn into a nft and get rich! 

---

Built by [VEKTOR](https://vektormemory.com) — persistent semantic memory for AI agents.
