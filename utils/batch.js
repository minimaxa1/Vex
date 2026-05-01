export function* chunk(arr, size) {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
export async function batchLoad(records, loadFn, { batchSize = 100, onProgress } = {}) {
  let done = 0;
  for (const batch of chunk(records, batchSize)) {
    await loadFn(batch);
    done += batch.length;
    if (onProgress) onProgress(done, records.length);
  }
}
