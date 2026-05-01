import { jsonlConnector }    from './jsonl.js';
import { vektorConnector }   from './vektor.js';
import { pineconeConnector } from './pinecone.js';
import { qdrantConnector }   from './qdrant.js';

const registry = {
  jsonl:    jsonlConnector,
  vektor:   vektorConnector,
  pinecone: pineconeConnector,
  qdrant:   qdrantConnector,
};

export function getConnector(name) {
  const c = registry[name];
  if (!c) throw new Error(`Unknown connector: ${name}. Available: ${Object.keys(registry).join(', ')}`);
  return c;
}
