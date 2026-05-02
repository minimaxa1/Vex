#!/usr/bin/env node
/**
 * bin/vex-adapt.mjs — CLI for @vektormemory/vex-adapter
 *
 * Commands:
 *   vex-adapt --from <model> --to <model> <input.vmig.jsonl> [output.vmig.jsonl]
 *   vex-adapt train --from <model> --to <model> --pairs <aligned.jsonl>
 *   vex-adapt list
 *   vex-adapt info --from <model> --to <model>
 */
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adapterDir = join(__dirname, '..', 'adapter');

// parse args
const args = process.argv.slice(2);

function flag(name, def = null) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
function has(name) { return args.includes(name); }

const cmd      = args[0];
const fromModel = flag('--from');
const toModel   = flag('--to');
const pairsFile = flag('--pairs');
const projPath  = flag('--projection');
const forceFlag = has('--force');
const jsonFlag  = has('--json');

const CYAN  = s => `\x1b[36m${s}\x1b[0m`;
const GREEN = s => `\x1b[32m${s}\x1b[0m`;
const BOLD  = s => `\x1b[1m${s}\x1b[0m`;
const DIM   = s => `\x1b[2m${s}\x1b[0m`;

function printHelp() {
  console.log(`
${BOLD('@vektormemory/vex-adapter')} — vec2vec linear projection  ${DIM('no re-embedding required')}

${BOLD('ADAPT')}
  vex-adapt --from <model> --to <model> input.vmig.jsonl [output.vmig.jsonl]
  vex-adapt --from bge-small-en-v1.5 --to text-embedding-3-small memories.vmig.jsonl

  Flags:
    --from <model>        source embedding model
    --to   <model>        target embedding model
    --projection <path>   use custom .json projection file
    --force               adapt records regardless of their stored model field
    --json                machine-readable JSON output

${BOLD('TRAIN')}
  vex-adapt train --from <model> --to <model> --pairs <aligned.jsonl>
  vex-adapt train --from bge-base-en-v1.5 --to text-embedding-3-small --pairs pairs.jsonl

  Pairs format (one per line):
    { "source": [0.1, ...], "target": [0.3, ...] }

  Flags:
    --lr <float>          learning rate (default 0.005)
    --epochs <int>        training epochs (default 100)

${BOLD('OTHER')}
  vex-adapt list          list bundled projection pairs
  vex-adapt info          show info for a specific pair (--from --to)
  vex-adapt --help        this message
`);
}

async function cmdList() {
  const { listPairs } = await import(join(adapterDir, 'models.js'));
  const pairs = listPairs();
  if (jsonFlag) { console.log(JSON.stringify({ pairs })); return; }
  console.log(BOLD('\nBundled projection pairs:'));
  for (const p of pairs) console.log(`  ${CYAN('◆')} ${p}`);
  console.log(DIM(`\n  ${pairs.length} pairs — use 'vex-adapt train' to add custom pairs\n`));
}

async function cmdInfo() {
  if (!fromModel || !toModel) { console.error('[vex-adapt] --from and --to required'); process.exit(1); }
  const { loadProjection } = await import(join(adapterDir, 'index.js'));
  try {
    const proj = loadProjection(fromModel, toModel, projPath);
    const info = { from: proj.from, to: proj.to, d_source: proj.d_source, d_target: proj.d_target, pairs: proj.pairs, eval_cos: proj.eval_cos, trained: proj.trained };
    if (jsonFlag) { console.log(JSON.stringify(info)); return; }
    console.log(BOLD('\nProjection info:'));
    for (const [k, v] of Object.entries(info)) console.log(`  ${k.padEnd(12)} ${v}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}

async function cmdTrain() {
  if (!fromModel || !toModel) { console.error('[vex-adapt] --from and --to required for train'); process.exit(1); }
  if (!pairsFile) { console.error('[vex-adapt] --pairs <aligned.jsonl> required'); process.exit(1); }
  const { train } = await import(join(adapterDir, 'train.js'));
  const opts = {
    lr:        flag('--lr')     ? parseFloat(flag('--lr'))  : undefined,
    epochs:    flag('--epochs') ? parseInt(flag('--epochs')) : undefined,
    batchSize: flag('--batch')  ? parseInt(flag('--batch'))  : undefined,
  };
  try {
    const result = await train(pairsFile, fromModel, toModel, opts);
    if (jsonFlag) { console.log(JSON.stringify(result)); }
  } catch (e) { console.error(e.message); process.exit(1); }
}

async function cmdAdapt(inputFile) {
  if (!fromModel || !toModel) { console.error('[vex-adapt] --from and --to required'); process.exit(1); }
  if (!existsSync(inputFile))  { console.error(`[vex-adapt] file not found: ${inputFile}`); process.exit(1); }

  const outputFile = args.find(a => a.endsWith('.jsonl') && a !== inputFile)
    || inputFile.replace('.vmig.jsonl', `.adapted.vmig.jsonl`);

  const { adaptStream } = await import(join(adapterDir, 'index.js'));
  const STREAM_THRESHOLD = 100_000;

  // count lines
  const { createReadStream } = await import('fs');
  const { createInterface } = await import('readline');
  let lineCount = 0;
  const rl = createInterface({ input: createReadStream(inputFile) });
  for await (const _ of rl) lineCount++;

  if (!jsonFlag) {
    console.log(`[vex-adapt] ${lineCount} records | ${fromModel} → ${toModel}`);
    console.log(`[vex-adapt] output → ${outputFile}`);
    if (lineCount > STREAM_THRESHOLD) console.log(`[vex-adapt] streaming mode (${lineCount} > 100k)`);
  }

  const opts = { projectionPath: projPath || undefined, force: forceFlag };
  const result = await adaptStream(inputFile, outputFile, fromModel, toModel, opts);

  if (jsonFlag) {
    console.log(JSON.stringify({ ...result, output: outputFile, from: fromModel, to: toModel }));
  } else {
    console.log(GREEN(`\n✓ adapted ${result.adapted}/${result.total} records → ${outputFile}`));
  }
}

// dispatch
(async () => {
  if (!cmd || cmd === '--help' || cmd === 'help') { printHelp(); process.exit(0); }
  if (cmd === 'list')  { await cmdList();  process.exit(0); }
  if (cmd === 'info')  { await cmdInfo();  process.exit(0); }
  if (cmd === 'train') { await cmdTrain(); process.exit(0); }

  // default: adapt — first non-flag positional arg is input file
  const inputFile = args.find(a => !a.startsWith('--') && a.endsWith('.jsonl'));
  if (!inputFile) { printHelp(); process.exit(1); }
  await cmdAdapt(inputFile);
})();
