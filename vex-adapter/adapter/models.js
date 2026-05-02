/**
 * adapter/models.js — registry of known model pairs + dim configs
 */

export const MODELS = {
  // OpenAI
  'text-embedding-3-small':  { dims: 1536, provider: 'openai' },
  'text-embedding-3-large':  { dims: 3072, provider: 'openai' },
  'text-embedding-ada-002':  { dims: 1536, provider: 'openai' },
  // BGE (BAAI)
  'bge-small-en-v1.5':       { dims: 384,  provider: 'local' },
  'bge-base-en-v1.5':        { dims: 768,  provider: 'local' },
  'bge-large-en-v1.5':       { dims: 1024, provider: 'local' },
  // E5
  'e5-small-v2':             { dims: 384,  provider: 'local' },
  'e5-base-v2':              { dims: 768,  provider: 'local' },
  'e5-large-v2':             { dims: 1024, provider: 'local' },
  // Sentence Transformers
  'all-MiniLM-L6-v2':        { dims: 384,  provider: 'local' },
  'all-MiniLM-L12-v2':       { dims: 384,  provider: 'local' },
  'all-mpnet-base-v2':       { dims: 768,  provider: 'local' },
  // Cohere
  'embed-english-v3.0':      { dims: 1024, provider: 'cohere' },
  'embed-english-light-v3.0':{ dims: 384,  provider: 'cohere' },
  // Vektor native
  'vektor-v1':               { dims: 768,  provider: 'vektor' },
};

// Pre-trained projection pairs bundled with the package
// key format: "from--to"
export const BUNDLED_PROJECTIONS = [
  'bge-small-en-v1.5--text-embedding-3-small',
  'bge-base-en-v1.5--text-embedding-3-small',
  'bge-large-en-v1.5--text-embedding-3-large',
  'all-MiniLM-L6-v2--text-embedding-3-small',
  'all-mpnet-base-v2--text-embedding-3-small',
  'text-embedding-ada-002--text-embedding-3-small',
  'e5-base-v2--text-embedding-3-small',
];

export function getModelInfo(name) {
  // normalize: strip provider prefix e.g. "ollama:bge-small" → "bge-small-en-v1.5"
  const clean = name.replace(/^(ollama:|openai:|cohere:)/, '');
  return MODELS[clean] || null;
}

export function pairKey(from, to) {
  return `${from}--${to}`;
}

export function listPairs() {
  return BUNDLED_PROJECTIONS;
}


