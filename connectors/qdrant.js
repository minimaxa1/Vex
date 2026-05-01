import { batchLoad } from '../utils/batch.js';
import { progress, summary } from '../utils/progress.js';

export const qdrantConnector = {
  name: 'qdrant',

  async extract(opts) {
    throw new Error('[qdrant] export from Qdrant not yet supported (Phase 2)');
  },

  async load(records, opts) {
    const t0         = Date.now();
    const url        = opts['url']         || process.env.QDRANT_URL        || 'http://localhost:6333';
    const collection = opts['collection']  || process.env.QDRANT_COLLECTION;
    const apiKey     = opts['api-key']     || process.env.QDRANT_API_KEY    || '';
    const autoCreate = opts['auto-create'] !== 'false';

    if (!collection) throw new Error('[qdrant] --collection or QDRANT_COLLECTION required');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['api-key'] = apiKey;

    // ── check / create collection ──────────────────────────────────────────
    console.log(`[qdrant] checking collection "${collection}"...`);
    const colRes = await fetch(`${url}/collections/${collection}`, { headers });
    let colDim = null;

    if (colRes.status === 404) {
      const firstVec = records.find(r => Array.isArray(r.vector));
      if (!firstVec) throw new Error('[qdrant] no records with vectors — cannot auto-create collection');
      colDim = firstVec.vector.length;

      if (!autoCreate) throw new Error(`[qdrant] collection "${collection}" not found. Create it first or omit --auto-create false.`);

      console.log(`[qdrant] collection not found — auto-creating (dim=${colDim}, distance=Cosine)`);
      const createRes = await fetch(`${url}/collections/${collection}`, {
        method:  'PUT',
        headers,
        body:    JSON.stringify({ vectors: { size: colDim, distance: 'Cosine' } }),
      });
      if (!createRes.ok) throw new Error(`[qdrant] collection create failed: ${await createRes.text()}`);
      console.log(`[qdrant] ✓ collection "${collection}" created`);

    } else if (colRes.ok) {
      const colData = await colRes.json();
      colDim = colData.result?.config?.params?.vectors?.size
            ?? colData.result?.config?.params?.vectors?.default?.size
            ?? null;
      if (colDim) console.log(`[qdrant] collection dimension: ${colDim}`);
      else        console.warn('[qdrant] ⚠  could not read collection dimension — skipping dim check');
    } else {
      throw new Error(`[qdrant] collection check failed: ${await colRes.text()}`);
    }

    // ── dimension filter ───────────────────────────────────────────────────
    const withVectors = colDim
      ? records.filter(r => Array.isArray(r.vector) && r.vector.length === colDim)
      : records.filter(r => Array.isArray(r.vector) && r.vector.length > 0);

    const skipped = records.length - withVectors.length;
    if (skipped > 0) {
      console.warn(`[qdrant] ⚠  ${skipped} records skipped (null vector or dim mismatch${colDim ? ` — collection expects ${colDim}` : ''})`);
    }
    if (withVectors.length === 0) {
      console.error('[qdrant] ✗  no records to upsert');
      return;
    }

    console.log(`[qdrant] upserting ${withVectors.length} records...`);
    let upserted = 0;

    await batchLoad(withVectors, async (batch) => {
      const points = batch.map(r => ({
        id:      isNaN(r.id) ? r.id : parseInt(r.id),
        vector:  r.vector,
        payload: {
          text:       r.text        || '',
          namespace:  r.namespace   || '',
          model:      r.model       || '',
          created_at: r.created_at  || '',
          ...r.metadata,
        },
      }));

      const res = await fetch(`${url}/collections/${collection}/points`, {
        method:  'PUT',
        headers,
        body:    JSON.stringify({ points }),
      });
      if (!res.ok) throw new Error(`[qdrant] upsert failed: ${await res.text()}`);
      upserted += batch.length;
    }, {
      batchSize:  100,
      retries:    3,
      onProgress: (d, t) => progress(d, t, 'qdrant'),
    });

    summary({ connector: 'qdrant', total: records.length, upserted, skipped, durationMs: Date.now() - t0 });
  },
};
