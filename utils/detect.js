const MODEL_DIMS = {
  'bge-small-en-v1.5':       384,
  'bge-base-en-v1.5':        768,
  'bge-large-en-v1.5':      1024,
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'nomic-embed-text':        768,
};

export function detectModel(record) {
  if (record.model) return record.model;
  if (record.vector) {
    const d = record.vector.length;
    return Object.entries(MODEL_DIMS).find(([, v]) => v === d)?.[0] ?? null;
  }
  return null;
}

export function sameModel(a, b) {
  return a && b && a === b;
}
