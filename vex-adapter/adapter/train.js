/**
 * adapter/train.js — train a linear projection from aligned embedding pairs
 *
 * Algorithm: least-squares linear regression (Moore-Penrose pseudoinverse)
 * X = source vectors [N × d_src], Y = target vectors [N × d_tgt]
 * W = (X^T X)^-1 X^T Y  (solved iteratively via gradient descent for large dims)
 *
 * Input format — aligned.jsonl, one pair per line:
 * { "source": [0.1, 0.2, ...], "target": [0.3, 0.4, ...] }
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pairKey } from './models.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJ_DIR = join(__dirname, 'projections');

/**
 * Load aligned pairs from jsonl file.
 * Returns { X: number[][], Y: number[][] }
 */
async function loadPairs(filePath) {
  const X = [], Y = [];
  const rl = createInterface({ input: createReadStream(filePath) });
  for await (const line of rl) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const pair = JSON.parse(t);
    if (!pair.source || !pair.target) continue;
    X.push(pair.source);
    Y.push(pair.target);
  }
  console.log(`[train] loaded ${X.length} aligned pairs`);
  return { X, Y };
}

/**
 * Matrix multiply: A [m×k] × B [k×n] → C [m×n]
 */
function matMul(A, B) {
  const m = A.length, k = A[0].length, n = B[0].length;
  const C = Array.from({ length: m }, () => new Float64Array(n));
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let l = 0; l < k; l++) s += A[i][l] * B[l][j];
      C[i][j] = s;
    }
  return C;
}

/**
 * Transpose matrix.
 */
function transpose(A) {
  const m = A.length, n = A[0].length;
  const T = Array.from({ length: n }, () => new Float64Array(m));
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) T[j][i] = A[i][j];
  return T;
}

/**
 * Solve W via gradient descent (SGD) — avoids XᵀX inversion for large dims.
 * W shape: [d_target × d_source]
 */
function trainGD(X, Y, { lr = 0.01, epochs = 50, batchSize = 256 } = {}) {
  const N  = X.length;
  const dS = X[0].length;
  const dT = Y[0].length;

  // init W with small random values
  const W = Array.from({ length: dT }, () =>
    Array.from({ length: dS }, () => (Math.random() - 0.5) * 0.01)
  );
  const b = new Float64Array(dT); // bias

  for (let epoch = 0; epoch < epochs; epoch++) {
    // shuffle indices
    const idx = Array.from({ length: N }, (_, i) => i).sort(() => Math.random() - 0.5);
    let loss = 0;

    for (let start = 0; start < N; start += batchSize) {
      const batch = idx.slice(start, start + batchSize);
      const bN = batch.length;

      // forward: pred = X_b @ W^T + b  →  [bN × dT]
      const gradW = Array.from({ length: dT }, () => new Float64Array(dS));
      const gradB = new Float64Array(dT);

      for (const bi of batch) {
        const x = X[bi], y = Y[bi];
        // pred_j = sum_k W[j][k]*x[k] + b[j]
        for (let j = 0; j < dT; j++) {
          let pred = b[j];
          for (let k = 0; k < dS; k++) pred += W[j][k] * x[k];
          const err = pred - y[j];
          loss += err * err;
          // accumulate grads
          gradB[j] += (2 * err) / bN;
          for (let k = 0; k < dS; k++) gradW[j][k] += (2 * err * x[k]) / bN;
        }
      }

      // update
      for (let j = 0; j < dT; j++) {
        b[j] -= lr * gradB[j];
        for (let k = 0; k < dS; k++) W[j][k] -= lr * gradW[j][k];
      }
    }

    if ((epoch + 1) % 10 === 0 || epoch === 0) {
      process.stdout.write(`\r[train] epoch ${epoch+1}/${epochs}  loss=${(loss/N).toFixed(6)}`);
    }
  }
  process.stdout.write('\n');
  return { W: W.map(r => Array.from(r)), b: Array.from(b) };
}

/**
 * Evaluate projection quality: mean cosine similarity on held-out pairs.
 */
function evaluate(X, Y, W, b) {
  let totalCos = 0;
  const { projectVector, l2Normalize } = { 
    projectVector: (v, W, b) => {
      const out = new Float64Array(W.length);
      for (let i = 0; i < W.length; i++) {
        out[i] = (b ? b[i] : 0);
        for (let j = 0; j < v.length; j++) out[i] += W[i][j] * v[j];
      }
      return Array.from(out);
    },
    l2Normalize: (v) => {
      const n = Math.sqrt(v.reduce((s, x) => s + x*x, 0));
      return n ? v.map(x => x/n) : v;
    }
  };

  const evalN = Math.min(X.length, 500);
  for (let i = 0; i < evalN; i++) {
    const pred = l2Normalize(projectVector(X[i], W, b));
    const gt   = l2Normalize(Y[i]);
    let dot = 0;
    for (let j = 0; j < pred.length; j++) dot += pred[j] * gt[j];
    totalCos += dot;
  }
  return totalCos / evalN;
}

/**
 * Main train function.
 */
export async function train(pairsFile, fromModel, toModel, opts = {}) {
  if (!existsSync(pairsFile)) throw new Error(`[train] pairs file not found: ${pairsFile}`);

  const { X, Y } = await loadPairs(pairsFile);
  if (X.length < 100) throw new Error(`[train] need ≥100 pairs, got ${X.length}`);

  const dS = X[0].length, dT = Y[0].length;
  console.log(`[train] d_source=${dS} d_target=${dT} pairs=${X.length}`);

  // split 90/10 train/eval
  const splitAt = Math.floor(X.length * 0.9);
  const Xtrain = X.slice(0, splitAt), Ytrain = Y.slice(0, splitAt);
  const Xeval  = X.slice(splitAt),  Yeval  = Y.slice(splitAt);

  const { W, b } = trainGD(Xtrain, Ytrain, {
    lr:        opts.lr        || 0.005,
    epochs:    opts.epochs    || 100,
    batchSize: opts.batchSize || 512,
  });

  const cos = evaluate(Xeval, Yeval, W, b);
  console.log(`[train] eval cosine similarity: ${cos.toFixed(4)} (${Xeval.length} held-out pairs)`);

  const proj = {
    from:      fromModel,
    to:        toModel,
    d_source:  dS,
    d_target:  dT,
    normalize: true,
    pairs:     X.length,
    eval_cos:  cos,
    trained:   new Date().toISOString(),
    W,
    b,
  };

  // write to projections dir
  const { mkdirSync } = await import('fs');
  mkdirSync(PROJ_DIR, { recursive: true });
  const outPath = join(PROJ_DIR, `${pairKey(fromModel, toModel)}.json`);
  writeFileSync(outPath, JSON.stringify(proj));
  console.log(`[train] ✓ projection saved → ${outPath}`);
  console.log(`[train] quality: ${cos >= 0.9 ? '✅ excellent' : cos >= 0.75 ? '⚠ good' : '❌ poor — collect more pairs'}`);
  return { outPath, eval_cos: cos };
}
