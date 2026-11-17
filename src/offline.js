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
  // ---- South Metro and Vancouver (each in its real feed format; demo titles) ----
  const d1 = days.find((d) => dayOfWeek(d) === 3) || days[1]; // a Wednesday
  const d2 = days.find((d) => dayOfWeek(d) === 6) || days[2]; // a Saturday
  const fmtLong = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const stampZ = (date, hhmm) => `${date.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
  const fvrlJson = JSON.stringify({ events: { pagination: { page: 1, pages: 1 } }, entities: {
    events: {
      fv1: { id: 'fv1', definition: { id: 'fv1', title: 'Toddler Storytime', description: 'Stories, songs and rhymes for toddlers 18-36 months with a grown-up. Free.', start: `${d1}T10:30`, end: `${d1}T11:00`, branchLocationId: 'FV-VCL', audienceIds: ['a-tod'], typeIds: ['t-story'] } },
      fv2: { id: 'fv2', definition: { id: 'fv2', title: 'Family Lego Build', description: 'Build together. Ages 5-10 with family. Drop in.', start: `${d2}T14:00`, end: `${d2}T15:30`, branchLocationId: 'FV-CP', audienceIds: ['a-kids'], typeIds: [] } },
      fv3: { id: 'fv3', definition: { id: 'fv3', title: 'Gorge Storytime', description: 'Storytime for little ones.', start: `${d1}T11:00`, end: `${d1}T11:30`, branchLocationId: 'FV-STV', audienceIds: ['a-tod'], typeIds: ['t-story'] } }
    },
    locations: {
      'FV-VCL': { name: 'Vancouver Community Library', mapLocation: { centrePoint: { lat: 45.6285, lng: -122.6688 } } },
      'FV-CP': { name: 'Cascade Park Community Library', mapLocation: { centrePoint: { lat: 45.6251, lng: -122.5355 } } },
      'FV-STV': { name: 'Stevenson Community Library', mapLocation: { centrePoint: { lat: 45.6954, lng: -121.8816 } } }
    },
    eventAudiences: { 'a-tod': { name: 'Toddlers' }, 'a-kids': { name: 'Kids' } },
    eventTypes: { 't-story': { name: 'Storytime & Early Literacy ' } }
  } });
  const icsOf = (rows) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...rows.flatMap(([uid, date, t, mins, title, loc, cats]) => ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART;TZID=America/Los_Angeles:${stampZ(date, t)}`, `DTEND;TZID=America/Los_Angeles:${stampZ(date, `${String(+t.slice(0, 2) + Math.floor(mins / 60)).padStart(2, '0')}:${t.slice(3)}`)}`, `SUMMARY:${title}`, `LOCATION:${loc}`, ...(cats ? [`CATEGORIES:${cats}`] : []), 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
  const ocIcs = icsOf([['oc1', d1, '10:30', 60, 'Preschool Storytime', 'Community Room', 'Storytime'], ['oc2', d2, '00:00', 60, "Children's Creative Kit", 'At Home', 'Activity Kits']]);
  const wvIcs = icsOf([['wv1', d2, '11:00', 60, 'Family Storytime', ' - Wilsonville Public Library 8200 SW Wilsonville Road Wilsonville', null]]);
  const drupalMonth = (rows) => rows.map(([date, t, path, title]) => `<div class="calendar-1-field_date-0.0 contents"><span class="date-display-single" property="dc:date" datatype="xsd:dateTime" content="${date}T${t}:00-08:00">${t}</span> <a href="${path}?date=0">${title}</a></div>`).join('\n');
  const loHtml = drupalMonth([[d1, '10:15', '/library/baby-storytime', 'Baby Storytime'], [d2, '13:00', '/library/lego-club', 'Lego Club']]);
  const wlHtml = drupalMonth([[d1, '10:45', '/library/family-storytime-10', 'Family Storytime']]);
  const ccHtml = [[d1, '18:00', 'baby-storytime-oak-lodge-public-library', 'Baby Storytime – Oak Lodge Public Library', 'Oak Lodge Library, 16201 SE McLoughlin Blvd'], [d2, '19:00', 'read-to-the-dog-gladstone-library', 'Read to the Dog – Gladstone Library', 'Gladstone Library, 525 Portland Avenue Gladstone, OR 97027']]
    .map(([date, utc, slug, title, addr]) => `<div class="views-row"><a href="/event/${date}/${slug}" hreflang="en">${title}</a><time datetime="${date}T${utc}:00Z">x</time><time datetime="${date}T${utc.replace(/^(\d\d)/, (h) => String(+h + 1).padStart(2, '0'))}:00Z">x</time><div class="views-field views-field-field-ccts-map-link"><div class="field-content"><a href="https://maps.example/x">${addr}</a></div></div></div>`).join('');

  const fetchImpl = async (url) => {
    if (url.includes('/libraries/fvrlibraries/')) return ok(fvrlJson);
    if (url.includes('orcity-library.libcal.com')) return ok(ocIcs);
    if (url.includes('wilsonvillelibrary.org')) return ok(url.includes('catID=29') ? wvIcs : url.includes('catID=25') ? icsOf([['wp1', d2, '09:30', 60, 'Parent & Tot Open Gym', ' - Wilsonville Community Center 7965 SW Wilsonville Road Wilsonville', null]]) : icsOf([]));
    if (url.includes('ci.oswego.or.us/calendar/month/')) return ok(url.endsWith('=13') ? loHtml : url.endsWith('=19') ? drupalMonth([[d1, '09:00', '/parksrec/indoor-playground-lorac', 'Indoor Playground at LORAC']]) : '');
    if (url.includes('westlinnoregon.gov/library/calendar/')) return ok(wlHtml);
    if (url.includes('westlinnoregon.gov/parksrec/calendar/')) return ok(drupalMonth([[d2, '10:00', '/parksrec/family-nature-walk', 'Family Nature Walk at Mary S. Young Park']]));
    if (url.includes('clackamas.us/events')) return ok(ccHtml);
    if (url.includes('/wp-json/tribe/events/v1/events')) return ok(JSON.stringify({ total_pages: 1, events: url.includes('sherwood')
      ? [{ id: 501, title: 'Movies in the Park: Paddington', description: '<p>Free family movie night on the lawn. Bring a blanket.</p>', start_date: `${d2} 18:00:00`, end_date: `${d2} 20:00:00`, url: 'https://www.sherwoodoregon.gov/event/movie', categories: [{ name: 'Movies in the Parks' }], venue: { venue: 'Stella Olsen Park', geo_lat: '45.3535', geo_lng: '-122.8366' } },
         { id: 502, title: 'City Council Meeting', start_date: `${d1} 17:30:00`, categories: [{ name: 'City Council' }], venue: [] }]
      : [{ id: 601, title: 'Tree Lighting Ceremony', start_date: `${d2} 16:00:00`, end_date: `${d2} 18:00:00`, url: 'https://www.happyvalleyor.gov/event/tree', description: '<p>Bring the family for carols, cocoa and a visit from Santa. Free.</p>', categories: [{ name: 'Community Event' }], venue: { venue: 'Happy Valley City Hall', geo_lat: '45.4293831', geo_lng: '-122.4975936' } }] }));
    if (url.includes('happyvalleyor.libcal.com')) return ok(icsOf([['hv1', d1, '10:30', 30, 'Toddler Storytime', 'Community Room A', 'Drop In, Storytime'], ['hv2', d2, '00:00', 60, 'CLOSED', 'Happy Valley Library', null]]));
    if (url.includes('milwaukieoregon.gov/_assets_/plugins/revizeCalendar')) return ok(JSON.stringify([
      { title: 'Drop-In Playgroup', primary_calendar_name: 'Library', start: `${d1}T10:30:00`, end: `${d1}T11:30:00`, location: 'Ledding Library, 10660 SE 21st Ave, Milwaukie', rid: '901', desc: encodeURIComponent('<p>Play time for little ones and their grown-ups.</p>'), rrule: `DTSTART:${d1.replace(/-/g, '')}T103000\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][dayOfWeek(d1)]};COUNT=2` },
      { title: 'City Council', primary_calendar_name: 'City Meetings', start: `${d1}T18:00:00`, rid: '902' },
      { title: 'Umbrella Parade & Tree Lighting', primary_calendar_name: 'Community Events', start: `${d2}T16:00:00`, location: 'Main Street, Milwaukie', rid: '903', desc: encodeURIComponent('<p>Free family fun: kids parade with umbrellas, then the tree lighting.</p>') }
    ]));
    if (url.includes('tualatinhillsparks.org/common/modules/iCalendar')) return ok(url.includes('catID=35')
      ? icsOf([['th1', d2, '10:00', 120, 'Indoor Nature Play Park', 'Tualatin Hills Nature Park - Tualatin Hills Nature Center  15655 SW Millikan Way Beaverton OR 97003', null]])
      : icsOf([['th2', d1, '18:00', 120, 'Dive-in Movie @ Conestoga Pool', 'Conestoga Recreation & Aquatic Center - 9985 SW 125th Avenue  Beaverton OR 97008', null], ['th3', d1, '11:00', 60, 'Newcomers Welcome - Elsie Stuhr Center', ' - 5550 SW Hall Blvd  Beaverton OR 97005', null]]));
    if (url.includes('tualatinoregon.gov/wp-json/wp/v2/events')) return ok(JSON.stringify([{ id: 9001 }]));
    if (url.includes('tualatinoregon.gov/wp-json/juicebox/v1/events/')) return ok(JSON.stringify({ id: 9001, title: 'Kids Night Out (Parents Night Off)', url: 'https://parks.tualatinoregon.gov/events/kids-night-out/', location: 'Van Raden Community Center', all_day: false, event_category: [{ name: 'Parks &amp; Recreation' }], event_audience: [{ name: 'Kids' }], start_date: { date: { mysql: `${d1} 17:30:00` } }, end_date: { date: { mysql: `${d1} 21:00:00` } } }));
    if (url.startsWith('https://ncprd.org/events')) {
      const nd = ['Indoor Playground', 'indoor-playground-thursdays', 'events/indoor-playground-thursdays', 'Playtime for young children and their caregivers.', '3811 S.E. Concord Rd. in Oak Grove', `${d1}T17:00:00.000Z`, `${d1}T18:30:00.000Z`];
      return ok(`<script type="application/json" id="__NUXT_DATA__">${JSON.stringify([{ title: 1, slug: 2, fullSlug: 3, excerpt: 4, address: 5, startTime: 6, endTime: 7, occurrences: 8 }, ...nd, { data: 9 }, []])}</script>`);
    }
    if (url.includes('greshamoregon.gov/webservices/events')) return ok(JSON.stringify({ page: 1, totalPages: 1, events: url.includes('category=49')
      ? [{ start: d2, end: d2, canceled: false, title: 'Reindeer in Rockwood', url: '/events/2026/community-events/reindeer-in-rockwood/', time: '4:00 pm - 7:00 pm', location: 'Rockwood Market Hall, 458 SE 185th Avenue' }]
      : url.includes('category=56') ? [{ start: d2, end: d2, canceled: false, title: 'Late-Night Basketball', url: '/events/2026/youth-events/late-night-basketball/', time: '6:00 pm - 10:00 pm', location: 'Reynolds Middle School, 1200 NE 201st Avenue' }] : [] }));
    if (url.startsWith('https://www.cityofvancouver.us/government/calendar')) return ok(`<div id="tab2"><a href="#section1"><div class="h6">Parks, Recreation and Cultural Services</div></a>
      <div id="section1" class="expanding-containerevt"><h3>Pizza with Santa</h3><h5 class="m-0"> ${fmtLong(d2)} <br><span> 11:00 am - 1:00 pm</span></h5><span class="description">Pizza, crafts and photos with Santa for the whole family.</span><h4> Firstenburg Community Center </br> 700 NE 136th Ave </br> Vancouver , WA 98684 </h4><a class="link" href="https://www.cityofvancouver.us/events/pizza-with-santa/">Learn More</a></div></div>`);
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
