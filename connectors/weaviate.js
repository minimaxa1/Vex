import { batchLoad } from '../utils/batch.js';
import { progress, summary } from '../utils/progress.js';
import { toRecord } from '../formats/vmig.js';

export const weaviateConnector = {
  name: 'weaviate',

  // ── EXPORT ───────────────────────────────────────────────────────────────
  async extract(opts) {
    const t0         = Date.now();
    const url        = (opts['url'] || process.env.WEAVIATE_URL || 'http://localhost:8080').replace(/\/$/, '');
    const className  = opts['collection'] || opts['class'] || process.env.WEAVIATE_CLASS;
    const apiKey     = opts['api-key']    || process.env.WEAVIATE_API_KEY || '';
    const namespace  = opts['namespace']  || null;
    const limit      = opts['limit']      ? parseInt(opts['limit']) : null;

    if (!className) throw new Error('[weaviate] --collection (class name) or WEAVIATE_CLASS required');

    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    // verify class exists
    const clsRes = await fetch(`${url}/v1/schema/${className}`, { headers });
    if (!clsRes.ok) throw new Error(`[weaviate] class "${className}" not found: ${await clsRes.text()}`);
    const schema = await clsRes.json();
    console.log(`[weaviate] class "${className}" — ${schema.properties?.length ?? 0} properties`);

    const records = [];
    let cursor    = null;

    while (true) {
      const pageSize = Math.min(100, limit ? limit - records.length : 100);
      let gql = `{Get{${className}(limit:${pageSize}`;
      if (cursor) gql += `,after:"${cursor}"`;
      gql += `){_additional{id vector}text model namespace created_at metadata}}}`;

      const res = await fetch(`${url}/v1/graphql`, {
        method: 'POST', headers, body: JSON.stringify({ query: gql }),
      });
      if (!res.ok) throw new Error(`[weaviate] graphql failed: ${await res.text()}`);
      const data = await res.json();
      if (data.errors) throw new Error(`[weaviate] graphql error: ${JSON.stringify(data.errors)}`);

      const objects = data.data?.Get?.[className] ?? [];
      if (!objects.length) break;

      for (const obj of objects) {
        const { _additional, text, model, namespace: ns, created_at, ...rest } = obj;
        if (namespace && ns !== namespace) continue;
        let meta = {};
        try { meta = typeof rest.metadata === 'string' ? JSON.parse(rest.metadata) : (rest.metadata ?? {}); } catch {}
        // flatten any remaining scalar props
        for (const [k, v] of Object.entries(rest)) {
          if (k !== 'metadata' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
            meta[k] = v;
        }
        records.push(toRecord({
          id:         _additional.id,
          text:       text       || null,
          vector:     _additional.vector || null,
          model:      model      || null,
          namespace:  ns         || null,
          created_at: created_at || null,
          metadata:   Object.keys(meta).length ? meta : null,
        }, 'weaviate'));
        if (limit && records.length >= limit) break;
      }

      progress(records.length, limit ?? records.length + (objects.length === pageSize ? 1 : 0), 'weaviate export');
      if (limit && records.length >= limit) break;
      cursor = objects[objects.length - 1]?._additional?.id;
      if (objects.length < pageSize) break;
    }

    process.stdout.write('\n');
    console.log(`[weaviate] extracted ${records.length} records in ${((Date.now()-t0)/1000).toFixed(1)}s`);
    return records;
  },

  // ── IMPORT ───────────────────────────────────────────────────────────────
  async load(records, opts) {
    const t0         = Date.now();
    const url        = (opts['url'] || process.env.WEAVIATE_URL || 'http://localhost:8080').replace(/\/$/, '');
    const className  = opts['collection'] || opts['class'] || process.env.WEAVIATE_CLASS;
    const apiKey     = opts['api-key']    || process.env.WEAVIATE_API_KEY || '';
    const autoCreate = opts['auto-create'] !== 'false';

    if (!className) throw new Error('[weaviate] --collection (class name) or WEAVIATE_CLASS required');

    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    // check / create class
    const clsRes = await fetch(`${url}/v1/schema/${className}`, { headers });
    if (clsRes.status === 404) {
      if (!autoCreate) throw new Error(`[weaviate] class "${className}" not found`);
      const firstVec = records.find(r => Array.isArray(r.vector));
      const dims     = firstVec?.vector?.length ?? 1536;
      console.log(`[weaviate] auto-creating class "${className}" (dims=${dims})...`);
      const createRes = await fetch(`${url}/v1/schema`, {
        method: 'POST', headers,
        body: JSON.stringify({
          class: className,
          vectorizer: 'none',
          vectorIndexConfig: { distance: 'cosine' },
          properties: [
            { name: 'text',       dataType: ['text']   },
            { name: 'model',      dataType: ['text']   },
            { name: 'namespace',  dataType: ['text']   },
            { name: 'created_at', dataType: ['text']   },
            { name: 'metadata',   dataType: ['text']   },
          ],
        }),
      });
      if (!createRes.ok) throw new Error(`[weaviate] schema create failed: ${await createRes.text()}`);
      console.log('[weaviate] ✓ class created');
    } else if (!clsRes.ok) {
      throw new Error(`[weaviate] schema check failed: ${await clsRes.text()}`);
    } else {
      console.log(`[weaviate] ✓ class "${className}" exists`);
    }

    const withVectors = records.filter(r => Array.isArray(r.vector) && r.vector.length > 0);
    const skipped     = records.length - withVectors.length;
    if (skipped) console.warn(`[weaviate] ⚠  ${skipped} records skipped (null vector)`);

    let upserted = 0;
    await batchLoad(withVectors, async batch => {
      const objects = batch.map(r => ({
        class:  className,
        id:     r.id.length === 36 && r.id.includes('-') ? r.id : undefined, // keep UUIDs
        vector: r.vector,
        properties: {
          text:       r.text       || '',
          model:      r.model      || '',
          namespace:  r.namespace  || '',
          created_at: r.created_at || '',
          metadata:   r.metadata   ? JSON.stringify(r.metadata) : '',
        },
      }));
      const res = await fetch(`${url}/v1/batch/objects`, {
        method: 'POST', headers, body: JSON.stringify({ objects }),
      });
      if (!res.ok) throw new Error(`[weaviate] batch import failed: ${await res.text()}`);
      const result = await res.json();
      // weaviate returns per-object status
      const failed = result.filter?.(o => o.result?.errors);
      if (failed.length) console.warn(`[weaviate] ⚠  ${failed.length} objects had errors in batch`);
      upserted += batch.length - (failed.length || 0);
    }, { batchSize: 100, retries: 3, onProgress: (d,t) => progress(d,t,'weaviate') });

    summary({ connector:'weaviate', total:records.length, upserted, skipped, durationMs:Date.now()-t0 });
  },
};
