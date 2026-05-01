import fs from 'fs';
import readline from 'readline';

export const VEX_VERSION = '1.0.0';

export function validate(record) {
  const errs = [];
  if (!record.id) errs.push('missing id');
  if (!record.vex_version) errs.push('missing vex_version');
  if (record.text == null && record.vector == null) errs.push('text and vector cannot both be null');
  if (record.dims != null && record.vector != null && record.dims !== record.vector.length)
    errs.push(`dims ${record.dims} != vector.length ${record.vector.length}`);
  if (record.metadata) {
    for (const [k,v] of Object.entries(record.metadata)) {
      if (typeof v === 'object' && v !== null) errs.push(`metadata.${k} must be scalar (no nesting)`);
    }
  }
  return errs;
}

export function toRecord(raw, sourceStore = null) {
  return {
    id: raw.id ?? crypto.randomUUID(),
    text: raw.text ?? null,
    vector: raw.vector ?? null,
    model: raw.model ?? null,
    dims: raw.vector ? raw.vector.length : (raw.dims ?? null),
    namespace: raw.namespace ?? null,
    metadata: raw.metadata ?? null,
    created_at: raw.created_at ?? new Date().toISOString(),
    source_store: sourceStore ?? raw.source_store ?? null,
    modality: raw.modality ?? 'text',
    score: raw.score ?? null,
    vex_version: VEX_VERSION
  };
}

export function writeJsonl(records, filePath) {
  const lines = records.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(filePath, lines + '\n', 'utf8');
  writeMeta(records, filePath);
}

export function writeMeta(records, filePath) {
  const meta = {
    exported_at: new Date().toISOString(),
    source_store: records[0]?.source_store ?? null,
    record_count: records.length,
    vex_version: VEX_VERSION
  };
  fs.writeFileSync(filePath.replace('.vmig.jsonl', '.vmig.meta.json'), JSON.stringify(meta, null, 2));
}

export async function readJsonl(filePath) {
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
  for await (const line of rl) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    try { records.push(JSON.parse(t)); } catch(e) { console.warn(`[vmig] skipping bad line: ${t.slice(0,60)}`); }
  }
  return records;
}