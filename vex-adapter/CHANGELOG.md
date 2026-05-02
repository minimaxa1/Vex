# Changelog

All notable changes to `@vektormemory/vex-adapter` will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.1.0] — 2026-05-02

Initial release.

### Added

- **Linear projection engine** (`adapter/index.js`) — `projectVector()`, `adapt()`, `adaptRecords()`, `adaptStream()` — translates vectors between embedding model spaces using a pre-trained W matrix. No API calls, no re-embedding, pure matrix multiply.
- **7 bundled projection pairs** (`adapter/projections/`) — pre-trained on 50k sentences from the [AllNLI corpus](https://huggingface.co/datasets/sentence-transformers/all-nli):
  - `bge-small-en-v1.5` → `text-embedding-3-small` (384 → 1536)
  - `bge-base-en-v1.5` → `text-embedding-3-small` (768 → 1536)
  - `bge-large-en-v1.5` → `text-embedding-3-large` (1024 → 3072)
  - `all-MiniLM-L6-v2` → `text-embedding-3-small` (384 → 1536)
  - `all-mpnet-base-v2` → `text-embedding-3-small` (768 → 1536)
  - `text-embedding-ada-002` → `text-embedding-3-small` (1536 → 1536)
  - `e5-base-v2` → `text-embedding-3-small` (768 → 1536)
- **Model registry** (`adapter/models.js`) — 15 known models across OpenAI, BGE, E5, Sentence Transformers, Cohere, and Vektor native. `BUNDLED_PROJECTIONS` list, `getModelInfo()`, `pairKey()`, `listPairs()`.
- **SGD trainer** (`adapter/train.js`) — least-squares warm start + mini-batch SGD with momentum. 90/10 train/eval split, cosine similarity scoring. Saves projection as `.json`.
- **CLI** (`bin/vex-adapt.mjs`) — `vex-adapt --from <model> --to <model> input.vmig output.vmig`, `--list`, `vex-adapt train`.
- **Weight generation script** (`scripts/generate-weights.py`) — reproduces all 7 bundled projection files from scratch using AllNLI + local sentence-transformers + OpenAI embeddings API. Includes embedding cache to avoid redundant API calls across pairs.

### Training details

- **Corpus:** `sentence-transformers/all-nli`, `pair` split, 50,000 sentences (anchors + positives, deduplicated)
- **Method:** Least-squares closed-form warm start → mini-batch SGD, 200 epochs, batch size 512, lr=0.01 with 0.5× decay every 50 epochs, momentum=0.9
- **Evaluation:** Mean cosine similarity on 10% held-out split
- **Local embeddings:** `sentence-transformers` library, L2-normalised
- **OpenAI embeddings:** `text-embedding-3-small`, `text-embedding-3-large`, `text-embedding-ada-002` via API, L2-normalised

---

## [Unreleased]

### Planned for v0.2.0

- Additional bundled pairs — Cohere `embed-english-v3.0`, `nomic-embed-text`, `mistral-embed`
- `adaptStream()` — streaming adaptation for large `.vmig` files without loading into memory
- Inverse projections — `text-embedding-3-small` → `bge-small-en-v1.5`
- Quality threshold flag — `vex-adapt --min-cosine 0.85` to warn if projection quality is below threshold
- Integration with `vex migrate` — `--adapt-from` flag to chain migration + adaptation in one command

---

Built by [VEKTOR](https://vektormemory.com).
