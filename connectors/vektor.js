import Database from 'better-sqlite3';
import { toRecord } from '../formats/vmig.js';

export const vektorConnector = {
  name: 'vektor',

  async extract(opts) {
    const dbPath = opts['db'] || opts['path'] || 'slipstream-memory.db';
    const db = new Database(dbPath, { readonly: true });

    const rows = db.prepare(`
      SELECT id, content AS text, embedding AS vector, metadata, created_at, namespace
      FROM memories
      ORDER BY created_at DESC
    `).all();
    db.close();

    return rows.map(row => {
      let vector = null;
      try {
        if (row.vector) {
          const buf = Buffer.isBuffer(row.vector) ? row.vector : Buffer.from(row.vector);
          const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
          vector = Array.from(floats);
        }
      } catch { vector = null; }

      let metadata = null;
      try { metadata = row.metadata ? JSON.parse(row.metadata) : null; } catch { metadata = null; }

      return toRecord({ ...row, vector, metadata }, 'vektor');
    });
  },

  async load(records, opts) {
    throw new Error('[vektor] import into VEKTOR not yet supported (Phase 2)');
  },
};
