import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { classifyBatchLLM } from './llm.js';
import { classifyRules } from './rules.js';

const hashOf = (e) => createHash('sha1').update(JSON.stringify([e.title, e.description, e.venue_name, e.raw_categories, e.raw_audience, e.price_text])).digest('hex');

/**
 * Tag events. Order of preference: cache -> LLM -> rules fallback.
 * Every result records tag_source ('llm' | 'rules' | 'cache:*') and gets needs_review when confidence is low or the model/rules disagree on kid relevance.
 */
export async function classifyAll(events, { cachePath = 'data/cache/classify.json', useLLM = true, batchSize = 20, concurrency = 4, llmOptions = {}, log = () => {} } = {}) {
  let cache = {};
  if (existsSync(cachePath)) { try { cache = JSON.parse(readFileSync(cachePath, 'utf8')); } catch { cache = {}; } }
  const results = new Map();
  const todo = [];
  const haveKey = useLLM && (llmOptions.apiKey || process.env.ANTHROPIC_API_KEY);
  for (const e of events) {
    const h = hashOf(e);
    // Rules results are a fallback: with a key, give Claude another try instead of keeping them forever.
    if (cache[h] && !(haveKey && cache[h].tag_source === 'rules')) results.set(e.id, { ...cache[h], tag_source: `cache:${cache[h].tag_source}` });
    else todo.push({ e, h });
  }
  let llmOk = 0, fallback = 0;
  const chunks = [];
  for (let i = 0; i < todo.length; i += batchSize) chunks.push(todo.slice(i, i + batchSize));
  // A few batches in flight at once; each failed batch falls back to rules on its own.
  const llmResults = new Array(chunks.length).fill(null);
  if (haveKey) {
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const k = next++;
        try { llmResults[k] = await classifyBatchLLM(chunks[k].map((c) => c.e), llmOptions); }
        catch (err) { log(`LLM batch ${k + 1}/${chunks.length} failed, using rules: ${err.message}`); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  }
  for (const [k, chunk] of chunks.entries()) {
    const llm = llmResults[k];
    for (const { e, h } of chunk) {
      const rules = classifyRules(e);
      const t = llm?.get(e.id);
      let tags;
      if (t) {
        llmOk++;
        tags = { ...t, tag_source: 'llm', needs_review: t.confidence < 0.6 || t.issues.length > 0 || t.kid_relevant !== rules.kid_relevant };
      } else {
        fallback++;
        tags = { ...rules, tag_source: 'rules', needs_review: rules.confidence < 0.6 || rules.issues.length > 0 };
      }
      results.set(e.id, tags);
      cache[h] = tags;
    }
  }
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache));
  log(`classified ${events.length} events: ${llmOk} by LLM, ${fallback} by rules, ${events.length - todo.length} from cache`);
  return results;
}
