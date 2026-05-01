import { batchLoad } from '../utils/batch.js';
import { progress, summary } from '../utils/progress.js';

export const pineconeConnector = {
  name: 'pinecone',

  async extract(opts) {
    throw new Error('[pinecone] export from Pinecone not yet supported (Phase 2)');
  },

  async load(records, opts) {
    const t0     = Date.now();
    const apiKey = opts['api-key']   || process.env.PINECONE_API_KEY;
    const index  = opts['index']     || process.env.PINECONE_INDEX;
    const host   = opts['host']      || process.env.PINECONE_HOST;
    const ns     = opts['namespace'] || '';

    if (!apiKey) throw new Error('[pinecone] --api-key or PINECONE_API_KEY required');
    if (!index)  throw new Error('[pinecone] --index  or PINECONE_INDEX  required');
    if (!host)   throw new Error('[pinecone] --host   or PINECONE_HOST   required');

    // ── fetch index dimension ──────────────────────────────────────────────
    console.log(`[pinecone] fetching index metadata for "${index}"...`);
    const metaRes = await fetch(`https://api.pinecone.io/indexes/${index}`, {
      headers: { 'Api-Key': apiKey },
    });
    if (!metaRes.ok) throw new Error(`[pinecone] index metadata failed: ${await metaRes.text()}`);
    const { dimension: indexDim } = await metaRes.json();
    console.log(`[pinecone] index dimension: ${indexDim}`);

    // ── dimension filter ───────────────────────────────────────────────────
    const withVectors = records.filter(r => Array.isArray(r.vector) && r.vector.length === indexDim);
    const skipped     = records.length - withVectors.length;

    if (skipped > 0) {
      console.warn(`[pinecone] ⚠  ${skipped} records skipped (null vector or dim mismatch — index expects ${indexDim})`);
    }
    if (withVectors.length === 0) {
      console.error('[pinecone] ✗  no records match index dimension — nothing to upsert');
      return;
    }

    console.log(`[pinecone] upserting ${withVectors.length} records...`);
    let upserted = 0;

    await batchLoad(withVectors, async (batch) => {
      const vectors = batch.map(r => ({
        id:     String(r.id),
        values: r.vector,
        metadata: {
          text:       (r.text || '').slice(0, 512),
          namespace:  r.namespace  || '',
          model:      r.model      || '',
          created_at: r.created_at || '',
          ...r.metadata,
        },
      }));

      const res = await fetch(`${host}/vectors/upsert`, {
        method:  'POST',
        headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ vectors, namespace: ns }),
      });
      if (!res.ok) throw new Error(`[pinecone] upsert failed: ${await res.text()}`);
      upserted += batch.length;
    }, {
      batchSize:  100,
      retries:    3,
      onProgress: (d, t) => progress(d, t, 'pinecone'),
    });

    summary({ connector: 'pinecone', total: records.length, upserted, skipped, durationMs: Date.now() - t0 });
  },
};
