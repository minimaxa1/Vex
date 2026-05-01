import { batchLoad } from '../utils/batch.js';

export const qdrantConnector = {
  name: 'qdrant',

  async extract(opts) {
    throw new Error('[qdrant] export from Qdrant not supported in v0.0.1');
  },

  async load(records, opts) {
    const url        = opts['url']        || process.env.QDRANT_URL || 'http://localhost:6333';
    const collection = opts['collection'] || process.env.QDRANT_COLLECTION;
    const apiKey     = opts['api-key']    || process.env.QDRANT_API_KEY || '';
    if (!collection) throw new Error('[qdrant] --collection or QDRANT_COLLECTION required');

    const withVectors = records.filter(r => r.vector && r.vector.length > 0);
    const skipped = records.length - withVectors.length;
    if (skipped > 0) console.warn(`[qdrant] skipping ${skipped} records with null embeddings`);

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['api-key'] = apiKey;

    let upserted = 0;
    await batchLoad(withVectors, async (batch) => {
      const points = batch.map(r => ({
        id: isNaN(r.id) ? r.id : parseInt(r.id),
        vector: r.vector,
        payload: {
          text: r.text || '',
          namespace: r.namespace || '',
          model: r.model || '',
          created_at: r.created_at || '',
          ...r.metadata
        }
      }));
      const res = await fetch(`${url}/collections/${collection}/points`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ points })
      });
      if (!res.ok) throw new Error(`[qdrant] upsert failed: ${await res.text()}`);
      upserted += batch.length;
    }, { batchSize: 100, onProgress: (d, t) => process.stdout.write(`\r[qdrant] ${d}/${t}`) });

    console.log(`\n[qdrant] upserted ${upserted} vectors`);
  }
};
