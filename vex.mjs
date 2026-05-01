#!/usr/bin/env node
import { getConnector } from './connectors/index.js';

const args = process.argv.slice(2);
const cmd = args[0];

function parseFlags(args) {
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      flags[args[i].slice(2)] = args[i+1] ?? true;
      i++;
    }
  }
  return flags;
}

const HELP = `
vex — Vector Exchange v0.0.1

Commands:
  vex export  --from <connector> --output <file.vmig.jsonl> [--db path] [--namespace ns]
  vex import  --from <file.vmig.jsonl> --to <connector> [--output path]
  vex migrate --from <connector> --to <connector> [options]

Connectors: vektor, jsonl
  (pinecone, qdrant coming in v0.1)

Examples:
  vex export --from vektor --db slipstream-memory.db --output memories.vmig.jsonl
  vex import --from memories.vmig.jsonl --to jsonl --output restored.vmig.jsonl
`;

if (!cmd || cmd === '--help' || cmd === 'help') {
  console.log(HELP);
  process.exit(0);
}

const flags = parseFlags(args);

if (cmd === 'export') {
  if (!flags.from) { console.error('Error: --from required'); process.exit(1); }
  const src = getConnector(flags.from);
  const records = await src.extract(flags);
  const dst = getConnector('jsonl');
  await dst.load(records, flags);

} else if (cmd === 'import') {
  if (!flags.from || !flags.to) { console.error('Error: --from and --to required'); process.exit(1); }
  const src = getConnector('jsonl');
  const records = await src.extract({ file: flags.from });
  const dst = getConnector(flags.to);
  await dst.load(records, flags);

} else if (cmd === 'migrate') {
  if (!flags.from || !flags.to) { console.error('Error: --from and --to required'); process.exit(1); }
  const src = getConnector(flags.from);
  const records = await src.extract(flags);
  const dst = getConnector(flags.to);
  await dst.load(records, flags);

} else {
  console.error(`Unknown command: ${cmd}`);
  console.log(HELP);
  process.exit(1);
}