// Offline demo feeds. These are SAMPLE listings written in the real feeds' formats (Communico iCal, BiblioCommons JSON,
// portland.gov HTML, Overpass JSON) so that offline runs exercise the real adapters end to end. Dates are relative to `today`.
import { addDays, dayOfWeek, pad } from './lib/time.js';

const BRANCH = {
  'Central Library': [45.5190, -122.6830], 'Hollywood Library': [45.5360, -122.6240], 'Midland Library': [45.5167135, -122.5385024],
  'Belmont Library': [45.5120, -122.6240], 'North Portland Library': [45.5630, -122.6760], 'St. Johns Library': [45.5880, -122.7540],
  'Rockwood Library': [45.5195226, -122.4789874], 'Hillsdale Library': [45.4890, -122.6960], 'Gregory Heights Library': [45.5514042, -122.5811858],
  'Albina Library': [45.5410, -122.6630], 'Woodstock Library': [45.4780, -122.6120], 'Sellwood-Moreland Library': [45.4690, -122.6490],
  'Kenton Library': [45.5860, -122.6890], 'Troutdale Library': [45.5370, -122.3900], 'Fairview-Columbia Library': [45.5380, -122.4260],
  'Capitol Hill Library': [45.4530, -122.7240]
};

// [weekday(0=Sun), "HH:MM", minutes, title, description, branch]
const MCL = [
  [2, '10:15', 30, 'Toddler Storytime', 'Toddlers (with a favorite adult) enjoy interactive stories, songs and games. Free. First come, first served.', 'Hollywood Library'],
  [4, '10:15', 30, 'Toddler Storytime', 'Toddlers (with a favorite adult) enjoy interactive stories, songs and games. Free. First come, first served.', 'Midland Library'],
  [3, '11:00', 30, 'Toddler Storytime', 'Toddlers (with a favorite adult) enjoy interactive stories, songs and games. Free. First come, first served.', 'Belmont Library'],
  [5, '10:30', 30, 'Toddler Storytime', 'Toddlers (with a favorite adult) enjoy interactive stories, songs and games. Free.', 'North Portland Library'],
  [2, '11:00', 30, 'Toddler Storytime', 'Toddlers (with a favorite adult) enjoy interactive stories, songs and games. Free.', 'St. Johns Library'],
  [1, '10:15', 30, 'Book Babies', 'Babies from birth to 12 months (with a favorite adult) enjoy songs, action rhymes and playtime. Free.', 'Central Library'],
  [3, '10:15', 30, 'Book Babies', 'Babies from birth to 12 months (with a favorite adult) enjoy songs, action rhymes and playtime. Free.', 'Rockwood Library'],
  [4, '11:00', 30, 'Book Babies', 'Babies from birth to 12 months (with a favorite adult) enjoy songs, action rhymes and playtime. Free.', 'Hillsdale Library'],
  [4, '10:15', 30, 'Tiny Tots', 'One-year-olds (with a favorite adult) enjoy songs, movement, rhymes, books and playtime. Free.', 'Gregory Heights Library'],
  [2, '11:15', 30, 'Tiny Tots', 'One-year-olds (with a favorite adult) enjoy songs, movement, rhymes, books and playtime. Free.', 'Albina Library'],
  [3, '10:30', 30, 'Preschool Storytime', 'Stories, songs and a craft for ages 3 to 5. Free. Drop-in.', 'Woodstock Library'],
  [4, '10:30', 30, 'Preschool Storytime', 'Stories, songs and a craft for ages 3 to 5. Free. Drop-in.', 'Sellwood-Moreland Library'],
  [6, '11:00', 45, 'Dino Dig Saturday', 'Dig for fossils in the sand table, meet puppet dinosaurs and hear dinosaur stories. Ages 3 to 8. Free, drop-in.', 'Central Library'],
  [6, '13:00', 60, 'Train Table Play', 'Build a track and run the trains. Ages 2 to 6. Free, drop-in.', 'Troutdale Library'],
  [6, '14:00', 60, 'Kids Maker Hour: Paper Rockets', 'Build and launch a paper rocket. Ages 6 to 10. Free. Registration required.', 'Fairview-Columbia Library'],
  [2, '15:30', 60, 'Thanksgiving Crafts Drop-in', 'Make a paper-bag turkey and a thankful tree. Ages 4 to 10. Free, drop-in.', 'Capitol Hill Library'],
  [3, '14:00', 90, 'Microsoft Word with Goodwill Industries', 'Adult computer class. Registration required.', 'Rockwood Library'],
  [3, '16:00', 60, 'Teen Anime Club', 'Teens only. Snacks and screenings.', 'Hollywood Library'],
  [6, '10:00', 60, 'Kenton Kids Art Studio', 'Paint and draw with local artist volunteers. Ages 5 to 10. Free.', 'Kenton Library']
];

const WCCLS = [
  [3, '10:30', 30, 'Family Storytime', 'Stories, songs and rhymes for the whole family. All ages. No registration needed.', 'Beaverton City Library', 45.4880, -122.8020],
  [2, '09:45', 30, 'Baby Storytime', 'Songs and rhymes for babies and their caregivers. No registration needed.', 'Hillsboro Brookwood Library', 45.5380, -122.9500],
  [4, '10:00', 30, 'Toddler Time', 'Books, songs and play for toddlers. Drop-in.', 'Tigard Public Library', 45.4290, -122.7690],
  [6, '14:00', 60, 'Lego Club', 'Build with bricks. Ages 5 to 12. Drop-in, free.', 'Tualatin Public Library', 45.3830, -122.7630],
  [6, '11:00', 60, 'Reptiles at the Library', 'A live reptile show with a wildlife educator. All ages. Free. Tickets available at the door.', 'Hillsboro Shute Park Library', 45.5300, -122.9680],
  [6, '10:30', 60, 'Science Saturday: Slime', 'Make slime and learn why it stretches. Ages 6 to 10. Registration required.', 'Cedar Mill Library', 45.5260, -122.8140],
  [5, '10:30', 45, 'Preschool Story Walk', 'Follow a story along the trail outside the library. Ages 3 to 5. Free. Outdoors.', 'Sherwood Public Library', 45.3570, -122.8390],
  [0, '13:00', 60, 'Family Music Sing-Along', 'Sing and play simple instruments. All ages. Free.', 'Beaverton Murray Scholls Library', 45.4600, -122.8300]
];

const MANUAL = [
  { slug: 'oaks-preschool-skate', dow: 2, time: '10:00', mins: 90, title: 'Preschool Skate', description: 'Roller skating for preschoolers with a grown-up. Ages 3 to 6. $8. Drop-in.', venue_name: 'Oaks Park', lat: 45.4737, lon: -122.6667, price_text: '$8', url: 'https://oakspark.com' },
  { slug: 'tree-farm-day', dow: 0, time: '12:30', mins: 180, title: 'Christmas Tree Farm Day', description: 'Pick a tree, drink cocoa and meet the farm animals. All ages. $5 entry.', venue_name: 'Sauvie Island tree farm', lat: 45.6700, lon: -122.8000, price_text: '$5', url: 'https://example.org/tree-farm' },
  { slug: 'family-trail-walk', dow: 0, time: '09:00', mins: 90, title: 'Family Trail Walk', description: 'A guided nature walk for families on easy trails. All ages. Free. Outdoors.', venue_name: 'Forest Park', lat: 45.5340, lon: -122.7140, price_text: 'Free', url: 'https://example.org/trail-walk' },
  { slug: 'rail-holiday', dow: 6, time: '11:00', mins: 120, title: 'Holiday Train Rides', description: 'Seasonal train rides for the whole family. Ages 2 and up. Tickets required.', venue_name: 'Rail museum', lat: 45.5057, lon: -122.6663, price_text: '$12', url: 'https://example.org/rail' }
];

// Card markup copied from the live multcolib.org/events-classes list (Nov 2026).
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clock = (min) => { const h = Math.floor(min / 60), m = min % 60; return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };
const mclCard = (e) => {
  const [y, mo, d] = e.date.split('-').map(Number);
  const href = `/events-classes/${e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${e.id}`;
  return `<div><div class="field-content test-html"><div class="event row m-0 d-flex justify-content-end">
<div class="d-none d-md-flex col-md-2"><div class=" event__date-lg">${MON[mo - 1]} ${d}</div></div>
<div class="col-12 col-md-7 event__text">
<h2 class="event__title"><a href="${href}" hreflang="en">${e.title}</a></h2>
<div class="event__details row">
<div class="event__date col-12 col-sm-auto"><i class="far fa-calendar"></i>${DOW[dayOfWeek(e.date)]} ${MON[mo - 1]} ${d} ${y} </div>
<div class="event__time col-12 col-sm-auto"><i class="far fa-clock"></i>${clock(e.startMin)} - ${clock(e.startMin + e.mins)}</div>
<div class="event__location col-12 col-sm-auto"><i class="fas fa-map-marker-alt"></i>${e.branch}</div>
</div>
<div class="event__summary"><p>${e.description}</p>
</div>
</div>
<div class="col-md-3 mt-0 mt-md-2 mb-md-2"><div class="event__registration">
</div></div>
</div></div></div>`;
};
const mclBranchMap = () => '<script>{"features":[' + Object.entries(BRANCH).map(([name, [lat, lon]], i) =>
  `{"type":"point","lat":${lat},"lon":${lon},"entity_id":"${i}","weight":0,"popup":{"value":"\\u003Ca href=\\u0022\\/hours-and-locations\\/x\\u0022 hreflang=\\u0022en\\u0022\\u003E${name}\\u003C\\/a\\u003E"}}`).join(',') + ']}</script>';


export function buildOffline(today) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const mclEvents = [];
  let n = 17000000;
  for (const date of days) for (const [dow, time, mins, title, description, branch] of MCL) {
    if (dayOfWeek(date) !== dow) continue;
    const [h, m] = time.split(':').map(Number);
    mclEvents.push({ id: String(n), date, startMin: h * 60 + m, mins, title, description, branch });
    n += 7;
  }
  const bibEvents = {};
  for (const date of days) for (const [dow, time, mins, title, description, branch, lat, lon] of WCCLS) {
    if (dayOfWeek(date) !== dow) continue;
    const id = `wc${date.replace(/-/g, '')}${time.replace(':', '')}${title.length}`;
    const [h, m] = time.split(':').map(Number); const t = h * 60 + m + mins;
    bibEvents[id] = { id, definition: { id, title, description, start: `${date}T${time}:00`, end: `${date}T${pad(Math.floor(t / 60))}:${pad(t % 60)}:00`, branchLocationId: branch, isRecurring: true } };
  }
  const bibLocations = {};
  for (const [, , , , , branch, lat, lon] of WCCLS) bibLocations[branch] = { name: branch, latitude: lat, longitude: lon };
  const bibJson = JSON.stringify({ entities: { events: bibEvents, locations: bibLocations } });

  const parkRows = [
    [addDays(today, 7), '9:00 am', '11:00 am', 'Spring Garden Park volunteer event', 'Volunteer event'],
    [addDays(today, 9), '9:00 am', '12:00 pm', 'Tideman Johnson Stewardship Event', 'Volunteer event'],
    [addDays(today, 10), '5:00 pm', '7:00 pm', 'Portland Parks Board Meeting', 'Public meeting'],
    [addDays(today, 5), '4:00 pm', '5:30 pm', 'Winter Lantern Walk at Mt. Tabor', 'Community event', 'Bring the whole family and a lantern for an evening walk around the park. Free.']
  ];
  const parksHtml = '<div class="view-content">' + parkRows.map(([d, a, b, title, label, blurb]) => {
    const [y, m, dd] = d.split('-');
    return `<article><h3><a href="/parks/events/${y}/${+m}/${+dd}/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}">${title}</a></h3><div>${a} to ${b}</div><div>Label: ${label}</div>${blurb ? `<p>${blurb}</p>` : ''}</article>`;
  }).join('\n') + '</div>';

  const overpass = JSON.stringify({ elements: [
    { type: 'node', id: 1001, lat: 45.5560, lon: -122.6760, tags: { name: 'Dawson Park Playground', leisure: 'playground' } },
    { type: 'node', id: 1002, lat: 45.4790, lon: -122.7210, tags: { name: 'Gabriel Park Playground', leisure: 'playground' } },
    { type: 'way', id: 1003, center: { lat: 45.5150, lon: -122.5950 }, tags: { name: 'Mt. Tabor Park', leisure: 'nature_reserve' } },
    { type: 'node', id: 1004, lat: 45.5880, lon: -122.7480, tags: { name: 'St Johns Pool', leisure: 'water_park' } },
    { type: 'node', id: 1005, lat: 45.4230, lon: -122.6700, tags: { name: 'Westlake Park Playground', leisure: 'playground' } },
    { type: 'node', id: 1006, lat: 45.5230, lon: -122.9900, tags: { name: 'Shute Park Playground', leisure: 'playground' } }
  ] });

  const ok = (text) => ({ ok: true, status: 200, text: async () => text });
  const reg = (q) => `<a href="https://anc.apm.activecommunities.com/portlandparks/activity/search?keyword=${q}">Check availability</a>`;
  const tbl = (rows) => `<table><thead><tr><th>Class</th><th>Description</th><th>Location</th><th>Register</th></tr></thead><tbody>${rows.map(([n, d, l]) => `<tr><td>${n}</td><td>${d}</td><td>${l}</td><td>${reg(encodeURIComponent(n))}</td></tr>`).join('')}</tbody></table>`;
  const sportsHtml = `<h2>East and Southeast Portland</h2><h3>Child with Adult</h3>${tbl([['Soccer', 'Develop skills together that promote balance and agility.', 'East Portland and Mt. Scott Community Center'], ['Gymnastics', 'Tumble and climb with a grown-up.', 'Mt. Scott Community Center']])}<h3>Preschool</h3>${tbl([['Preschool Baseball', 'A recreational introduction to throwing, catching and hitting.', 'East Portland Community Center']])}<h3>Youth</h3>${tbl([['Tae Kwon Do', 'Martial arts for school-age kids.', 'Southwest Community Center']])}<h3>Adult</h3>${tbl([['Pickleball', 'Adult open play.', 'Mt. Scott Community Center']])}<h2>North and Northeast Portland</h2><h3>Youth</h3>${tbl([['Basketball', 'Skills and scrimmages.', 'Matt Dishman Community Center and Peninsula Park Community Center']])}<h2>Southwest Portland</h2><h3>Intergenerational</h3>${tbl([['Walking Club', 'All ages.', 'Hillsdale Community Center']])}`;
  const fetchImpl = async (url) => {
    if (url.startsWith('https://multcolib.org/hours-and-locations')) return ok(mclBranchMap());
    if (url.startsWith('https://multcolib.org/events-classes')) {
      const q = new URL(url).searchParams;
      const page = +(q.get('page') || 0);
      return ok(q.get('field_event_ages_target_id') === '665' ? mclEvents.slice(page * 20, page * 20 + 20).map(mclCard).join('\n') : '<html></html>');
    }
    if (url.includes('gateway.bibliocommons.com')) return ok(bibJson);
    if (url.startsWith('https://www.portland.gov/parks/events')) return ok(url.endsWith('page=0') ? parksHtml : '<html></html>');
    if (url.endsWith('/recreation/activities/sports')) return ok(sportsHtml);
    if (url.includes('overpass')) return ok(overpass);
    return { ok: false, status: 404, text: async () => '' };
  };
  const manual = MANUAL.flatMap((e) => days.filter((d) => dayOfWeek(d) === e.dow).slice(0, 2).map((date) => ({
    source_event_id: `${e.slug}-${date}`, title: e.title, description: e.description,
    start: `${date}T${e.time}:00-08:00`, end: null, venue_name: e.venue_name, lat: e.lat, lon: e.lon, price_text: e.price_text, url: e.url
  })));
  return { fetchImpl, manual, counts: { mcl: mclEvents.length, wccls: Object.keys(bibEvents).length, manual: manual.length } };
}
