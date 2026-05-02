import Database from 'better-sqlite3';
import { toRecord } from '../formats/vmig.js';
import { progress, summary } from '../utils/progress.js';

export const vektorConnector = {
  name: 'vektor',

  // ── EXPORT ───────────────────────────────────────────────────────────────
  async extract(opts) {
    const dbPath    = opts['db']        || opts['path'] || 'slipstream-memory.db';
    const namespace = opts['namespace'] || null;
    const limit     = opts['limit']     ? parseInt(opts['limit']) : null;

    const db = new Database(dbPath, { readonly: true });

    let sql = `
      SELECT id, content AS text, embedding AS vector, metadata, created_at, namespace
      FROM memories
    `;
    const params = [];
    if (namespace) { sql += ` WHERE namespace = ?`; params.push(namespace); }
    sql += ` ORDER BY created_at DESC`;
    if (limit) { sql += ` LIMIT ?`; params.push(limit); }

    const rows = db.prepare(sql).all(...params);
    db.close();

    return rows.map(row => {
      let vector = null;
      try {
        if (row.vector) {
          const buf    = Buffer.isBuffer(row.vector) ? row.vector : Buffer.from(row.vector);
          const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
          vector = Array.from(floats);
        }
      } catch { vector = null; }

      let metadata = null;
      try { metadata = row.metadata ? JSON.parse(row.metadata) : null; } catch {}

      return toRecord({ ...row, vector, metadata }, 'vektor');
    });
  },

  // ── IMPORT ───────────────────────────────────────────────────────────────
  async load(records, opts) {
    const t0     = Date.now();
    const dbPath = opts['db'] || opts['path'] || 'slipstream-memory.db';

    if (!require || true) {
      // dynamic import for ESM compat
    }

    const db = new Database(dbPath);

    // ensure table exists (same schema as VEKTOR Slipstream)
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id         TEXT PRIMARY KEY,
        content    TEXT,
        embedding  BLOB,
        metadata   TEXT,
        created_at TEXT,
        namespace  TEXT
      )
    `);

    const insert = db.prepare(`
      INSERT OR REPLACE INTO memories (id, content, embedding, metadata, created_at, namespace)
      VALUES (@id, @content, @embedding, @metadata, @created_at, @namespace)
    `);

    let upserted = 0;
    let skipped  = 0;

    const insertMany = db.transaction(batch => {
      for (const r of batch) {
        try {
          let embBlob = null;
          if (Array.isArray(r.vector) && r.vector.length > 0) {
            const f32  = new Float32Array(r.vector);
            embBlob    = Buffer.from(f32.buffer);
          }

          insert.run({
            id:         String(r.id),
            content:    r.text        || null,
            embedding:  embBlob,
            metadata:   r.metadata    ? JSON.stringify(r.metadata) : null,
            created_at: r.created_at  || new Date().toISOString(),
            namespace:  r.namespace   || null,
          });
          upserted++;
        } catch (e) {
          skipped++;
          console.warn(`[vektor] skipping id=${r.id}: ${e.message}`);
        }
      }
    });

    const BATCH = 500;
    for (let i = 0; i < records.length; i += BATCH) {
      insertMany(records.slice(i, i + BATCH));
      progress(Math.min(i + BATCH, records.length), records.length, 'vektor import');
    }

    db.close();
    summary({ connector: 'vektor', total: records.length, upserted, skipped, durationMs: Date.now() - t0 });
    console.log(`[vektor] written to ${dbPath}`);
  },
};
