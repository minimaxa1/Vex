import { batchLoad } from '../utils/batch.js';

export const pineconeConnector = {
  name: 'pinecone',

  async extract(opts) {
    throw new Error('[pinecone] export from Pinecone not supported in v0.0.1');
  },

  async load(records, opts) {
    const apiKey = opts['api-key'] || process.env.PINECONE_API_KEY;
    const index  = opts['index']   || process.env.PINECONE_INDEX;
    const host   = opts['host']    || process.env.PINECONE_HOST;
    if (!apiKey) throw new Error('[pinecone] --api-key or PINECONE_API_KEY required');
    if (!index)  throw new Error('[pinecone] --index or PINECONE_INDEX required');
    if (!host)   throw new Error('[pinecone] --host or PINECONE_HOST required');

    // fetch index dimension so we can filter mismatched records
    const meta = await fetch(`https://api.pinecone.io/indexes/${index}`, {
      headers: { 'Api-Key': apiKey }
    });
    if (!meta.ok) throw new Error(`[pinecone] could not fetch index metadata: ${await meta.text()}`);
    const { dimension: indexDim } = await meta.json();
    console.log(`[pinecone] index dimension: ${indexDim}`);

    const withVectors = records.filter(r => r.vector && r.vector.length === indexDim);
    const skipped = records.length - withVectors.length;
    if (skipped > 0) console.warn(`[pinecone] skipping ${skipped} records (null or dim mismatch â€” index expects ${indexDim})`);

    if (withVectors.length === 0) {
      console.error('[pinecone] no records match index dimension â€” nothing to upsert');
      return;
    }

    let upserted = 0;
    await batchLoad(withVectors, async (batch) => {
      const vectors = batch.map(r => ({
        id: String(r.id),
        values: r.vector,
        metadata: {
          text: (r.text || '').slice(0, 512),
          namespace: r.namespace || '',
          model: r.model || '',
          created_at: r.created_at || '',
          ...r.metadata
        }
      }));
      const res = await fetch(`${host}/vectors/upsert`, {
        method: 'POST',
        headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ vectors, namespace: opts.namespace || '' })
      });
      if (!res.ok) throw new Error(`[pinecone] upsert failed: ${await res.text()}`);
      upserted += batch.length;
    }, { batchSize: 100, onProgress: (d, t) => process.stdout.write(`\r[pinecone] ${d}/${t}`) });

    console.log(`\n[pinecone] upserted ${upserted} vectors -> ${index}`);
  }
};
