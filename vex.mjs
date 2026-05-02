#!/usr/bin/env node
import { getConnector } from './connectors/index.js';
import { writeMeta, readJsonl, validate } from './formats/vmig.js';
import fs from 'fs';
import readline from 'readline';

// ── PALETTE: light blues · dark blues · greys · white (zero deps) ──────────
const _ = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',

  // whites & greys
  white:    '\x1b[97m',
  silver:   '\x1b[37m',
  grey:     '\x1b[90m',

  // blue family (xterm-256 via 38;5)
  navy:     '\x1b[38;5;17m',   // #00005f  darkest
  cobalt:   '\x1b[38;5;26m',   // #005fd7
  steel:    '\x1b[38;5;67m',   // #5f87af
  sky:      '\x1b[38;5;117m',  // #87d7ff
  ice:      '\x1b[38;5;153m',  // #afd7ff  lightest blue
  powder:   '\x1b[38;5;189m',  // #d7d7ff  near-white blue

  // accents
  green:    '\x1b[38;5;78m',   // #5fd787
  red:      '\x1b[38;5;203m',  // #ff5f5f
  amber:    '\x1b[38;5;221m',  // #ffd75f
};

const p = (col, s) => `${col}${s}${_.reset}`;
const W  = s => p(_.white + _.bold, s);       // bright white — titles
const Si = s => p(_.silver, s);               // silver — secondary labels
const Gr = s => p(_.grey, s);                 // grey — dim / metadata
const Sk = s => p(_.sky, s);                  // sky blue — commands, keys
const Ic = s => p(_.ice, s);                  // ice blue — values, connectors
const St = s => p(_.steel, s);                // steel — box lines
const Pw = s => p(_.powder, s);               // powder — banner accent
const G  = s => p(_.green, s);                // green — success
const R  = s => p(_.red, s);                  // red — error
const Y  = s => p(_.amber, s);                // amber — warning
const Co = s => p(_.cobalt, s);               // cobalt — highlight

const VERSION = '0.2.0';

// ── BANNER ─────────────────────────────────────────────────────────────────
function banner() {
  console.log('');
  console.log(Co('  ██╗   ██╗') + St('███████╗') + Sk('██╗  ██╗'));
  console.log(Co('  ██║   ██║') + St('██╔════╝') + Sk('╚██╗██╔╝'));
  console.log(Co('  ██║   ██║') + St('█████╗  ') + Sk(' ╚███╔╝ '));
  console.log(Co('  ╚██╗ ██╔╝') + St('██╔══╝  ') + Sk(' ██╔██╗ '));
  console.log(Co('   ╚████╔╝ ') + St('███████╗') + Sk('██╔╝ ██╗') + '  ' + Gr(`v${VERSION}`));
  console.log(Co('    ╚═══╝  ') + St('╚══════╝') + Sk('╚═╝  ╚═╝'));
  console.log('');
  console.log('  ' + W('Vector Exchange') + Gr('  ·  Apache 2.0  ·  github.com/minimaxa1/Vex'));
  console.log('');
}

// ── BOX HELPERS ────────────────────────────────────────────────────────────
const BAR = St('│');
const TL  = St('┌─');
const BL  = St('└');
const HR  = St('─');

function box(label) {
  console.log('  ' + TL + ' ' + Ic(label) + ' ' + HR.repeat(Math.max(2, 44 - label.length)));
}
function boxEnd() {
  console.log('  ' + BL + HR.repeat(47));
  console.log('');
}
function row(label, value) {
  // strip ansi for padding calc
  const raw = label.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = ' '.repeat(Math.max(1, 18 - raw.length));
  console.log('  ' + BAR + '  ' + label + pad + value);
}
function blank() {
  console.log('  ' + BAR);
}

// ── HELP ───────────────────────────────────────────────────────────────────
function showHelp() {
  banner();

  box('COMMANDS');
  row(W('export'),   Sk('vex export')   + Gr('  --from <store>  --output <file.vmig.jsonl>'));
  row(W('import'),   Sk('vex import')   + Gr('  --from <file>   --to <store>'));
  row(W('migrate'),  Sk('vex migrate')  + Gr('  --from <store>  --to <store>'));
  row(W('inspect'),  Sk('vex inspect')  + Gr('  <file>  — show stats, models, namespaces'));
  row(W('validate'), Sk('vex validate') + Gr('  <file>  — lint all records'));
  boxEnd();

  box('CONNECTORS');
  row(G('✓') + ' ' + W('vektor'),   Si('VEKTOR Slipstream SQLite   ') + Ic('export · import'));
  row(G('✓') + ' ' + W('jsonl'),    Si('.vmig.jsonl file           ') + Ic('export · import'));
  row(G('✓') + ' ' + W('pinecone'), Si('Pinecone index             ') + Ic('export · import  ') + Gr('v0.2'));
  row(G('✓') + ' ' + W('qdrant'),   Si('Qdrant collection          ') + Ic('export · import  ') + Gr('v0.2'));
  row(G('✓') + ' ' + W('chroma'),   Si('ChromaDB                   ') + Ic('export · import  ') + Gr('v0.2'));
  row(Gr('○') + ' ' + Gr('weaviate'), Gr('Weaviate                                   phase 3'));
  row(Gr('○') + ' ' + Gr('pgvector'), Gr('PostgreSQL / pgvector                      phase 3'));
  boxEnd();

  box('COMMON FLAGS');
  row(Sk('--namespace'), Gr('<ns>     filter by namespace (export)'));
  row(Sk('--limit'),     Gr('<n>      max records to export'));
  row(Sk('--output'),    Gr('<file>   destination .vmig.jsonl file'));
  row(Sk('--db'),        Gr('<path>   VEKTOR SQLite DB path'));
  boxEnd();

  box('PINECONE OPTIONS');
  row(Sk('--api-key'),    Gr('<key>   or ') + Ic('PINECONE_API_KEY'));
  row(Sk('--index'),      Gr('<name>  or ') + Ic('PINECONE_INDEX'));
  row(Sk('--host'),       Gr('<url>   or ') + Ic('PINECONE_HOST'));
  row(Sk('--namespace'),  Gr('<ns>    optional'));
  boxEnd();

  box('QDRANT OPTIONS');
  row(Sk('--url'),         Gr('<url>   or ') + Ic('QDRANT_URL') + Gr('  default: http://localhost:6333'));
  row(Sk('--collection'),  Gr('<name>  or ') + Ic('QDRANT_COLLECTION'));
  row(Sk('--api-key'),     Gr('<key>   or ') + Ic('QDRANT_API_KEY') + Gr('  optional'));
  row(Sk('--auto-create'), Gr('auto-create collection if missing (default: true)'));
  boxEnd();

  box('CHROMA OPTIONS');
  row(Sk('--url'),        Gr('<url>   or ') + Ic('CHROMA_URL') + Gr('  default: http://localhost:8000'));
  row(Sk('--collection'), Gr('<name>  or ') + Ic('CHROMA_COLLECTION'));
  row(Sk('--tenant'),     Gr('<name>  optional, default: default_tenant'));
  row(Sk('--database'),   Gr('<name>  optional, default: default_database'));
  boxEnd();

  box('EXAMPLES');
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Export VEKTOR memory'));
  console.log('  ' + BAR + '  ' + Sk('vex export') + ' --from vektor --db memory.db --output memories.vmig.jsonl');
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Export specific namespace only'));
  console.log('  ' + BAR + '  ' + Sk('vex export') + ' --from vektor --db memory.db --namespace trading --output trading.vmig.jsonl');
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Import into Qdrant (auto-creates collection)'));
  console.log('  ' + BAR + '  ' + Sk('vex import') + ' --from memories.vmig.jsonl --to qdrant --collection memories');
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Migrate Qdrant → VEKTOR'));
  console.log('  ' + BAR + '  ' + Sk('vex migrate') + ' --from qdrant --to vektor --collection memories --db memory.db');
  blank();
  console.log('  ' + BAR + '  ' + Gr('# Inspect a file'));
  console.log('  ' + BAR + '  ' + Sk('vex inspect') + ' memories.vmig.jsonl');
  blank();
  boxEnd();
}

// ── INSPECT ────────────────────────────────────────────────────────────────
async function cmdInspect(file) {
  if (!file || !fs.existsSync(file)) {
    console.error('\n' + R(`  ✗  File not found: ${file || '(none provided)'}`)); process.exit(1);
  }
  banner();
  console.log('  ' + Gr(`Inspecting: ${file}`) + '\n');

  const records = await readJsonl(file);
  if (!records.length) { console.log(Y('  ⚠  File is empty')); return; }

  const models = {}, dims = {}, namespaces = {}, stores = {};
  let nullVec = 0, nullText = 0;
  const dates = records.map(r => r.created_at).filter(Boolean).sort();

  for (const r of records) {
    if (!r.vector) nullVec++;
    if (!r.text)   nullText++;
    if (r.model)        models[r.model]          = (models[r.model]         || 0) + 1;
    if (r.dims)         dims[String(r.dims)]      = (dims[String(r.dims)]   || 0) + 1;
    if (r.namespace)    namespaces[r.namespace]   = (namespaces[r.namespace]|| 0) + 1;
    if (r.source_store) stores[r.source_store]    = (stores[r.source_store] || 0) + 1;
  }

  const metaPath = file.replace(/\.vmig\.jsonl$/, '.vmig.meta.json');
  let meta = null;
  if (fs.existsSync(metaPath)) try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}

  box('FILE SUMMARY');
  row(Si('records'),     W(String(records.length)));
  row(Si('with vector'), G(String(records.length - nullVec))  + (nullVec  ? '  ' + Y(`(${nullVec} null)`)  : ''));
  row(Si('with text'),   G(String(records.length - nullText)) + (nullText ? '  ' + Y(`(${nullText} null)`) : ''));
  if (dates.length) {
    row(Si('earliest'),  Gr(dates[0]));
    row(Si('latest'),    Gr(dates[dates.length - 1]));
  }
  if (meta) {
    row(Si('checksum'),    Gr(meta.checksum    || '—'));
    row(Si('exported at'), Gr(meta.exported_at || '—'));
    if (meta.imported_to) row(Si('imported to'), Ic(meta.imported_to) + Gr(' @ ' + meta.imported_at));
  }
  boxEnd();

  if (Object.keys(models).length)     { box('MODELS');     for (const [m,n] of Object.entries(models))     row(Si(m),  Gr(`${n} records`)); boxEnd(); }
  if (Object.keys(dims).length)       { box('DIMENSIONS'); for (const [d,n] of Object.entries(dims))       row(Si(`${d}-dim`), Gr(`${n} records`)); boxEnd(); }
  if (Object.keys(namespaces).length) { box('NAMESPACES'); for (const [ns,n] of Object.entries(namespaces)) row(Si(ns), Gr(`${n} records`)); boxEnd(); }
  if (Object.keys(stores).length)     { box('SOURCES');    for (const [s,n] of Object.entries(stores))     row(Si(s),  Gr(`${n} records`)); boxEnd(); }
}

// ── VALIDATE ───────────────────────────────────────────────────────────────
async function cmdValidate(file) {
  if (!file || !fs.existsSync(file)) {
    console.error('\n' + R(`  ✗  File not found: ${file || '(none provided)'}`)); process.exit(1);
  }
  banner();
  console.log('  ' + Gr(`Validating: ${file}`) + '\n');

  const records = await readJsonl(file);
  let errors = 0, warnings = 0;

  box(`VALIDATION  (${records.length} records)`);

  for (let i = 0; i < records.length; i++) {
    const errs = validate(records[i]);
    if (errs.length) {
      errors++;
      console.log('  ' + BAR + '  ' + R(`✗  [${i}] id=${records[i].id ?? '?'}`));
      for (const e of errs) console.log('  ' + BAR + '     ' + Gr(`→ ${e}`));
    }
    if (!records[i].vector && records[i].text) {
      warnings++;
      console.log('  ' + BAR + '  ' + Y(`⚠  [${i}] no vector — re-embeddable from text`));
    }
  }

  if (!errors && !warnings)
    console.log('  ' + BAR + '  ' + G(`✓  All ${records.length} records valid`));

  boxEnd();
  box('RESULT');
  row(Si('records'),  W(String(records.length)));
  row(Si('errors'),   errors   ? R(String(errors))   : G('0'));
  row(Si('warnings'), warnings ? Y(String(warnings)) : G('0'));
  row(Si('status'),   errors   ? R('✗  INVALID')     : G('✓  VALID'));
  boxEnd();

  if (errors) process.exit(1);
}

// ── INTERACTIVE MENU ───────────────────────────────────────────────────────
async function interactiveMenu() {
  banner();
  console.log('  ' + W('No command given.') + Gr('  Run ') + Sk('vex --help') + Gr(' for full docs.\n'));

  const opts = [
    ['1', 'export',   'Export memory → .vmig.jsonl'],
    ['2', 'import',   'Import .vmig.jsonl → any store'],
    ['3', 'migrate',  'Migrate directly between stores'],
    ['4', 'inspect',  'Inspect a .vmig.jsonl file'],
    ['5', 'validate', 'Validate a .vmig.jsonl file'],
    ['h', 'help',     'Full help'],
    ['q', 'quit',     ''],
  ];

  for (const [k, label, desc] of opts) {
    if (k === 'q') { console.log(''); continue; }
    console.log('  ' + Co(`[${k}]`) + '  ' + W(label.padEnd(12)) + Gr(desc));
  }
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('  ' + Sk('→') + '  ', answer => {
    rl.close();
    const map = { '1':'export','2':'import','3':'migrate','4':'inspect','5':'validate' };
    const ch = answer.trim().toLowerCase();
    console.log('');
    if (ch === 'h') { showHelp(); return; }
    if (ch === 'q' || !ch) process.exit(0);
    if (map[ch]) console.log('  ' + G('✓') + '  Run: ' + Sk(`vex ${map[ch]} --help`) + '\n');
    else         console.log('  ' + R('✗') + '  Unknown option.\n');
  });
}

// ── FLAG PARSER ────────────────────────────────────────────────────────────
function parseFlags(argv) {
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key  = argv[i].slice(2);
      const next = argv[i + 1];
      flags[key] = (!next || next.startsWith('--')) ? true : next;
      if (next && !next.startsWith('--')) i++;
    }
  }
  return flags;
}

// ── MAIN ───────────────────────────────────────────────────────────────────
const args  = process.argv.slice(2);
const cmd   = args[0];
const flags = parseFlags(args);

if (!cmd)                                   { await interactiveMenu(); process.exit(0); }
if (['--help','-h','help'].includes(cmd))   { showHelp();             process.exit(0); }
if (['--version','-v'].includes(cmd))       { console.log(`vex v${VERSION}`); process.exit(0); }
if (cmd === 'inspect')  { await cmdInspect( args[1] || flags.file || flags.from); process.exit(0); }
if (cmd === 'validate') { await cmdValidate(args[1] || flags.file || flags.from); process.exit(0); }

// ── EXPORT ─────────────────────────────────────────────────────────────────
if (cmd === 'export') {
  if (!flags.from) { console.error(R('\n  ✗  --from required')); process.exit(1); }
  banner();
  const nsLabel = flags.namespace ? Gr(` [ns: ${flags.namespace}]`) : '';
  const limLabel = flags.limit    ? Gr(` [limit: ${flags.limit}]`)  : '';
  console.log('  ' + G('→') + '  Exporting from ' + Ic(flags.from) + nsLabel + limLabel + '\n');
  const records = await getConnector(flags.from).extract(flags);
  await getConnector('jsonl').load(records, flags);
  console.log('\n  ' + G('✓') + '  ' + W(String(records.length)) + ' records exported\n');

// ── IMPORT ─────────────────────────────────────────────────────────────────
} else if (cmd === 'import') {
  if (!flags.from || !flags.to) { console.error(R('\n  ✗  --from and --to required')); process.exit(1); }
  banner();
  console.log('  ' + G('→') + '  ' + Gr(flags.from) + ' → ' + Ic(flags.to) + '\n');
  const records = await getConnector('jsonl').extract({ file: flags.from });
  console.log('  ' + G('✓') + '  Loaded ' + W(String(records.length)) + ' records\n');
  await getConnector(flags.to).load(records, flags);
  writeMeta(records, flags.from, { imported_to: flags.to, imported_at: new Date().toISOString() });
  console.log('\n  ' + G('✓  Import complete\n'));

// ── MIGRATE ────────────────────────────────────────────────────────────────
} else if (cmd === 'migrate') {
  if (!flags.from || !flags.to) { console.error(R('\n  ✗  --from and --to required')); process.exit(1); }
  banner();
  console.log('  ' + G('→') + '  Migrating ' + Ic(flags.from) + ' → ' + Ic(flags.to) + '\n');
  const records = await getConnector(flags.from).extract(flags);
  console.log('  ' + G('✓') + '  Extracted ' + W(String(records.length)) + ' records\n');
  await getConnector(flags.to).load(records, flags);
  console.log('\n  ' + G('✓  Migration complete\n'));

} else {
  console.error(R(`\n  ✗  Unknown command: ${cmd}`));
  console.log('  Run ' + Sk('vex --help') + ' to see available commands.\n');
  process.exit(1);
}
