# SPEC.md - VEX interchange format v1.0.0

## File format: .vmig.jsonl
One JSON object per line. UTF-8. LF endings. Apache 2.0.

## Fields
| Field | Type | Status | Description |
|---|---|---|---|
| id | string | REQUIRED | Stable unique ID. UUIDv4 if none. |
| text | string or null | CONDITIONAL | Raw source text. Required for re-embed strategy. |
| vector | float[] or null | CONDITIONAL | Flat float array. Null if re-embedding on import. |
| model | string or null | OPTIONAL | Embedding model id e.g. bge-small-en-v1.5 |
| dims | int or null | OPTIONAL | Must equal vector.length. |
| namespace | string or null | OPTIONAL | Logical partition. Top-level field. |
| metadata | object or null | OPTIONAL | Flat key-value only. No nesting. |
| created_at | string or null | OPTIONAL | ISO 8601 timestamp. |
| source_store | string or null | OPTIONAL | vektor, pinecone, qdrant etc. |
| modality | string | OPTIONAL | Default: text. |
| score | float or null | OPTIONAL | Similarity score from search export. |
| vex_version | string | REQUIRED | Semver e.g. 1.0.0 |

## Validation rules
- At least one of text or vector must be non-null
- dims must equal vector.length when both present
- id must be unique within a file
- metadata values must be scalar only

## Embedding strategy
1. Same model: copy vector directly
2. Different model + text: re-embed
3. No text: Drift-Adapter (Phase 3)
