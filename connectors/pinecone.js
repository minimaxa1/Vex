import { batchLoad, chunk } from '../utils/batch.js';
import { progress, summary } from '../utils/progress.js';
import { toRecord } from '../formats/vmig.js';

export const pineconeConnector = {
  name: 'pinecone',

  // ── EXPORT ───────────────────────────────────────────────────────────────
  async extract(opts) {
    const t0       = Date.now();
    const apiKey   = opts['api-key']   || process.env.PINECONE_API_KEY;
    const index    = opts['index']     || process.env.PINECONE_INDEX;
    const host     = opts['host']      || process.env.PINECONE_HOST;
    const ns       = opts['namespace'] || '';
    const limit    = opts['limit']     ? parseInt(opts['limit']) : null;

    if (!apiKey) throw new Error('[pinecone] --api-key or PINECONE_API_KEY required');
    if (!index)  throw new Error('[pinecone] --index  or PINECONE_INDEX  required');
    if (!host)   throw new Error('[pinecone] --host   or PINECONE_HOST   required');

    const h = { 'Api-Key': apiKey, 'Content-Type': 'application/json' };

    // get index dimension
    const metaRes = await fetch(`https://api.pinecone.io/indexes/${index}`, { headers: h });
    if (!metaRes.ok) throw new Error(`[pinecone] index metadata failed: ${await metaRes.text()}`);
    const { dimension } = await metaRes.json();
    console.log(`[pinecone] index "${index}" dimension: ${dimension}`);

    // step 1: list all IDs (paginated)
    const ids  = [];
    let pToken = undefined;

    console.log('[pinecone] listing all vector IDs...');
    while (true) {
      const url = new URL(`${host}/vectors/list`);
      if (ns)     url.searchParams.set('namespace',   ns);
      if (pToken) url.searchParams.set('paginationToken', pToken);
      url.searchParams.set('limit', '100');

      const res = await fetch(url.toString(), { headers: h });
      if (!res.ok) throw new Error(`[pinecone] list failed: ${await res.text()}`);
      const data = await res.json();

      const page = (data.vectors || []).map(v => v.id);
      ids.push(...page);
      if (limit && ids.length >= limit) { ids.splice(limit); break; }

      pToken = data.pagination?.next;
      if (!pToken) break;
      process.stdout.write(`\r[pinecone] listed ${ids.length} IDs...`);
    }
    process.stdout.write('\n');
    console.log(`[pinecone] ${ids.length} IDs found — fetching vectors...`);

    // step 2: fetch vectors in batches of 100
    const records = [];
    let fetched   = 0;

    for (const batch of chunk(ids, 100)) {
      const url = new URL(`${host}/vectors/fetch`);
      batch.forEach(id => url.searchParams.append('ids', id));
      if (ns) url.searchParams.set('namespace', ns);

      const res = await fetch(url.toString(), { headers: h });
      if (!res.ok) throw new Error(`[pinecone] fetch failed: ${await res.text()}`);
      const data = await res.json();

      for (const [id, vec] of Object.entries(data.vectors || {})) {
        const { text, namespace: vns, model, created_at, ...rest } = vec.metadata || {};
        records.push(toRecord({
          id,
          text:       text       || null,
          vector:     vec.values || null,
          dims:       vec.values?.length ?? dimension,
          model:      model      || null,
          namespace:  vns        || ns   || null,
          created_at: created_at || null,
          metadata:   Object.fromEntries(
            Object.entries(rest).filter(([,v]) => typeof v !== 'object' || v === null)
          ),
        }, 'pinecone'));
      }

      fetched += batch.length;
      progress(fetched, ids.length, 'pinecone export');
    }

    process.stdout.write('\n');
    console.log(`[pinecone] extracted ${records.length} records in ${((Date.now()-t0)/1000).toFixed(1)}s`);
    return records;
  },

  // ── IMPORT ───────────────────────────────────────────────────────────────
  async load(records, opts) {
    const t0     = Date.now();
    const apiKey = opts['api-key']   || process.env.PINECONE_API_KEY;
    const index  = opts['index']     || process.env.PINECONE_INDEX;
    const host   = opts['host']      || process.env.PINECONE_HOST;
    const ns     = opts['namespace'] || '';

    if (!apiKey) throw new Error('[pinecone] --api-key or PINECONE_API_KEY required');
    if (!index)  throw new Error('[pinecone] --index  or PINECONE_INDEX  required');
    if (!host)   throw new Error('[pinecone] --host   or PINECONE_HOST   required');

    const h = { 'Api-Key': apiKey, 'Content-Type': 'application/json' };

    console.log(`[pinecone] fetching index metadata for "${index}"...`);
    const metaRes = await fetch(`https://api.pinecone.io/indexes/${index}`, { headers: h });
    if (!metaRes.ok) throw new Error(`[pinecone] index metadata failed: ${await metaRes.text()}`);
    const { dimension: indexDim } = await metaRes.json();
    console.log(`[pinecone] index dimension: ${indexDim}`);

    const withVectors = records.filter(r => Array.isArray(r.vector) && r.vector.length === indexDim);
    const skipped     = records.length - withVectors.length;
    if (skipped)           console.warn(`[pinecone] ⚠  ${skipped} records skipped (dim mismatch or null vector)`);
    if (!withVectors.length) { console.error('[pinecone] ✗  nothing to upsert'); return; }

    let upserted = 0;
    await batchLoad(withVectors, async batch => {
      const vectors = batch.map(r => ({
        id:     String(r.id),
        values: r.vector,
        metadata: {
          text:       (r.text||'').slice(0,512),
          namespace:  r.namespace  || '',
          model:      r.model      || '',
          created_at: r.created_at || '',
          ...r.metadata,
        },
      }));
      const res = await fetch(`${host}/vectors/upsert`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ vectors, namespace: ns }),
      });
      if (!res.ok) throw new Error(`[pinecone] upsert failed: ${await res.text()}`);
      upserted += batch.length;
    }, { batchSize: 100, retries: 3, onProgress: (d,t) => progress(d,t,'pinecone') });

    summary({ connector:'pinecone', total:records.length, upserted, skipped, durationMs:Date.now()-t0 });
  },
};
