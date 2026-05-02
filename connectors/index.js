import { vektorConnector }   from './vektor.js';
import { jsonlConnector }    from './jsonl.js';
import { pineconeConnector } from './pinecone.js';
import { qdrantConnector }   from './qdrant.js';
import { chromaConnector }   from './chroma.js';
import { weaviateConnector } from './weaviate.js';
import { pgvectorConnector } from './pgvector.js';

const CONNECTORS = {
  vektor:   vektorConnector,
  jsonl:    jsonlConnector,
  pinecone: pineconeConnector,
  qdrant:   qdrantConnector,
  chroma:   chromaConnector,
  weaviate: weaviateConnector,
  pgvector: pgvectorConnector,
};

export function getConnector(name) {
  const c = CONNECTORS[name?.toLowerCase()];
  if (!c) throw new Error(
    `Unknown connector: "${name}". Available: ${Object.keys(CONNECTORS).join(', ')}`
  );
  return c;
}
