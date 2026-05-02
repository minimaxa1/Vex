import { createRequire } from 'module';
import { batchLoad } from '../utils/batch.js';
import { progress, summary } from '../utils/progress.js';
import { toRecord } from '../formats/vmig.js';

// pg is a peer dep — load dynamically so missing it gives a clear error
async function getPg() {
  try {
    const require = createRequire(import.meta.url);
    return require('pg');
  } catch {
    throw new Error('[pgvector] "pg" package not found. Run: npm install pg');
  }
}

export const pgvectorConnector = {
  name: 'pgvector',

  // ── EXPORT ───────────────────────────────────────────────────────────────
  async extract(opts) {
    const t0        = Date.now();
    const connStr   = opts['url']       || process.env.PGVECTOR_URL || process.env.DATABASE_URL;
    const table     = opts['table']     || process.env.PGVECTOR_TABLE || 'vex_vectors';
    const namespace = opts['namespace'] || null;
    const limit     = opts['limit']     ? parseInt(opts['limit']) : null;

    if (!connStr) throw new Error('[pgvector] --url or PGVECTOR_URL required (postgres://user:pass@host/db)');

    const { Pool } = await getPg();
    const pool = new Pool({ connectionString: connStr });

    try {
      // check table exists
      const check = await pool.query(
        `SELECT COUNT(*) FROM information_schema.tables WHERE table_name=$1`, [table]
      );
      if (check.rows[0].count === '0') throw new Error(`[pgvector] table "${table}" not found`);

      // get columns
      const cols = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [table]
      );
      const colNames = cols.rows.map(r => r.column_name);
      const hasText     = colNames.includes('text');
      const hasModel    = colNames.includes('model');
      const hasNs       = colNames.includes('namespace');
      const hasCreated  = colNames.includes('created_at');
      const hasMeta     = colNames.includes('metadata');

      // count
      let countQ = `SELECT COUNT(*) FROM "${table}"`;
      const countP = [];
      if (namespace && hasNs) { countQ += ` WHERE namespace=$1`; countP.push(namespace); }
      const total = parseInt((await pool.query(countQ, countP)).rows[0].count);
      console.log(`[pgvector] table "${table}" — ${total} rows`);

      const records = [];
      const pageSize = 500;
      let offset = 0;

      while (true) {
        let q = `SELECT id, vector::text`;
        if (hasText)    q += ', text';
        if (hasModel)   q += ', model';
        if (hasNs)      q += ', namespace';
        if (hasCreated) q += ', created_at';
        if (hasMeta)    q += ', metadata';
        q += ` FROM "${table}"`;
        const params = [];
        if (namespace && hasNs) { q += ` WHERE namespace=$${params.length+1}`; params.push(namespace); }
        q += ` ORDER BY id LIMIT ${pageSize} OFFSET ${offset}`;

        const res = await pool.query(q, params);
        if (!res.rows.length) break;

        for (const row of res.rows) {
          // pg returns vector as string like "[0.1,0.2,...]"
          let vector = null;
          if (row.vector) {
            try { vector = JSON.parse(row.vector.replace(/^\[/, '[').replace(/\]$/, ']')); } catch {}
            if (!Array.isArray(vector)) {
              vector = row.vector.replace(/[[\]]/g, '').split(',').map(Number);
            }
          }
          let meta = null;
          if (row.metadata) {
            try { meta = typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata); } catch {}
          }
          records.push(toRecord({
            id:         String(row.id),
            text:       row.text       || null,
            vector,
            model:      row.model      || null,
            namespace:  row.namespace  || null,
            created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
            metadata:   meta,
          }, 'pgvector'));

          if (limit && records.length >= limit) break;
        }

        progress(records.length, limit ?? total, 'pgvector export');
        if (limit && records.length >= limit) break;
        offset += pageSize;
        if (res.rows.length < pageSize) break;
      }

      process.stdout.write('\n');
      console.log(`[pgvector] extracted ${records.length} records in ${((Date.now()-t0)/1000).toFixed(1)}s`);
      return records;
    } finally {
      await pool.end();
    }
  },

  // ── IMPORT ───────────────────────────────────────────────────────────────
  async load(records, opts) {
    const t0        = Date.now();
    const connStr   = opts['url']   || process.env.PGVECTOR_URL || process.env.DATABASE_URL;
    const table     = opts['table'] || process.env.PGVECTOR_TABLE || 'vex_vectors';
    const autoCreate = opts['auto-create'] !== 'false';

    if (!connStr) throw new Error('[pgvector] --url or PGVECTOR_URL required');

    const { Pool } = await getPg();
    const pool = new Pool({ connectionString: connStr });

    try {
      // detect dims
      const firstVec = records.find(r => Array.isArray(r.vector) && r.vector.length > 0);
      const dims = firstVec?.vector?.length;
      if (!dims) throw new Error('[pgvector] no records with vectors found');

      // ensure pgvector extension
      await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

      if (autoCreate) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS "${table}" (
            id          TEXT PRIMARY KEY,
            vector      vector(${dims}),
            text        TEXT,
            model       TEXT,
            namespace   TEXT,
            created_at  TIMESTAMPTZ,
            metadata    JSONB
          )
        `);
        // create ivfflat index if table was just created or index missing
        await pool.query(`
          CREATE INDEX IF NOT EXISTS "${table}_vec_idx"
          ON "${table}" USING ivfflat (vector vector_cosine_ops)
          WITH (lists = 100)
        `).catch(() => {}); // non-fatal — requires rows to exist for ivfflat
        console.log(`[pgvector] ✓ table "${table}" ready (dims=${dims})`);
      }

      const withVectors = records.filter(r => Array.isArray(r.vector) && r.vector.length === dims);
      const skipped     = records.length - withVectors.length;
      if (skipped) console.warn(`[pgvector] ⚠  ${skipped} records skipped (null/dim-mismatch vector)`);

      let upserted = 0;
      await batchLoad(withVectors, async batch => {
        // build multi-row upsert
        const values = [];
        const params = [];
        let pIdx = 1;
        for (const r of batch) {
          values.push(`($${pIdx},$${pIdx+1},$${pIdx+2},$${pIdx+3},$${pIdx+4},$${pIdx+5},$${pIdx+6})`);
          params.push(
            r.id,
            `[${r.vector.join(',')}]`,
            r.text       || null,
            r.model      || null,
            r.namespace  || null,
            r.created_at || null,
            r.metadata   ? JSON.stringify(r.metadata) : null
          );
          pIdx += 7;
        }
        await pool.query(`
          INSERT INTO "${table}" (id, vector, text, model, namespace, created_at, metadata)
          VALUES ${values.join(',')}
          ON CONFLICT (id) DO UPDATE SET
            vector=EXCLUDED.vector, text=EXCLUDED.text, model=EXCLUDED.model,
            namespace=EXCLUDED.namespace, created_at=EXCLUDED.created_at, metadata=EXCLUDED.metadata
        `, params);
        upserted += batch.length;
      }, { batchSize: 200, retries: 3, onProgress: (d,t) => progress(d,t,'pgvector') });

      summary({ connector:'pgvector', total:records.length, upserted, skipped, durationMs:Date.now()-t0 });
    } finally {
      await pool.end();
    }
  },
 async extractStream(opts, onPage) {
    const connStr   = opts['url']   || process.env.PGVECTOR_URL || process.env.DATABASE_URL;
    const table     = opts['table'] || process.env.PGVECTOR_TABLE || 'vex_vectors';
    const namespace = opts['namespace'] || null;
    const limit     = opts['limit'] ? parseInt(opts['limit']) : null;

    if (!connStr) throw new Error('[pgvector] --url required');

    const { Pool } = await getPg();
    const pool = new Pool({ connectionString: connStr });

    try {
      const cols    = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [table]);
      const colNames = cols.rows.map(r => r.column_name);
      const has = f => colNames.includes(f);

      let countQ  = `SELECT COUNT(*) FROM "${table}"`;
      const countP = [];
      if (namespace && has('namespace')) { countQ += ` WHERE namespace=$1`; countP.push(namespace); }
      const total = parseInt((await pool.query(countQ, countP)).rows[0].count);
      console.log(`[pgvector] stream export — "${table}" (${total} rows)`);

      const pageSize = 500;
      let offset = 0;
      let sent   = 0;

      while (true) {
        let q = `SELECT id, vector::text`;
        if (has('text'))       q += ', text';
        if (has('model'))      q += ', model';
        if (has('namespace'))  q += ', namespace';
        if (has('created_at')) q += ', created_at';
        if (has('metadata'))   q += ', metadata';
        q += ` FROM "${table}"`;

        const params = [];
        if (namespace && has('namespace')) { q += ` WHERE namespace=$${params.length+1}`; params.push(namespace); }
        q += ` ORDER BY id LIMIT ${Math.min(pageSize, limit ? limit - sent : pageSize)} OFFSET ${offset}`;

        const res = await pool.query(q, params);
        if (!res.rows.length) break;

        const page = [];
        for (const row of res.rows) {
          let vector = null;
          if (row.vector) {
            try { vector = JSON.parse(row.vector); } catch {}
            if (!Array.isArray(vector)) vector = row.vector.replace(/[\[\]]/g, '').split(',').map(Number);
          }
          let meta = null;
          if (row.metadata) try { meta = typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata); } catch {}

          page.push(toRecord({
            id:         String(row.id),
            text:       row.text || null,
            vector,
            model:      row.model || null,
            namespace:  row.namespace || null,
            created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
            metadata:   meta,
          }, 'pgvector'));
          sent++;
          if (limit && sent >= limit) break;
        }

        await onPage(page);
        progress(sent, limit ?? total, 'pgvector stream');
        if (limit && sent >= limit) break;
        offset += pageSize;
        if (res.rows.length < pageSize) break;
      }
      process.stdout.write('\n');
    } finally {
      await pool.end();
    }
  },
};
