"""
generate-weights.py
Trains linear projection matrices for all 7 bundled vex-adapter pairs.

Usage:
  pip install sentence-transformers datasets openai numpy tqdm
  python generate-weights.py

Output:
  adapter/projections/<from>-><to>.json  (one per pair)

Requirements:
  - OPENAI_API_KEY env var set (or in .env)
  - ~4GB disk for local models (cached in HuggingFace cache)
  - Internet access for first run (downloads models + AllNLI dataset)
"""

import os
import json
import time
import numpy as np
from pathlib import Path
from tqdm import tqdm

# ── Config ────────────────────────────────────────────────────────────────────

N_SENTENCES   = 50_000   # how many AllNLI sentences to embed
EVAL_SPLIT    = 0.10     # 10% held out for evaluation
LEARNING_RATE = 0.01
EPOCHS        = 200
BATCH_SIZE    = 512
OPENAI_BATCH  = 500      # OpenAI embedding batch size (max 2048)
OUTPUT_DIR    = Path("adapter/projections")

# The 7 bundled pairs from models.js
PAIRS = [
    ("bge-small-en-v1.5",       "text-embedding-3-small"),
    ("bge-base-en-v1.5",        "text-embedding-3-small"),
    ("bge-large-en-v1.5",       "text-embedding-3-large"),
    ("all-MiniLM-L6-v2",        "text-embedding-3-small"),
    ("all-mpnet-base-v2",       "text-embedding-3-small"),
    ("text-embedding-ada-002",  "text-embedding-3-small"),
    ("e5-base-v2",              "text-embedding-3-small"),
]

# HuggingFace model name for each local model key
LOCAL_HF_NAMES = {
    "bge-small-en-v1.5":  "BAAI/bge-small-en-v1.5",
    "bge-base-en-v1.5":   "BAAI/bge-base-en-v1.5",
    "bge-large-en-v1.5":  "BAAI/bge-large-en-v1.5",
    "all-MiniLM-L6-v2":   "sentence-transformers/all-MiniLM-L6-v2",
    "all-mpnet-base-v2":  "sentence-transformers/all-mpnet-base-v2",
    "e5-small-v2":        "intfloat/e5-small-v2",
    "e5-base-v2":         "intfloat/e5-base-v2",
    "e5-large-v2":        "intfloat/e5-large-v2",
}

OPENAI_MODELS = {"text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"}

# ── Helpers ───────────────────────────────────────────────────────────────────

def load_sentences(n):
    print(f"\n[dataset] Loading {n:,} sentences from AllNLI (HuggingFace)...")
    from datasets import load_dataset
    ds = load_dataset("sentence-transformers/all-nli", "pair", split="train")
    sentences = list(dict.fromkeys(list(ds["anchor"]) + list(ds["positive"])))[:n]
    print(f"[dataset] Got {len(sentences):,} unique sentences.")
    return sentences


def embed_local(model_key, sentences):
    from sentence_transformers import SentenceTransformer
    hf_name = LOCAL_HF_NAMES[model_key]
    print(f"\n[embed] Loading local model: {hf_name}")
    model = SentenceTransformer(hf_name)
    print(f"[embed] Embedding {len(sentences):,} sentences with {model_key}...")
    vecs = model.encode(sentences, batch_size=128, show_progress_bar=True,
                        normalize_embeddings=True)
    return vecs.astype(np.float32)


def embed_openai(model_key, sentences):
    from openai import OpenAI
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        # try .env file next to script
        env_path = Path(__file__).parent / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("OPENAI_API_KEY="):
                    api_key = line.split("=", 1)[1].strip().strip('"')
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not found in environment or .env file")

    client = OpenAI(api_key=api_key)
    print(f"\n[embed] Calling OpenAI {model_key} for {len(sentences):,} sentences...")
    all_vecs = []

    for i in tqdm(range(0, len(sentences), OPENAI_BATCH), desc=f"openai/{model_key}"):
        batch = sentences[i : i + OPENAI_BATCH]
        while True:
            try:
                resp = client.embeddings.create(model=model_key, input=batch)
                vecs = [item.embedding for item in sorted(resp.data, key=lambda x: x.index)]
                all_vecs.extend(vecs)
                break
            except Exception as e:
                print(f"  [retry] {e} — waiting 5s")
                time.sleep(5)

    arr = np.array(all_vecs, dtype=np.float32)
    # L2-normalise to match local model output
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    arr = arr / np.maximum(norms, 1e-9)
    return arr


def get_embeddings(model_key, sentences, cache):
    """Return embeddings, using cache to avoid re-embedding across pairs."""
    if model_key not in cache:
        if model_key in OPENAI_MODELS:
            cache[model_key] = embed_openai(model_key, sentences)
        else:
            cache[model_key] = embed_local(model_key, sentences)
    return cache[model_key]


def cosine_similarity_mean(A, B):
    """Mean cosine similarity between row-paired matrices (already L2-normed)."""
    return float(np.mean(np.sum(A * B, axis=1)))


def train_projection(src_vecs, tgt_vecs):
    """
    Learn W (shape: [d_tgt, d_src]) such that tgt ≈ W @ src.
    Uses mini-batch SGD with momentum. Returns W as np.ndarray.
    """
    n = len(src_vecs)
    split = int(n * (1 - EVAL_SPLIT))
    X_tr, X_ev = src_vecs[:split], src_vecs[split:]
    Y_tr, Y_ev = tgt_vecs[:split], tgt_vecs[split:]

    d_src = X_tr.shape[1]
    d_tgt = Y_tr.shape[1]

    # Closed-form least squares warm start: W = (Y^T X)(X^T X)^{-1}
    print(f"  [train] Warm-starting with least-squares (src={d_src}, tgt={d_tgt})...")
    # Use a random subset for speed on large dims
    ls_n = min(10_000, len(X_tr))
    Xs = X_tr[:ls_n].T          # [d_src, ls_n]
    Ys = Y_tr[:ls_n].T          # [d_tgt, ls_n]
    # W = Ys @ Xs.T @ inv(Xs @ Xs.T + ridge)
    ridge = 1e-4 * np.eye(d_src)
    W = Ys @ Xs.T @ np.linalg.inv(Xs @ Xs.T + ridge)   # [d_tgt, d_src]
    W = W.astype(np.float32)

    baseline = cosine_similarity_mean(X_ev @ W.T / np.maximum(
        np.linalg.norm(X_ev @ W.T, axis=1, keepdims=True), 1e-9), Y_ev)
    print(f"  [train] Least-squares baseline cosine: {baseline:.4f}")

    # SGD refinement
    velocity = np.zeros_like(W)
    momentum = 0.9
    lr = LEARNING_RATE
    best_score = baseline
    best_W = W.copy()

    print(f"  [train] SGD refinement — {EPOCHS} epochs, batch={BATCH_SIZE}...")
    indices = np.arange(len(X_tr))

    for epoch in range(EPOCHS):
        np.random.shuffle(indices)
        epoch_loss = 0.0
        steps = 0

        for start in range(0, len(indices), BATCH_SIZE):
            idx = indices[start : start + BATCH_SIZE]
            Xb = X_tr[idx]          # [B, d_src]
            Yb = Y_tr[idx]          # [B, d_tgt]

            pred = Xb @ W.T         # [B, d_tgt]
            diff = pred - Yb        # [B, d_tgt]
            loss = float(np.mean(diff ** 2))
            grad = (2.0 / len(idx)) * diff.T @ Xb   # [d_tgt, d_src]

            velocity = momentum * velocity - lr * grad
            W = W + velocity
            epoch_loss += loss
            steps += 1

        if (epoch + 1) % 20 == 0:
            pred_ev = X_ev @ W.T
            norms_ev = np.linalg.norm(pred_ev, axis=1, keepdims=True)
            pred_ev_n = pred_ev / np.maximum(norms_ev, 1e-9)
            score = cosine_similarity_mean(pred_ev_n, Y_ev)
            avg_loss = epoch_loss / steps
            print(f"    epoch {epoch+1:3d}/{EPOCHS}  loss={avg_loss:.5f}  eval_cosine={score:.4f}")
            if score > best_score:
                best_score = score
                best_W = W.copy()
            # decay lr every 50 epochs
            if (epoch + 1) % 50 == 0:
                lr *= 0.5

    print(f"  [train] Best eval cosine: {best_score:.4f}")
    return best_W, best_score


def save_projection(from_model, to_model, W, score, n_train, n_eval):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{from_model}--{to_model}.json"
    out_path = OUTPUT_DIR / filename

    payload = {
        "from":       from_model,
        "to":         to_model,
        "d_src":      int(W.shape[1]),
        "d_tgt":      int(W.shape[0]),
        "eval_cosine": round(score, 6),
        "n_train":    n_train,
        "n_eval":     n_eval,
        "corpus":     "sentence-transformers/all-nli:pair:premise (50k)",
        "trained":    time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "W":          W.tolist(),
    }

    with open(out_path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    size_mb = out_path.stat().st_size / 1_048_576
    print(f"  [save] {out_path}  ({size_mb:.1f} MB)  cosine={score:.4f}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  vex-adapter — weight file generator")
    print(f"  {len(PAIRS)} pairs  ·  {N_SENTENCES:,} sentences  ·  AllNLI corpus")
    print("=" * 60)

    sentences = load_sentences(N_SENTENCES)
    n_total = len(sentences)
    n_eval  = int(n_total * EVAL_SPLIT)
    n_train = n_total - n_eval

    embed_cache = {}   # model_key → np.ndarray, reused across pairs

    results = []
    for from_model, to_model in PAIRS:
        pair_label = f"{from_model} → {to_model}"
        print(f"\n{'─'*60}")
        print(f"  PAIR: {pair_label}")
        print(f"{'─'*60}")

        src_vecs = get_embeddings(from_model, sentences, embed_cache)
        tgt_vecs = get_embeddings(to_model,   sentences, embed_cache)

        W, score = train_projection(src_vecs, tgt_vecs)
        save_projection(from_model, to_model, W, score, n_train, n_eval)
        results.append((pair_label, score))

    print(f"\n{'='*60}")
    print("  DONE — Summary")
    print(f"{'='*60}")
    for label, score in results:
        status = "✅" if score >= 0.80 else "⚠️ "
        print(f"  {status}  {label:<50}  cosine={score:.4f}")
    print(f"\n  Files saved to: {OUTPUT_DIR.resolve()}")
    print("  Next: npm publish from vex-adapter/")


if __name__ == "__main__":
    main()
