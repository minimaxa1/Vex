/**
 * core/migrate.js — reusable migration engine
 * Streaming-aware import/export + vec2vec adapter + re-embedding pipeline
 */

import { getConnector }              from '../connectors/index.js';
import { writeJsonl, writeMeta, readJsonl } from '../formats/vmig.js';
import { reEmbed }                   from '../utils/embed.js';
import { adaptRecords }              from '../utils/adapt.js';
import fs                            from 'fs';
import readline                      from 'readline';

const STREAM_THRESHOLD = 100_000; // records above this use streaming paths

// ── DIM CHECK + ADAPTER + REEMBED ────────────────────────────────────────────

/**
 * Resolve dimension mismatches between records and target.
 * Priority: --adapter (vec2vec, no API) > --reembed (OpenAI/Ollama API) > skip
 *
 * @param {Array}  records
 * @param {number|null} targetDims
 * @param {object} opts   — CLI flags: adapter, 'adapter-model', reembed, 'embed-model', etc.
 */
export async function dimCheck(records, targetDims, opts) {
  if (!targetDims) return records;

  const mismatched = records.filter(r => r.vector && r.vector.length !== targetDims);
  if (!mismatched.length) return records;

  console.warn(`[core] ⚠ ${mismatched.length} records have dim mismatch (expected ${targetDims})`);

  // ── Option 1: vec2vec projection via vex-adapter ──────────────────────────
  if (opts.adapter) {
    const targetModel = opts['adapter-model'] || opts['embed-model'];
    if (!targetModel) throw new Error('[core] --adapter requires --adapter-model <model-name>');
    console.log(`[core] --adapter: projecting via vex-adapter → ${targetModel}`);
    await adaptRecords(mismatched, targetModel, opts);
    // re-filter after projection
    const stillBad = records.filter(r => r.vector && r.vector.length !== targetDims);
    if (stillBad.length) {
      console.warn(`[core] ⚠ ${stillBad.length} records still mismatched after projection — will be skipped`);
    }
    return records;
  }

  // ── Option 2: re-embed from text via OpenAI/Ollama ───────────────────────
  if (opts.reembed) {
    const reembeddable = mismatched.filter(r => r.text);
    const noText       = mismatched.length - reembeddable.length;

    if (noText) console.error(`[core] ✗ ${noText} mismatched records have no text — cannot re-embed, will be skipped`);

    if (reembeddable.length) {
      console.log(`[core] --reembed: re-embedding ${reembeddable.length} records`);
      await reEmbed(reembeddable, opts);

      // patch back into records array
      const idx = new Map(reembeddable.map(r => [r.id, r]));
      for (let i = 0; i < records.length; i++) {
        const updated = idx.get(records[i].id);
        if (updated) records[i] = updated;
      }
    }
    return records;
  }

  // ── No resolution strategy — warn and let connector filter ────────────────
  const noText = mismatched.filter(r => !r.text).length;
  if (noText) {
    console.error(`[core] ✗ ${noText} records cannot be resolved (no text, no --adapter). They will be skipped.`);
  } else {
    console.warn(`[core] tip: use --reembed to re-embed from text, or --adapter for vec2vec projection`);
  }

  return records;
}

// ── STREAMING EXPORT ──────────────────────────────────────────────────────────

/**
 * Export from a connector to a .vmig.jsonl file in streaming fashion.
 * If connector exposes extractStream(opts, onPage), uses it.
 * Falls back to full extract() and writes progressively (memory-bound fallback).
 *
 * @param {object} connector
 * @param {object} opts
 * @param {string} outPath   — destination file path
 * @returns {number} total records written
 */
export async function streamExport(connector, opts, outPath) {
  const tmpPath  = outPath + '.tmp';
  const outStream = fs.createWriteStream(tmpPath, { encoding: 'utf8' });
  let total = 0;

  const writePage = async (page) => {
    for (const r of page) {
      outStream.write(JSON.stringify(r) + '\n');
      total++;
    }
  };

  if (typeof connector.extractStream === 'function') {
    // true streaming — connector pages without accumulating
    await connector.extractStream(opts, writePage);
  } else {
    // fallback — loads all into memory, writes progressively
    console.warn(`[core] connector "${connector.name}" has no extractStream — loading full dataset`);
    const records = await connector.extract(opts);
    await writePage(records);
  }

  await new Promise((res, rej) => {
    outStream.end();
    outStream.on('finish', res);
    outStream.on('error',  rej);
  });

  fs.renameSync(tmpPath, outPath);
  console.log(`[core] streamed ${total} records → ${outPath}`);
  return total;
}

// ── STREAMING IMPORT ──────────────────────────────────────────────────────────

/**
 * Read a .vmig.jsonl file line-by-line and load into connector in batches.
 * Never holds more than batchSize records in memory.
 *
 * @param {string} filePath
 * @param {object} connector
 * @param {object} opts       — includes adapter/reembed flags
 * @param {number} batchSize  — default 500
 * @returns {{ total, upserted }}
 */
export async function streamImport(filePath, connector, opts, batchSize = 500) {
  if (!fs.existsSync(filePath)) throw new Error(`[core] file not found: ${filePath}`);

  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });

  let batch    = [];
  let total    = 0;
  let upserted = 0;
  let skipped  = 0;

  // detect target dims lazily from first connector response (best-effort)
  let targetDims = null;

  const flushBatch = async () => {
    if (!batch.length) return;

    // resolve dim mismatches per batch
    const resolved = await dimCheck(batch, targetDims, opts);
    await connector.load(resolved, opts);

    upserted += resolved.filter(r => r.vector).length;
    skipped  += resolved.filter(r => !r.vector).length;
    process.stdout.write(`\r[core] imported ${upserted} | skipped ${skipped}`);
    batch = [];
  };

  for await (const line of rl) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    try {
      batch.push(JSON.parse(t));
    } catch {
      console.warn(`\n[core] skipping malformed JSON at record ${total}`);
      continue;
    }
    total++;
    if (batch.length >= batchSize) await flushBatch();
  }

  await flushBatch(); // flush remainder

  process.stdout.write('\n');
  console.log(`[core] ✓ stream import complete — ${upserted} upserted / ${skipped} skipped / ${total} total`);
  return { total, upserted, skipped };
}

// ── FULL MIGRATE PIPELINE ─────────────────────────────────────────────────────

/**
 * Migrate from one connector to another.
 * Auto-switches to streaming for jsonl sources > STREAM_THRESHOLD lines.
 *
 * @param {object} fromConnector
 * @param {object} toConnector
 * @param {object} opts
 */
export async function migrate(fromConnector, toConnector, opts) {
  if (fromConnector.name === 'jsonl') {
    const filePath  = opts.from || opts.file || opts.input;
    const lineCount = await countLines(filePath);
    console.log(`[core] ${lineCount.toLocaleString()} records in file`);

    if (lineCount > STREAM_THRESHOLD) {
      console.log(`[core] streaming mode activated (>${STREAM_THRESHOLD.toLocaleString()} records)`);
      return streamImport(filePath, toConnector, opts);
    }
  }

  // standard path — load all, dim-check, load target
  const records   = await fromConnector.extract(opts);
  const targetDims = await resolveTargetDims(toConnector, opts);
  const resolved  = await dimCheck(records, targetDims, opts);
  await toConnector.load(resolved, opts);
  return { total: records.length, upserted: resolved.filter(r => r.vector).length };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

async function countLines(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  let count = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
  for await (const _ of rl) count++;
  return count;
}

/**
 * Best-effort: ask the connector for its target vector dimension.
 * Each connector exposes getDims(opts) if it can pre-check (e.g. Pinecone index metadata).
 */
async function resolveTargetDims(connector, opts) {
  if (typeof connector.getDims === 'function') {
    try { return await connector.getDims(opts); } catch { /* non-fatal */ }
  }
  return null;
}
