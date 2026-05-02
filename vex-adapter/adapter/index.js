/**
 * adapter/index.js — core vec2vec projection engine
 *
 * Linear projection: v_target = W * v_source + b
 * W shape: [d_target, d_source], b shape: [d_target]
 * No re-embedding API call needed — pure matrix math.
 */
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pairKey, getModelInfo } from './models.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJ_DIR = join(__dirname, 'projections');

/**
 * Load a projection weight file.
 * Checks user-supplied path first, then bundled projections dir.
 */
export function loadProjection(fromModel, toModel, customPath = null) {
  const key = pairKey(fromModel, toModel);

  if (customPath) {
    if (!existsSync(customPath)) throw new Error(`[adapter] projection not found: ${customPath}`);
    return JSON.parse(readFileSync(customPath, 'utf8'));
  }

  const bundled = join(PROJ_DIR, `${key}.json`);
  if (existsSync(bundled)) return JSON.parse(readFileSync(bundled, 'utf8'));

  throw new Error(
    `[adapter] no projection found for ${key}\n` +
    `  Train one with: vex-adapt train --from ${fromModel} --to ${toModel} --pairs aligned.jsonl\n` +
    `  Or check bundled pairs: vex-adapt list`
  );
}

/**
 * Apply linear projection to a single vector.
 * W: Float32Array or number[][] [d_target × d_source]
 * b: Float32Array or number[] [d_target] (optional bias)
 */
export function projectVector(v, W, b = null) {
  const dTarget = W.length;
  const dSource = v.length;

  if (W[0].length !== dSource) {
    throw new Error(`[adapter] dim mismatch: projection expects d_source=${W[0].length}, got ${dSource}`);
  }

  const out = new Float32Array(dTarget);
  for (let i = 0; i < dTarget; i++) {
    let sum = b ? b[i] : 0;
    const row = W[i];
    for (let j = 0; j < dSource; j++) {
      sum += row[j] * v[j];
    }
    out[i] = sum;
  }
  return Array.from(out);
}

/**
 * Normalize a vector to unit length (cosine similarity preservation).
 */
export function l2Normalize(v) {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) return v;
  return v.map(x => x / norm);
}

/**
 * High-level: adapt a single vector from one model space to another.
 * Loads projection lazily (cached per pair).
 */
const _projectionCache = new Map();

export function adapt(vector, fromModel, toModel, opts = {}) {
  const key = pairKey(fromModel, toModel);

  if (!_projectionCache.has(key)) {
    const proj = loadProjection(fromModel, toModel, opts.projectionPath);
    _projectionCache.set(key, proj);
  }

  const { W, b, normalize = true } = _projectionCache.get(key);
  let result = projectVector(vector, W, b);
  if (normalize) result = l2Normalize(result);
  return result;
}

/**
 * Batch adapt: apply adapt() to an array of vmig records in-place.
 * Updates record.vector, record.dims, record.model.
 */
export async function adaptRecords(records, fromModel, toModel, opts = {}) {
  const key = pairKey(fromModel, toModel);
  const toInfo = getModelInfo(toModel);

  // load once
  if (!_projectionCache.has(key)) {
    const proj = loadProjection(fromModel, toModel, opts.projectionPath);
    _projectionCache.set(key, proj);
  }
  const { W, b, normalize = true } = _projectionCache.get(key);

  let adapted = 0;
  let skipped = 0;

  for (const rec of records) {
    if (!rec.vector || !Array.isArray(rec.vector)) { skipped++; continue; }

    const srcModel = rec.model || fromModel;
    if (srcModel !== fromModel && !opts.force) {
      // skip records from a different source model unless --force
      skipped++;
      continue;
    }

    let v = projectVector(rec.vector, W, b);
    if (normalize) v = l2Normalize(v);

    rec.vector = v;
    rec.dims   = v.length;
    rec.model  = toModel;
    if (toInfo) rec.dims = toInfo.dims;
    adapted++;

    if (adapted % 1000 === 0) process.stdout.write(`\r[adapter] ${adapted} adapted`);
  }

  if (adapted > 0) process.stdout.write('\n');
  console.log(`[adapter] ✓ ${adapted} records adapted (${skipped} skipped) — ${fromModel} → ${toModel}`);
  return { adapted, skipped };
}

/**
 * Stream-aware adapt: reads vmig.jsonl line-by-line, adapts, writes output.
 * Never loads full dataset into memory.
 */
export async function adaptStream(inPath, outPath, fromModel, toModel, opts = {}) {
  const { createReadStream, createWriteStream } = await import('fs');
  const { createInterface } = await import('readline');

  // load projection first
  const key = pairKey(fromModel, toModel);
  if (!_projectionCache.has(key)) {
    const proj = loadProjection(fromModel, toModel, opts.projectionPath);
    _projectionCache.set(key, proj);
  }
  const { W, b, normalize = true } = _projectionCache.get(key);

  const rl  = createInterface({ input: createReadStream(inPath) });
  const out = createWriteStream(outPath + '.tmp');

  let adapted = 0, skipped = 0, total = 0;

  for await (const line of rl) {
    const t = line.trim();
    if (!t || t.startsWith('#')) { out.write(line + '\n'); continue; }
    total++;

    let rec;
    try { rec = JSON.parse(t); } catch { out.write(line + '\n'); skipped++; continue; }

    if (rec.vector && Array.isArray(rec.vector)) {
      let v = projectVector(rec.vector, W, b);
      if (normalize) v = l2Normalize(v);
      rec.vector = v;
      rec.dims   = v.length;
      rec.model  = toModel;
      adapted++;
    } else {
      skipped++;
    }

    out.write(JSON.stringify(rec) + '\n');
    if (total % 5000 === 0) process.stdout.write(`\r[adapter] ${adapted}/${total} adapted`);
  }

  await new Promise((res, rej) => out.on('finish', res).on('error', rej));
  out.end();

  const { renameSync } = await import('fs');
  renameSync(outPath + '.tmp', outPath);

  process.stdout.write('\n');
  console.log(`[adapter] ✓ stream adapt complete — ${adapted}/${total} records → ${outPath}`);
  return { adapted, skipped, total };
}
