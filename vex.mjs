#!/usr/bin/env node
import { getConnector } from './connectors/index.js';
import { writeMeta }    from './formats/vmig.js';

const args = process.argv.slice(2);
const cmd  = args[0];

function parseFlags(args) {
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      flags[args[i].slice(2)] = args[i + 1] ?? true;
      i++;
    }
  }
  return flags;
}

const HELP = `
  vex — Vector Exchange  v0.1.0
  Apache 2.0  |  github.com/minimaxa1/Vex

  Commands:

    vex export  --from <connector> --output <file.vmig.jsonl> [options]
    vex import  --from <file.vmig.jsonl> --to <connector> [options]
    vex migrate --from <connector> --to <connector> [options]

  Connectors:
    vektor    — local VEKTOR Slipstream SQLite DB (export)
    jsonl     — .vmig.jsonl file (read/write)
    pinecone  — Pinecone index  (import) ← NEW in v0.1
    qdrant    — Qdrant collection (import, auto-create) ← NEW in v0.1

  Pinecone options:
    --api-key   <key>    or PINECONE_API_KEY env
    --index     <name>   or PINECONE_INDEX   env
    --host      <url>    or PINECONE_HOST    env
    --namespace <ns>     (optional)

  Qdrant options:
    --url        <url>   or QDRANT_URL        env  (default: http://localhost:6333)
    --collection <name>  or QDRANT_COLLECTION env
    --api-key    <key>   or QDRANT_API_KEY    env  (optional)
    --auto-create        auto-create collection if missing (default: true)

  Examples:
    vex export  --from vektor  --db slipstream-memory.db  --output memories.vmig.jsonl
    vex import  --from memories.vmig.jsonl  --to pinecone  --api-key $KEY  --index my-idx  --host $HOST
    vex import  --from memories.vmig.jsonl  --to qdrant    --collection memories
    vex migrate --from vektor  --to qdrant  --db memory.db --collection memories
`;

if (!cmd || cmd === '--help' || cmd === 'help') {
  console.log(HELP);
  process.exit(0);
}

const flags = parseFlags(args);

// ── EXPORT ────────────────────────────────────────────────────────────────
if (cmd === 'export') {
  if (!flags.from) { console.error('Error: --from required'); process.exit(1); }
  const src     = getConnector(flags.from);
  const records = await src.extract(flags);
  const dst     = getConnector('jsonl');
  await dst.load(records, flags);

// ── IMPORT ────────────────────────────────────────────────────────────────
} else if (cmd === 'import') {
  if (!flags.from || !flags.to) { console.error('Error: --from and --to required'); process.exit(1); }
  const src     = getConnector('jsonl');
  const records = await src.extract({ file: flags.from });
  console.log(`[vex] loaded ${records.length} records from ${flags.from}`);
  const dst = getConnector(flags.to);
  await dst.load(records, flags);

  // write import-side meta sidecar
  const metaOut = flags.from.replace(/\.vmig\.jsonl$/, '.vmig.meta.json');
  writeMeta(records, flags.from, { imported_to: flags.to, imported_at: new Date().toISOString() });

// ── MIGRATE ───────────────────────────────────────────────────────────────
} else if (cmd === 'migrate') {
  if (!flags.from || !flags.to) { console.error('Error: --from and --to required'); process.exit(1); }
  const src     = getConnector(flags.from);
  const records = await src.extract(flags);
  console.log(`[vex] extracted ${records.length} records from ${flags.from}`);
  const dst = getConnector(flags.to);
  await dst.load(records, flags);

} else {
  console.error(`Unknown command: ${cmd}`);
  console.log(HELP);
  process.exit(1);
}
