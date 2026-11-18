import { normalizeTags } from './validate.js';

const has = (s, re) => re.test(s);

/** Keyword/regex tagger. Used offline, in tests, and as the fallback when the LLM call fails or no key is set. */
export function classifyRules(ev) {
  const text = `${ev.title}\n${ev.description || ''}\n${ev.venue_name || ''}\n${(ev.raw_categories || []).join(' ')}\n${(ev.raw_audience || []).join(' ')}`.toLowerCase();
  const title = ev.title.toLowerCase();

  const adultOnly = has(title, /\b(adult|seniors?|resume|taxes|tax help|job|goodwill|microsoft|excel|powerpoint|google (docs|sheets|meet)|volunteer|stewardship|commission|board meeting|public meeting|trail work|planting|gardening and turf)\b/) || has(text, /\b(teens? only|ages? 18\+|adults? only|21\+)\b/);
  const teenOnly = has(title, /\b(teen|teens|ya)\b/) && !has(text, /\b(kids|children|family)\b/);

  let min = null, max = null;
  let m;
  if ((m = text.match(/ages?\s*(\d{1,2})\s*(?:-|–|to|through)\s*(\d{1,2})/))) { min = +m[1]; max = +m[2]; }
  else if ((m = text.match(/ages?\s*(\d{1,2})\s*\+/))) { min = +m[1]; max = 12; }
  else if (has(text, /birth to 12 months|book babies|\bbabies\b|baby storytime|baby time|lapsit|infants?/)) { min = 0; max = 1; }
  else if (has(text, /one-year-olds|tiny tots/)) { min = 1; max = 2; }
  else if (has(text, /toddlers?/)) { min = 1; max = 3; }
  else if (has(text, /preschool/)) { min = 3; max = 5; }
  // Library calendars often give only a title (Lake Oswego, West Linn, Wilsonville): recognise common kid programs by name.
  else if (has(text, /\b(family|kids|children|storytime|story time|all ages)\b|\blego\b|play ?group|playtime|story and play|music and movement|story ?walk|tales to tails|read(ing)? to (the )?(dogs?|cats?)|indoor playground|playground|open gym|\btots?\b|parent (and|&) (child|tot|me)|little ones|tree lighting|parade|movies? (in|at) the park|concerts? in the park|music on the green|santa|egg hunt|trick[ -]or[ -]treat|nature play|play ?park|dive-in movies?|kids night out|break camp|grandparents? and me/)) { min = 0; max = 12; }

  let kid = !adultOnly && !teenOnly && min != null;
  const interests = [];
  if (has(text, /\b(train|locomotive|railroad|rail|trolley|airplanes?|planes?|aviation|airport)\b/)) interests.push('trains');
  if (has(text, /\b(animal|zoo|goat|reptile|bird|farm|pets?)\b/)) interests.push('nature');
  if (has(text, /\b(science|stem|rocket|slime|experiment|chemistry|space|robot|maker)\b|dino|fossil|paleo/)) interests.push('science'); // dinosaurs count as science (owner, Nov 2026)
  if (has(text, /\b(nature|forest|trail|garden|wildlife|hike|walk|park)\b/) && !has(title, /volunteer|stewardship/)) interests.push('nature');
  if (has(text, /\b(art|craft|paint|draw|puppet|clay)\b/)) interests.push('art');
  if (has(text, /\b(music|song|sing|rhyme|dance|instrument)\b/)) interests.push('art');
  if (has(text, /\b(book|story|storytime|read|reading|library)\b/) && has(text, /story|book|read/)) interests.push('books');
  interests.splice(0, interests.length, ...new Set(interests));

  const categories = [];
  if (has(text, /story ?time|book babies|tiny tots|toddler time|baby time|lapsit|story ?walk|story and play/)) categories.push('storytime');
  if (has(text, /thanksgiving|christmas|holiday|santa|pumpkin|halloween|hanukkah|winter solstice|lantern|menorah|easter|valentine|zoolights|lights/)) categories.push('seasonal');
  if (min != null && max != null && min <= 1 && max <= 3 || has(text, /\b(babies|baby|toddlers?|tiny tots)\b/)) categories.push('babies_toddlers');
  if (has(text, /\b(outdoor|outside|park|trail|nature walk|farm|garden|walk)\b/)) categories.push('outdoors');
  if (has(text, /\b(class|workshop|lesson|club)\b/)) categories.push('class');
  if (has(text, /\b(show|concert|performance|theater|theatre)\b/)) categories.push('performance');

  const outdoor = categories.includes('outdoors');
  const free = ev.price_text ? /free/i.test(ev.price_text) : has(text, /\bfree\b|no cost/) ? true : null;
  const amount = ev.price_text?.match(/\$\s?(\d+(?:\.\d+)?)/)?.[1];
  const registration = has(text, /drop-?in|first come|no registration|registration (is )?not required|tickets? available at the door/) ? 'drop_in' : has(text, /register|registration|sign up|tickets? required|reserve/) ? 'required' : 'unknown';

  return normalizeTags({
    kid_relevant: kid,
    age_min: kid ? min : null,
    age_max: kid ? max : null,
    interests, categories,
    setting: outdoor ? 'outdoor' : has(text, /library|museum|indoor|studio|theater|theatre/) ? 'indoor' : 'unknown',
    registration,
    cost: { type: free === true ? 'free' : amount ? 'paid' : 'unknown', amount: amount ? +amount : null },
    confidence: kid ? (min === 0 && max === 12 ? (has(text, /all ages|family|whole family/) ? 0.65 : 0.5) : 0.7) : 0.8
  });
}
