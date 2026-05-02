import { vektorConnector }   from './vektor.js';
import { jsonlConnector }    from './jsonl.js';
import { pineconeConnector } from './pinecone.js';
import { qdrantConnector }   from './qdrant.js';
import { chromaConnector }   from './chroma.js';

const CONNECTORS = {
  vektor:   vektorConnector,
  jsonl:    jsonlConnector,
  pinecone: pineconeConnector,
  qdrant:   qdrantConnector,
  chroma:   chromaConnector,
};

export function getConnector(name) {
  const c = CONNECTORS[name?.toLowerCase()];
  if (!c) throw new Error(
    `Unknown connector: "${name}". Available: ${Object.keys(CONNECTORS).join(', ')}`
  );
  return c;
}
