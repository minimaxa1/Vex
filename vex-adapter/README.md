# vex — Vector Exchange

> Cross-standard vector DB migration tool. Export, import, and migrate agent memory between vector stores using the open `.vmig.jsonl` interchange format.

```bash
npx vex export --from vektor --db slipstream-memory.db --output memories.vmig.jsonl
npx vex import --from memories.vmig.jsonl --to pinecone --api-key $KEY --index my-index --host $HOST
npx vex import --from memories.vmig.jsonl --to qdrant --collection memories
npx vex migrate --from vektor --to qdrant --db memory.db --url http://localhost:6333 --collection memories
```

## Why

Every vector DB has a different API, a different format, and zero interop. Moving your agent memory from VEKTOR to Pinecone, or Qdrant to Weaviate, means writing a one-off script every time.

`vex` fixes that with a single open format and a growing connector library. Your memory is always exportable, always portable, always yours.

## Connectors

| Connector | Export | Import | Status |
|-----------|--------|--------|--------|
| `vektor`   | ✅ | ✅ | Stable |
| `jsonl`    | ✅ | ✅ | Stable |
| `pinecone` | ✅ | ✅ | Stable — tested 4,900 vectors |
| `qdrant`   | ✅ | ✅ | Stable — tested 3,917 vectors, auto-create |
| `chroma`   | ✅ | ✅ | Stable |
| `weaviate` | 🔜 | 🔜 | v0.4 |
| `pgvector` | 🔜 | 🔜 | v0.4 |

## Install

```bash
npm install -g vex
# or run without installing
npx vex --help
```

**Requirements:** Node.js >= 18 (native fetch required). No extra dependencies for Pinecone or Qdrant — connectors use the built-in fetch API.

## Commands

### Export

```bash
# Export VEKTOR memory to portable .vmig.jsonl file
vex export --from vektor --db ./slipstream-memory.db --output memories.vmig.jsonl

# Export a specific namespace only
vex export --from vektor --db ./memory.db --namespace trading --output trading.vmig.jsonl
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
```

### Migrate (direct — no intermediate file)

```bash
# VEKTOR → Qdrant in one command
vex migrate --from vektor --to qdrant \
  --db ./memory.db \
  --url http://localhost:6333 \
  --collection memories
```

### Adapt (vec2vec — no re-embedding)

Switch embedding models without re-embedding. Uses pre-trained linear projection matrices to translate vectors directly between model spaces in milliseconds.

```bash
# Install the adapter
npm install -g @vektormemory/vex-adapter

# Translate a .vmig file from one model space to another
vex-adapt --from bge-small-en-v1.5 --to text-embedding-3-small input.vmig output.vmig

# List all bundled projection pairs
vex-adapt --list

# Train a custom projection from your own aligned pairs
vex-adapt train --from my-model --to text-embedding-3-small --pairs aligned.jsonl
```

See [@vektormemory/vex-adapter](https://github.com/Vektor-Memory/vex-adapter) for full docs and bundled projection pairs.

---

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
- `text` field always preserved — enables cross-model re-embedding
- `score` field included — useful for search-result exports
- Sidecar `.vmig.meta.json` for file-level metadata (record count, SHA-256 checksum, source store)

## Embedding Handling

| Scenario | Behaviour |
|----------|-----------|
| Same model, same dims | Vectors copied directly — no re-embedding |
| Different model, compatible dims | Use `vex-adapt` for vec2vec translation — no API calls |
| Dim mismatch with target | Records skipped with warning + count in summary |
| `null` vector | Record skipped with warning |

Connectors auto-detect target dimension (Pinecone: queries index metadata API, Qdrant: queries collection config) and filter records accordingly. Batch retry logic (3x with backoff) built in.

## Sidecar Metadata

Each export and import produces a `.vmig.meta.json` alongside the data file:

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

Every import shows a live progress bar and a summary block:

```
[████████████████████] 100% pinecone (4900/4900)

┌─ pinecone summary ─────────────────────────
│  total records   : 4900
│  upserted        : 4900
│  skipped         : 0
│  duration        : 87.3s
└────────────────────────────────────────────
```

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
- Pinecone export
- Qdrant export
- ChromaDB connector (import + export)
- `--reembed` flag — re-embed from `text` field via new model
- `--embed-model` flag — specify target embedding model
- Streaming for large datasets

**v0.3.0 — shipped**
- `@vektormemory/vex-adapter` — vec2vec linear projection (no re-embedding, no API calls)
- 7 bundled pre-trained projection pairs (BGE, MiniLM, mpnet, E5, ada-002 → OpenAI 3-small/large)
- `vex-adapt` CLI — adapt any `.vmig` file between model spaces in seconds
- Custom projection training via `vex-adapt train`

**v0.4 — next**
- Weaviate connector
- pgvector connector
- `--namespace` filter on all connectors
- `--limit` flag for partial exports

## Contributing

PRs welcome — especially new connectors.

Each connector is a single file in `connectors/` implementing two functions:

```js
{ extract(opts), load(records, opts) }
```

See `connectors/qdrant.js` as the reference implementation. The Vex core handles batching, dimension filtering, retry, progress, and sidecar generation.

## Reproducing / retraining weights

The bundled projection files were generated using `scripts/generate-weights.py`.
To retrain or add a new model pair:

pip install sentence-transformers datasets openai numpy tqdm
cd vex-adapter
python scripts/generate-weights.py

Outputs go to adapter/projections/. Add your new pair to BUNDLED_PROJECTIONS
in adapter/models.js before publishing.

##Note: Projection weight files are not stored in this repo due to size (12–66MB each). They ship with the npm package (npm install -g @vektormemory/vex-adapter) or can be regenerated locally via scripts/generate-weights.py.

## License

Apache 2.0 — free to use, fork, and build on.

---

Built by [VEKTOR](https://vektormemory.com) — persistent semantic memory for AI agents.
