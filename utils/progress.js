export function progress(current, total, label = '') {
  const pct = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r[${bar}] ${pct}% ${label} (${current}/${total})`);
  if (current === total) process.stdout.write('\n');
}