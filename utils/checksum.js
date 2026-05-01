import { createHash } from 'crypto';
import fs from 'fs';

/**
 * SHA-256 checksum of a file, returned as hex string.
 */
export function checksumFile(filePath) {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * SHA-256 checksum of an array of records (serialised deterministically).
 */
export function checksumRecords(records) {
  const data = records.map(r => JSON.stringify(r)).join('\n');
  return createHash('sha256').update(data).digest('hex');
}
