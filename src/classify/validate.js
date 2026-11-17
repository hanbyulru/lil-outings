import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const VOCAB = JSON.parse(readFileSync(join(here, '../../config/vocab.json'), 'utf8'));

const clampAge = (n) => (Number.isFinite(+n) ? Math.max(0, Math.min(18, Math.round(+n))) : null);

/** Coerce whatever a classifier returned into our schema. Anything outside the vocab is dropped, not trusted. */
export function normalizeTags(t) {
  const issues = [];
  const kid = t.kid_relevant === true || t.kid_relevant === 'true';
  let min = clampAge(t.age_min), max = clampAge(t.age_max);
  if (kid && (min == null || max == null)) { issues.push('missing_age'); min = min ?? 0; max = max ?? 12; }
  if (min != null && max != null && min > max) { [min, max] = [max, min]; issues.push('age_swapped'); }
  const interests = [...new Set((t.interests || []).map((x) => String(x).toLowerCase()).filter((x) => VOCAB.interests.includes(x)))];
  const categories = [...new Set((t.categories || []).map((x) => String(x).toLowerCase()).filter((x) => VOCAB.categories.includes(x)))];
  const setting = VOCAB.settings.includes(t.setting) ? t.setting : 'unknown';
  const registration = VOCAB.registration.includes(t.registration) ? t.registration : 'unknown';
  const cost = ['free', 'paid', 'unknown'].includes(t.cost?.type) ? t.cost.type : 'unknown';
  const amount = cost === 'paid' && Number.isFinite(+t.cost?.amount) ? +t.cost.amount : null;
  const confidence = Number.isFinite(+t.confidence) ? Math.max(0, Math.min(1, +t.confidence)) : 0.5;
  return {
    kid_relevant: kid,
    age_min: kid ? min : null,
    age_max: kid ? max : null,
    interests, categories, setting, registration,
    cost_type: cost, cost_amount: amount,
    confidence,
    issues
  };
}

/** Age bands an event overlaps. */
export function bandsFor(min, max) {
  if (min == null || max == null) return [];
  return VOCAB.age_bands.filter((b) => min <= b.max && max >= b.min).map((b) => b.id);
}
