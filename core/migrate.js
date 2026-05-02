/**
 * core/migrate.js — reusable migration engine
 * Extracted from vex.mjs for programmatic use and future streaming support
 */
import { getConnector } from '../connectors/index.js';
import { writeJsonl, writeMeta, readJsonl } from '../formats/vmig.js';
import { reEmbed } from '../utils/embed.js';
import fs from 'fs';
import readline from 'readline';

/**
 * Check for dimension mismatch between records and target connector,
 * optionally re-embed if text is present.
 */
export async function dimCheck(records, targetDims, opts) {
  if (!targetDims) return records;

  const mismatched = records.filter(r => r.vector && r.vector.length !== targetDims);
  if (!mismatched.length) return records;

  const reembeddable = mismatched.filter(r => r.text);
  console.warn(`[core] ⚠  ${mismatched.length} records have dim mismatch (expected ${targetDims})`);

  if (opts.reembed && reembeddable.length) {
    console.log(`[core] --reembed: re-embedding ${reembeddable.length} records with text`);
    await reEmbed(reembeddable, opts);
    // patch back
    for (const r of reembeddable) {
      const orig = records.find(x => x.id === r.id);
      if (orig) { orig.vector = r.vector; orig.dims = r.dims; orig.model = r.model; }
    }
  } else if (mismatched.length) {
    const noText = mismatched.filter(r => !r.text).length;
    if (noText) console.error(`[core] ✗  ${noText} records cannot be re-embedded (no text). Use --reembed.`);
  }
  return records;
}

/**
 * Stream-aware export: for large datasets, streams jsonl line by line
 * without loading all records into memory at once.
 */
export async function streamExport(connector, opts, outPath) {
  const STREAM_THRESHOLD = 100_000;

  // connectors that support streaming via their own cursor (all do page-by-page already)
  // For now, stream means: write records to file as they come in pages
  const tmpPath = outPath + '.streaming';
  const outStream = fs.createWriteStream(tmpPath, { encoding: 'utf8' });

  let total = 0;
  let pageCallback = null;

  // hook: if connector exposes extractStream, use it; else fall back to extract
  if (typeof connector.extractStream === 'function') {
    await connector.extractStream(opts, async (page) => {
      for (const r of page) {
        outStream.write(JSON.stringify(r) + '\n');
        total++;
      }
    });
  } else {
    // standard extract — still loads all in memory, but writes progressively
    const records = await connector.extract(opts);
    for (const r of records) {
      outStream.write(JSON.stringify(r) + '\n');
      total++;
    }
  }

  await new Promise((res, rej) => outStream.on('finish', res).on('error', rej));
  outStream.end();
  fs.renameSync(tmpPath, outPath);
  console.log(`[core] streamed ${total} records → ${outPath}`);
  return total;
}

/**
 * Stream-aware import: reads a jsonl file line by line and loads in batches
 * without pulling all records into memory.
 */
export async function streamImport(filePath, connector, opts, batchSize = 500) {
  if (!fs.existsSync(filePath)) throw new Error(`[core] file not found: ${filePath}`);

  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
  let batch = [];
  let total = 0;
  let upserted = 0;

  for await (const line of rl) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    try {
      batch.push(JSON.parse(t));
    } catch {
      console.warn(`[core] skipping bad line at record ${total}`);
      continue;
    }
    total++;

    if (batch.length >= batchSize) {
      if (opts.reembed) await reEmbed(batch, opts);
      await connector.load(batch, opts);
      upserted += batch.length;
      process.stdout.write(`\r[core] imported ${upserted} records`);
      batch = [];
    }
  }

  // flush remainder
  if (batch.length) {
    if (opts.reembed) await reEmbed(batch, opts);
    await connector.load(batch, opts);
    upserted += batch.length;
  }

  process.stdout.write('\n');
  console.log(`[core] ✓ stream import complete — ${upserted}/${total} records`);
  return { total, upserted };
}

/**
 * Full migrate pipeline: extract → optional reembed → load
 * Streaming-aware: uses streamImport for files > STREAM_THRESHOLD lines
 */
export async function migrate(fromConnector, toConnector, opts) {
  const STREAM_THRESHOLD = 100_000;

  // if migrating from file, check size first
  if (fromConnector.name === 'jsonl') {
    const filePath = opts.from || opts.file || opts.input;
    const lineCount = await countLines(filePath);
    console.log(`[core] ${lineCount} records in file`);

    if (lineCount > STREAM_THRESHOLD) {
      console.log(`[core] streaming mode (>${STREAM_THRESHOLD} records)`);
      return streamImport(filePath, toConnector, opts);
    }
  }

  const records = await fromConnector.extract(opts);
  if (opts.reembed) await reEmbed(records, opts);
  await toConnector.load(records, opts);
  return { total: records.length, upserted: records.length };
}

async function countLines(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  let count = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
  for await (const _ of rl) count++;
  return count;
}
