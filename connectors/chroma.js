import { batchLoad } from '../utils/batch.js';
import { progress, summary } from '../utils/progress.js';
import { toRecord } from '../formats/vmig.js';

export const chromaConnector = {
  name: 'chroma',

  // ── EXPORT ───────────────────────────────────────────────────────────────
  async extract(opts) {
    const t0         = Date.now();
    const url        = opts['url']        || process.env.CHROMA_URL        || 'http://localhost:8000';
    const collection = opts['collection'] || process.env.CHROMA_COLLECTION;
    const tenant     = opts['tenant']     || 'default_tenant';
    const database   = opts['database']   || 'default_database';
    const namespace  = opts['namespace']  || null;
    const limit      = opts['limit']      ? parseInt(opts['limit']) : null;

    if (!collection) throw new Error('[chroma] --collection or CHROMA_COLLECTION required');

    const base = `${url}/api/v1/collections`;

    // get collection ID
    const colRes = await fetch(`${base}/${collection}?tenant=${tenant}&database=${database}`);
    if (!colRes.ok) throw new Error(`[chroma] collection not found: ${collection}`);
    const colData  = await colRes.json();
    const colId    = colData.id;
    const colCount = colData.count ?? '?';
    console.log(`[chroma] collection "${collection}" (id: ${colId}) — ${colCount} items`);

    // get all items
    const records = [];
    const pageSize = 100;
    let offset     = 0;

    while (true) {
      const body = {
        limit:           pageSize,
        offset,
        include:         ['embeddings', 'documents', 'metadatas'],
      };
      if (namespace) {
        body.where = { namespace: { '$eq': namespace } };
      }

      const res = await fetch(`${base}/${colId}/get`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`[chroma] get failed: ${await res.text()}`);
      const data = await res.json();

      const ids       = data.ids         || [];
      const embeddings= data.embeddings  || [];
      const documents = data.documents   || [];
      const metadatas = data.metadatas   || [];

      if (!ids.length) break;

      for (let i = 0; i < ids.length; i++) {
        const meta = metadatas[i] || {};
        const { namespace: ns, model, created_at, ...rest } = meta;
        records.push(toRecord({
          id:         ids[i],
          text:       documents[i]   || null,
          vector:     embeddings[i]  || null,
          model:      model          || null,
          namespace:  ns             || null,
          created_at: created_at     || null,
          metadata:   rest,
        }, 'chroma'));

        if (limit && records.length >= limit) break;
      }

      progress(records.length, limit ?? (typeof colCount === 'number' ? colCount : records.length), 'chroma export');

      if (limit && records.length >= limit) break;
      if (ids.length < pageSize) break;
      offset += pageSize;
    }

    process.stdout.write('\n');
    console.log(`[chroma] extracted ${records.length} records in ${((Date.now()-t0)/1000).toFixed(1)}s`);
    return records;
  },

  // ── IMPORT ───────────────────────────────────────────────────────────────
  async load(records, opts) {
    const t0         = Date.now();
    const url        = opts['url']        || process.env.CHROMA_URL        || 'http://localhost:8000';
    const collection = opts['collection'] || process.env.CHROMA_COLLECTION;
    const tenant     = opts['tenant']     || 'default_tenant';
    const database   = opts['database']   || 'default_database';

    if (!collection) throw new Error('[chroma] --collection or CHROMA_COLLECTION required');

    const base = `${url}/api/v1/collections`;

    // get or create collection
    console.log(`[chroma] resolving collection "${collection}"...`);
    let colId;

    const getRes = await fetch(`${base}/${collection}?tenant=${tenant}&database=${database}`);
    if (getRes.ok) {
      colId = (await getRes.json()).id;
      console.log(`[chroma] found collection (id: ${colId})`);
    } else {
      // create it
      console.log(`[chroma] creating collection "${collection}"...`);
      const createRes = await fetch(`${base}?tenant=${tenant}&database=${database}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: collection, metadata: { 'hnsw:space': 'cosine' } }),
      });
      if (!createRes.ok) throw new Error(`[chroma] create failed: ${await createRes.text()}`);
      colId = (await createRes.json()).id;
      console.log(`[chroma] ✓ collection created (id: ${colId})`);
    }

    const withVectors = records.filter(r => Array.isArray(r.vector) && r.vector.length > 0);
    const skipped     = records.length - withVectors.length;
    if (skipped)           console.warn(`[chroma] ⚠  ${skipped} records skipped (null vector)`);
    if (!withVectors.length) { console.error('[chroma] ✗  nothing to upsert'); return; }

    let upserted = 0;
    await batchLoad(withVectors, async batch => {
      const body = {
        ids:        batch.map(r => String(r.id)),
        embeddings: batch.map(r => r.vector),
        documents:  batch.map(r => r.text || ''),
        metadatas:  batch.map(r => ({
          namespace:  r.namespace  || '',
          model:      r.model      || '',
          created_at: r.created_at || '',
          ...r.metadata,
        })),
      };

      const res = await fetch(`${base}/${colId}/upsert`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`[chroma] upsert failed: ${await res.text()}`);
      upserted += batch.length;
    }, { batchSize: 100, retries: 3, onProgress: (d,t) => progress(d,t,'chroma') });

    summary({ connector:'chroma', total:records.length, upserted, skipped, durationMs:Date.now()-t0 });
  },
};
