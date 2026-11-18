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

/**
 * Interest tags that a title/description makes plain, added on top of whatever the classifier said (never removes).
 * Owner, Nov 2026: interests are tags and an event can have several (Tales to Tails = Storytime + Animals & Nature);
 * any kind of building (LEGO, maker, engineering) is Science / STEM.
 */
const TAG_RULES = [
  ['science', /\blegos?\b|\bbuild(s|ing|ers?)?\b|\bbuild it\b|engineer|maker ?(space|time|lab)|\bmakers?\b|\bstem\b|\bsteam\b|robot|coding|\bcode\b|circuit|k'?nex|magna-?tiles|\bblocks\b|science|experiment|dino(saur)?s?\b|fossil|3d print|3d (design|model)|tinkercad/i],
  ['nature', /\b(dogs?|cats?|kitt(y|ies|ens?)|pupp(y|ies)|animals?|pets?|bunn(y|ies)|rabbits?|goats?|horses?|ponies|pony|chickens?|birds?|reptiles?|zoo|farm|tails)\b|\bnature\b|wildlife/i],
  ['books', /story ?times?|\bstor(y|ies)\b|\btales\b|\bread(ing)?\b|\bbooks?\b|literacy|book club/i],
  ['art', /\bmusic(al)?\b|\bsing(ing|-?along)?\b|\bsongs?\b|\bdanc(e|ing)\b|\bcrafts?\b|\bart\b|\barts\b|paint|draw(ing)?\b|\bclay\b|puppet|concert|instrument|\bdesign|glowforge|laser[ -]?cut|cricut|sewing|knit(ting)?|crochet|embroider|stitch(ing)?|fiber arts?/i],
  // Play (owner, Nov 2026): playgrounds and open play, movement and yoga, games, family movies and parties.
  ['play', /playground|play ?(group|date|time|space|room)|pop[- ]?up (&|and) play|\bplay\b|open gym|bounce|tumbl|yoga|dance party|\bgames?\b|chess|lego free play|movies?\b|film|cinema|dive-in|family (night|fun|day)|party|carnival/i],
  ['trains', /\btrains?\b|railroad|locomotive|trolley|streetcar|airplanes?|\bplanes?\b|aviation|airport/i]
];
export function extraInterests(ev, interests = []) {
  // "song ngữ" is Vietnamese for bilingual, not a song
  const title = String(ev.title || '').replace(/song ng[ữu]/gi, 'bilingual');
  const text = `${title} ${String(ev.description || '').slice(0, 300).replace(/song ng[ữu]/gi, 'bilingual')}`;
  let out = [...interests];
  for (const [tag, re] of TAG_RULES) {
    // Science and trains from the title only (descriptions mention "build community", "train your staff"...)
    const hay = tag === 'science' || tag === 'trains' || tag === 'play' ? title : text; // broad words: titles only
    if (!out.includes(tag) && re.test(hay)) out.push(tag);
  }
  // Dinners and fundraisers stay untagged ("Other"), whatever the classifier said (owner, Nov 2026).
  if (/dinner|fundrais/i.test(title)) out = out.filter((t) => t !== 'play');
  // Storytimes mention songs and rhymes as a matter of course: that alone isn't Music & Art (owner, Nov 2026).
  // Keep Music & Art only when the title itself is about music or art ("Music & Movement Storytime", "Storytime & Craft").
  if (isStorytime(ev) && !TAG_RULES.find(([t]) => t === 'art')[1].test(title.replace(/story ?times?/ig, ''))) {
    out = out.filter((t) => t !== 'art');
    if (!out.includes('books')) out.unshift('books');
  }
  // ...and a storytime is Play only when its title says play ("Story and Play", "Storytime & Playgroup").
  if (isStorytime(ev) && !/\bplay/i.test(title)) {
    out = out.filter((t) => t !== 'play');
  }
  return out;
}

const STORYTIME = /story ?times?|lapsit|baby time|toddler time|book babies|babies and books|tiny tots|\bstory and (play|song|rhyme)s?\b|\bhora de cuentos\b|cuentos/i;
export const isStorytime = (ev) => (ev.categories || []).includes('storytime') || STORYTIME.test(String(ev.title || ''));
