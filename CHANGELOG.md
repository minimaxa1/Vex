# CHANGELOG.md

## [0.1.0] - 2026-05-02

### Added
- `vex import` — load `.vmig.jsonl` into any connector
- Pinecone import connector — dimension auto-detect, batch upsert, 3x retry
- Qdrant import connector — collection auto-create, dimension check, batch upsert, 3x retry
- `utils/checksum.js` — SHA-256 checksumming for records and files
- `utils/batch.js` — retry logic with configurable retries + delay
- `utils/progress.js` — `summary()` block with total/upserted/skipped/duration
- `formats/vmig.js` — `writeMeta()` now includes `sha256:` checksum field
- `vex migrate` now supported for all connector combinations
- `--auto-create` flag on Qdrant connector (default true)
- ENV fallback for all connector credentials

### Changed
- `vex.mjs` bumped to v0.1.0
- `vex import` writes updated `.vmig.meta.json` sidecar after import (records imported_to, imported_at)
- Progress bar uses `utils/progress.js` across all connectors (consistent)

### Connectors

| Connector | Export | Import | Status    |
|-----------|--------|--------|-----------|
| vektor    | ✅     | Phase 2| Stable    |
| jsonl     | ✅     | ✅     | Stable    |
| pinecone  | Phase 2| ✅     | v0.1 new  |
| qdrant    | Phase 2| ✅     | v0.1 new  |

---

## [0.0.1] - 2026-05-01

### Added
- Initial scaffold
- `.vmig.jsonl` format spec v1.0.0
- `formats/vmig.js` — reader, writer, validator
- Connectors: jsonl, vektor (export only)
- CLI: `vex export --from vektor --output file.vmig.jsonl`
