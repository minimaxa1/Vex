import { readJsonl, writeJsonl } from '../formats/vmig.js';

export const jsonlConnector = {
  name: 'jsonl',

  async extract(opts) {
    const file = opts['file'] || opts['from'] || opts['input'];
    if (!file) throw new Error('[jsonl] --file or --from required');
    return await readJsonl(file);
  },

  async load(records, opts) {
    const file = opts['output'] || opts['to'];
    if (!file) throw new Error('[jsonl] --output required');
    writeJsonl(records, file);
    console.log(`[jsonl] wrote ${records.length} records → ${file}`);
  },
};
