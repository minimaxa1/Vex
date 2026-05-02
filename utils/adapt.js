/**
 * utils/adapt.js — vec2vec projection via @vektormemory/vex-adapter
 * Translates embeddings between models without re-embedding from text.
 * Premium feature — requires: npm install @vektormemory/vex-adapter
 */

import { createRequire } from 'module';

async function getAdapter() {
  try {
    const require = createRequire(import.meta.url);
    return require('@vektormemory/vex-adapter');
  } catch {
    throw new Error(
      '[adapt] @vektormemory/vex-adapter not installed.\n' +
      '        Run: npm install @vektormemory/vex-adapter\n' +
      '        Or purchase at: https://vektormemory.com'
    );
  }
}

/**
 * Project records from their source model to targetModel using linear projection.
 * Mutates records in-place (vector, dims, model fields).
 *
 * @param {Array} records    — vmig records with .vector and .model fields
 * @param {string} targetModel — e.g. 'text-embedding-3-small'
 * @param {object} opts
 * @returns {Array} mutated records
 */
export async function adaptRecords(records, targetModel, opts = {}) {
  const mod = await getAdapter();
  const VexAdapter = mod.VexAdapter ?? mod.default?.VexAdapter ?? mod.default;

  if (!VexAdapter) throw new Error('[adapt] VexAdapter class not found in @vektormemory/vex-adapter');

  // group by source model — skip records already in target space
  const byModel = {};
  let alreadyCorrect = 0;
  let noVector = 0;

  for (const r of records) {
    if (!r.vector) { noVector++; continue; }
    if (!r.model || r.model === targetModel) { alreadyCorrect++; continue; }
    (byModel[r.model] = byModel[r.model] || []).push(r);
  }

  const srcModels = Object.keys(byModel);
  if (!srcModels.length) {
    console.log(`[adapt] no records need projection (${alreadyCorrect} already in target space, ${noVector} no-vector)`);
    return records;
  }

  if (noVector)       console.warn(`[adapt] ⚠ ${noVector} records skipped (no vector)`);
  if (alreadyCorrect) console.log(`[adapt] ${alreadyCorrect} records already in target space — skipped`);

  for (const srcModel of srcModels) {
    const batch = byModel[srcModel];
    console.log(`[adapt] projecting ${batch.length} records: ${srcModel} → ${targetModel}`);

    let adapter;
    try {
      adapter = new VexAdapter(srcModel, targetModel);
    } catch (e) {
      throw new Error(
        `[adapt] no projection available: ${srcModel} → ${targetModel}\n` +
        `        Run 'vex adapters' to list available pairs.\n` +
        `        Original: ${e.message}`
      );
    }

    const vectors  = batch.map(r => r.vector);
    const projected = adapter.project(vectors);

    for (let i = 0; i < batch.length; i++) {
      batch[i].vector = Array.from(projected[i]); // ensure plain array
      batch[i].dims   = batch[i].vector.length;
      batch[i].model  = targetModel;
    }

    console.log(`[adapt] ✓ ${batch.length} records projected → ${projected[0]?.length ?? '?'}-dim`);
  }

  return records;
}

/**
 * Check if a projection path exists between two models.
 * Returns false (not throws) if vex-adapter is not installed.
 */
export async function canAdapt(srcModel, targetModel) {
  try {
    const mod = await getAdapter();
    const VexAdapter = mod.VexAdapter ?? mod.default?.VexAdapter ?? mod.default;
    return typeof VexAdapter.canProject === 'function'
      ? VexAdapter.canProject(srcModel, targetModel)
      : true; // assume yes if canProject not exposed
  } catch {
    return false;
  }
}

/**
 * List all available (srcModel, targetModel) projection pairs.
 */
export async function listAdapters() {
  const mod = await getAdapter();
  const VexAdapter = mod.VexAdapter ?? mod.default?.VexAdapter ?? mod.default;
  if (typeof VexAdapter.listPairs !== 'function') {
    return '[adapt] VexAdapter.listPairs() not available — update @vektormemory/vex-adapter';
  }
  return VexAdapter.listPairs();
}
