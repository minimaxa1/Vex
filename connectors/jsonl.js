import { readJsonl, writeJsonl, toRecord } from '../formats/vmig.js';

export const jsonlConnector = {
  name: 'jsonl',

  async extract(opts) {
    const records = await readJsonl(opts.file);
    console.log(`[jsonl] read ${records.length} records from ${opts.file}`);
    return records;
  },

  async load(records, opts) {
    const out = opts.output ?? `export-${Date.now()}.vmig.jsonl`;
    writeJsonl(records, out);
    console.log(`[jsonl] wrote ${records.length} records → ${out}`);
    return out;
  }
};