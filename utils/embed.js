/**
 * utils/embed.js — re-embed text records via OpenAI or Ollama
 * Used by --reembed + --embed-model flags
 */

const BATCH_SIZE = 512; // OpenAI max per request

export async function reEmbed(records, opts) {
  const model    = opts['embed-model'] || process.env.EMBED_MODEL || 'text-embedding-3-small';
  const apiKey   = opts['openai-key']  || process.env.OPENAI_API_KEY;
  const ollamaUrl = opts['ollama-url'] || process.env.OLLAMA_URL; // e.g. http://localhost:11434

  const isOllama = !!ollamaUrl || model.startsWith('ollama:');
  const cleanModel = model.replace(/^ollama:/, '');

  const embeddable = records.filter(r => r.text && (!r.vector || opts['force-reembed']));
  if (!embeddable.length) {
    console.log('[embed] no records need re-embedding');
    return records;
  }

  console.log(`[embed] re-embedding ${embeddable.length} records via ${isOllama ? 'ollama' : 'openai'} model=${cleanModel}`);

  if (!isOllama && !apiKey) throw new Error('[embed] OPENAI_API_KEY required for OpenAI embedding');

  // process in batches
  let done = 0;
  for (let i = 0; i < embeddable.length; i += BATCH_SIZE) {
    const batch = embeddable.slice(i, i + BATCH_SIZE);
    const texts = batch.map(r => r.text);

    let vectors;
    if (isOllama) {
      vectors = await embedOllama(texts, cleanModel, ollamaUrl || 'http://localhost:11434');
    } else {
      vectors = await embedOpenAI(texts, cleanModel, apiKey);
    }

    for (let j = 0; j < batch.length; j++) {
      batch[j].vector = vectors[j];
      batch[j].dims   = vectors[j].length;
      batch[j].model  = cleanModel;
    }

    done += batch.length;
    process.stdout.write(`\r[embed] ${done}/${embeddable.length} embedded`);
  }
  process.stdout.write('\n');
  console.log(`[embed] ✓ re-embedding complete`);
  return records;
}

async function embedOpenAI(texts, model, apiKey) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) throw new Error(`[embed/openai] ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // openai returns in order
  return data.data.sort((a,b) => a.index - b.index).map(d => d.embedding);
}

async function embedOllama(texts, model, baseUrl) {
  // Ollama /api/embed takes one text at a time (or batch in newer versions)
  const url = `${baseUrl.replace(/\/$/, '')}/api/embed`;
  const vectors = [];
  for (const text of texts) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
    });
    if (!res.ok) throw new Error(`[embed/ollama] ${res.status}: ${await res.text()}`);
    const data = await res.json();
    // ollama returns { embeddings: [[...]] } or { embedding: [...] }
    vectors.push(data.embeddings?.[0] ?? data.embedding);
  }
  return vectors;
}
