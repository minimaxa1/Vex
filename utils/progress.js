/**
 * Inline progress bar.
 */
export function progress(current, total, label = '') {
  const pct  = total === 0 ? 100 : Math.round((current / total) * 100);
  const fill = Math.floor(pct / 5);
  const bar  = '█'.repeat(fill) + '░'.repeat(20 - fill);
  process.stdout.write(`\r[${bar}] ${pct}% ${label} (${current}/${total})`);
  if (current >= total) process.stdout.write('\n');
}

/**
 * Print a labelled summary block at the end of an import/export.
 */
export function summary({ connector, total, upserted, skipped, durationMs }) {
  const secs = (durationMs / 1000).toFixed(1);
  const line = '─'.repeat(40);
  console.log('');
  console.log(`┌─ ${connector} summary ─${line.slice(connector.length + 12)}`);
  console.log(`│  total records   : ${total}`);
  console.log(`│  upserted        : ${upserted}`);
  console.log(`│  skipped         : ${skipped}`);
  console.log(`│  duration        : ${secs}s`);
  console.log(`└${line}`);
}
