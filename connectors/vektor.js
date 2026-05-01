import { toRecord } from '../formats/vmig.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export const vektorConnector = {
    name: 'vektor',

    async extract(opts) {
        const dbPath = opts.db || process.env.VEKTOR_DB;
        if (!dbPath) throw new Error('vektor connector requires --db path or VEKTOR_DB env var');

        const Database = require('better-sqlite3');
        const db = new Database(dbPath, { readonly: true });

        const rows = db.prepare(`
      SELECT id, content as text, embedding as vector, namespace,
             tags, importance, created_at
      FROM memories
      WHERE 1=1
      ${opts.namespace ? 'AND namespace = @ns' : ''}
      ORDER BY created_at DESC
      ${opts.limit ? 'LIMIT ' + parseInt(opts.limit) : ''}
    `).all(opts.namespace ? { ns: opts.namespace } : {});

        db.close();

        const records = rows.map(row => {
            let vector = null;
            if (row.vector) {
                try {
                    if (typeof row.vector === 'string') {
                        // stored as JSON text array
                        vector = JSON.parse(row.vector);
                    } else {
                        // stored as binary blob (float32 LE)
                        const buf = Buffer.isBuffer(row.vector) ? row.vector : Buffer.from(row.vector);
                        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                        vector = Array.from(new Float32Array(ab));
                    }
                    if (!Array.isArray(vector) || vector.length === 0) vector = null;
                } catch { vector = null; }
            }
            return toRecord({
                id: String(row.id),
                text: row.text,
                vector,
                model: vector ? 'bge-small-en-v1.5' : null,
                dims: vector ? vector.length : null,
                namespace: row.namespace,
                metadata: {
                    tags: row.tags || '',
                    importance: row.importance || 1.0,
                    agent_id: 'default'
                },
                created_at: row.created_at ? new Date(row.created_at).toISOString() : null
            }, 'vektor');
        });

        console.log(`[vektor] extracted ${records.length} records`);
        return records;
    },

    async load(records, opts) {
        throw new Error('[vektor] import not yet implemented â€” use vex import --to vektor in v0.1');
    }
};


