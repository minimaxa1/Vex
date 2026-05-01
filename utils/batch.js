export function* chunk(arr, size) {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

/**
 * Process records in batches with optional progress callback and retry.
 */
export async function batchLoad(records, loadFn, {
  batchSize = 100,
  onProgress,
  retries = 3,
  retryDelayMs = 1000,
} = {}) {
  let done = 0;
  for (const batch of chunk(records, batchSize)) {
    let attempt = 0;
    while (true) {
      try {
        await loadFn(batch);
        break;
      } catch (err) {
        attempt++;
        if (attempt > retries) throw err;
        const wait = retryDelayMs * attempt;
        process.stderr.write(`\n[batch] error (attempt ${attempt}/${retries}), retrying in ${wait}ms: ${err.message}\n`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    done += batch.length;
    if (onProgress) onProgress(done, records.length);
  }
}
