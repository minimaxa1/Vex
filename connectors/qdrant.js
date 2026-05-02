import { batchLoad } from '../utils/batch.js';
import { progress, summary } from '../utils/progress.js';
import { toRecord } from '../formats/vmig.js';

export const qdrantConnector = {
    name: 'qdrant',

    // ── EXPORT ───────────────────────────────────────────────────────────────
    async extract(opts) {
        const t0 = Date.now();
        const url = opts['url'] || process.env.QDRANT_URL || 'http://localhost:6333';
        const collection = opts['collection'] || process.env.QDRANT_COLLECTION;
        const apiKey = opts['api-key'] || process.env.QDRANT_API_KEY || '';
        const namespace = opts['namespace'] || null;
        const limit = opts['limit'] ? parseInt(opts['limit']) : null;

        if (!collection) throw new Error('[qdrant] --collection or QDRANT_COLLECTION required');

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['api-key'] = apiKey;

        // get total count
        const colRes = await fetch(`${url}/collections/${collection}`, { headers });
        if (!colRes.ok) throw new Error(`[qdrant] collection check failed: ${await colRes.text()}`);
        const colData = await colRes.json();
        const total = colData.result ?.points_count ?? '?';
        console.log(`[qdrant] collection "${collection}" — ${total} points`);

        // scroll all points
        const records = [];
        let offset = null;
        let page = 0;

        while (true) {
            const body = { limit: 100, with_vectors: true, with_payload: true };
            if (offset) body.offset = offset;
            if (namespace) body.filter = {
                must: [{ key: 'namespace', match: { value: namespace } }],
            };

            const res = await fetch(`${url}/collections/${collection}/points/scroll`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`[qdrant] scroll failed: ${await res.text()}`);

            const data = await res.json();
            const points = data.result ?.points ?? [];
            if (!points.length) break;

            for (const pt of points) {
                const { text, namespace: ns, model, created_at, ...rest } = pt.payload || {};
                records.push(toRecord({
                    id: String(pt.id),
                    text: text || null,
                    vector: Array.isArray(pt.vector) ? pt.vector : Object.values(pt.vector ?? {})[0] ?? null,
                    model: model || null,
                    namespace: ns || null,
                    created_at: created_at || null,
                    metadata: Object.fromEntries(
                        Object.entries(rest).filter(([, v]) => typeof v !== 'object' || v === null)
                    ),
                }, 'qdrant'));

                if (limit && records.length >= limit) break;
            }

            progress(records.length, limit ?? (typeof total === 'number' ? total : records.length), 'qdrant export');

            if (limit && records.length >= limit) break;
            offset = data.result ?.next_page_offset;
            if (!offset) break;
            page++;
        }

        process.stdout.write('\n');
        console.log(`[qdrant] extracted ${records.length} records in ${((Date.now()-t0)/1000).toFixed(1)}s`);
        return records;
    },

    // ── IMPORT ───────────────────────────────────────────────────────────────
    async load(records, opts) {
        const t0 = Date.now();
        const url = opts['url'] || process.env.QDRANT_URL || 'http://localhost:6333';
        const collection = opts['collection'] || process.env.QDRANT_COLLECTION;
        const apiKey = opts['api-key'] || process.env.QDRANT_API_KEY || '';
        const autoCreate = opts['auto-create'] !== 'false';

        if (!collection) throw new Error('[qdrant] --collection or QDRANT_COLLECTION required');

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['api-key'] = apiKey;

        console.log(`[qdrant] checking collection "${collection}"...`);
        const colRes = await fetch(`${url}/collections/${collection}`, { headers });
        let colDim = null;

        if (colRes.status === 404) {
            const firstVec = records.find(r => Array.isArray(r.vector));
            if (!firstVec) throw new Error('[qdrant] no records with vectors — cannot auto-create');
            colDim = firstVec.vector.length;
            if (!autoCreate) throw new Error(`[qdrant] collection "${collection}" not found`);
            console.log(`[qdrant] auto-creating collection (dim=${colDim}, distance=Cosine)`);
            const cr = await fetch(`${url}/collections/${collection}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ vectors: { size: colDim, distance: 'Cosine' } }),
            });
            if (!cr.ok) throw new Error(`[qdrant] create failed: ${await cr.text()}`);
            console.log(`[qdrant] ✓ collection created`);
        } else if (colRes.ok) {
            const cd = await colRes.json();
 colDim = cd.result?.config?.params?.vectors?.size ?? cd.result?.config?.params?.vectors?.default?.size ?? null;
            if (colDim) console.log(`[qdrant] collection dimension: ${colDim}`);
        } else {
            throw new Error(`[qdrant] collection check failed: ${await colRes.text()}`);
        }

        const withVectors = colDim ?
            records.filter(r => Array.isArray(r.vector) && r.vector.length === colDim) :
            records.filter(r => Array.isArray(r.vector) && r.vector.length > 0);
        const skipped = records.length - withVectors.length;
        if (skipped) console.warn(`[qdrant] ⚠  ${skipped} records skipped (dim mismatch or null vector)`);
        if (!withVectors.length) { console.error('[qdrant] ✗  nothing to upsert'); return; }

        let upserted = 0;
        await batchLoad(withVectors, async batch => {
            const points = batch.map(r => ({
                id: isNaN(r.id) ? r.id : parseInt(r.id),
                vector: r.vector,
                payload: { text: r.text || '', namespace: r.namespace || '', model: r.model || '', created_at: r.created_at || '', ...r.metadata },
            }));
            const res = await fetch(`${url}/collections/${collection}/points`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ points }),
            });
            if (!res.ok) throw new Error(`[qdrant] upsert failed: ${await res.text()}`);
            upserted += batch.length;
        }, { batchSize: 100, retries: 3, onProgress: (d, t) => progress(d, t, 'qdrant') });

        summary({ connector: 'qdrant', total: records.length, upserted, skipped, durationMs: Date.now() - t0 });
    },
async extractStream(opts, onPage) {
    const url        = opts['url']        || process.env.QDRANT_URL        || 'http://localhost:6333';
    const collection = opts['collection'] || process.env.QDRANT_COLLECTION;
    const apiKey     = opts['api-key']    || process.env.QDRANT_API_KEY    || '';
    const namespace  = opts['namespace']  || null;
    const limit      = opts['limit'] ? parseInt(opts['limit']) : null;

    if (!collection) throw new Error('[qdrant] --collection required');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['api-key'] = apiKey;

    const colRes  = await fetch(`${url}/collections/${collection}`, { headers });
    if (!colRes.ok) throw new Error(`[qdrant] collection check failed: ${await colRes.text()}`);
    const colData = await colRes.json();
    const total   = colData.result?.points_count ?? '?';
    console.log(`[qdrant] stream export — "${collection}" (${total} points)`);

    let offset = null;
    let sent   = 0;

    while (true) {
      const body = { limit: 100, with_vectors: true, with_payload: true };
      if (offset)    body.offset = offset;
      if (namespace) body.filter = { must: [{ key: 'namespace', match: { value: namespace } }] };

      const res  = await fetch(`${url}/collections/${collection}/points/scroll`,
        { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`[qdrant] scroll failed: ${await res.text()}`);
      const data = await res.json();
      const points = data.result?.points ?? [];
      if (!points.length) break;

      const page = [];
      for (const pt of points) {
        const { text, namespace: ns, model, created_at, ...rest } = pt.payload || {};
        page.push(toRecord({
          id:         String(pt.id),
          text:       text || null,
          vector:     Array.isArray(pt.vector) ? pt.vector : Object.values(pt.vector ?? {})[0] ?? null,
          model:      model || null,
          namespace:  ns || null,
          created_at: created_at || null,
          metadata:   Object.fromEntries(Object.entries(rest).filter(([,v]) => typeof v !== 'object' || v === null)),
        }, 'qdrant'));
        sent++;
        if (limit && sent >= limit) break;
      }

      await onPage(page);
      progress(sent, limit ?? (typeof total === 'number' ? total : sent), 'qdrant stream');

      if (limit && sent >= limit) break;
      offset = data.result?.next_page_offset;
      if (!offset) break;
    }
    process.stdout.write('\n');
  },
};