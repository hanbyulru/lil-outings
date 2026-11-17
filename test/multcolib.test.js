import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMultcolibList, parseMultcolibBranches } from '../src/adapters/multcolib.js';

const src = { id: 'mcl', name: 'Multnomah County Library', config: {} };

// Trimmed from the live https://multcolib.org/events-classes list (Nov 2026).
const LIST = `<div class="view-content"><div><div class="field-content test-html"><div class="event row m-0 d-flex justify-content-end">
  <div class="d-none d-md-flex col-md-2">
<div class=" event__date-lg">
    Nov 16
  </div>
</div>
  <div class="col-12 col-md-7 event__text">
    <h2 class="event__title"><a href="/events-classes/toddler-storytime-1185" hreflang="en">Toddler Storytime</a></h2>
               <div class="event__details row">
      <div class="event__date col-12 col-sm-auto">
        <i class="far fa-calendar"></i>Mon Nov 16 2026 
      </div>
      <div class="event__time col-12 col-sm-auto">
        <i class="far fa-clock"></i>10:15 AM - 11:00 AM
       </div>
       <div class="event__location col-12 col-sm-auto">  
        <i class="fas fa-map-marker-alt"></i>Belmont Library
        </div>
    </div>
    <div class="event__summary"><p>Toddlers (with a favorite adult) enjoy interactive stories, songs and games that encourage their emerging language skills.&nbsp;Attendance is limited.</p>
<p>Multnomah County Library storytimes are supported by gifts made to <a href="http://www.libraryfoundation.org/">The&nbsp;Library Foundation</a>.</p>
</div>
  </div>
  <div class="col-md-3 mt-0 mt-md-2 mb-md-2">
    <div class="mb-4">
      <a href="/events-classes/toddler-storytime-1185" hreflang="en"><img loading="lazy" src="/sites/default/files/styles/medium/public/2026-07/generic_Storytime.png?itok=R79WcRIZ" width="220" height="147" alt="" />
</a>
    </div>
    <div class="event__registration">
           </div>
  </div>
</div></div></div>
<div><div class="field-content test-html"><div class="event row m-0 d-flex justify-content-end">
  <div class="col-12 col-md-7 event__text">
    <h2 class="event__title"><a href="/events-classes/family-storytime-1191" hreflang="en">Family Storytime</a></h2>
    <div class="event__modified">This event has been canceled</div>
               <div class="event__details row">
      <div class="event__date col-12 col-sm-auto">
        <i class="far fa-calendar"></i>Mon Nov 16 2026 
      </div>
      <div class="event__time col-12 col-sm-auto">
        <i class="far fa-clock"></i>10:15 AM - 11:00 AM
       </div>
       <div class="event__location col-12 col-sm-auto">  
        <i class="fas fa-map-marker-alt"></i>Albina Library
        </div>
    </div>
    <div class="event__summary"><p>Children from birth to age 6 (with a favorite adult) enjoy books, songs, rhymes and movement.</p>
</div>
  </div>
  <div class="col-md-3 mt-0 mt-md-2 mb-md-2">
    <div class="event__registration">
           </div>
  </div>
</div></div></div>
<div><div class="field-content test-html"><div class="event row m-0 d-flex justify-content-end">
  <div class="col-12 col-md-7 event__text">
    <h2 class="event__title"><a href="/events-classes/east-county-library-tour-5" hreflang="en">East County Library Tour  </a></h2>
               <div class="event__details row">
      <div class="event__date col-12 col-sm-auto">
        <i class="far fa-calendar"></i>Tue Jul 7 2026 
      </div>
      <div class="event__time col-12 col-sm-auto">
        <i class="far fa-clock"></i>12:00 PM - 12:45 PM
       </div>
       <div class="event__location col-12 col-sm-auto">  
        <i class="fas fa-map-marker-alt"></i>East County Library
        </div>
    </div>
    <div class="event__summary"><p>Join us for a 45 minute walking tour through the building. Registration required.</p>
</div>
  </div>
  <div class="col-md-3 mt-0 mt-md-2 mb-md-2">
    <div class="mb-4">
    </div>
    <div class="event__registration">
                <div class="btn" role="button">
                       <div class="event__registration-btn">
            <a href="https://events.multcolib.org/event/17639515&amp;registration=true">Register</a>
          </div>
                 </div>
           </div>
  </div>
</div></div></div></div>`;

test('multcolib list: title, date, time, branch, summary, image, registration, cancellation', () => {
  const ev = parseMultcolibList(LIST, src, 'Kids and Family');
  assert.equal(ev.length, 3);
  const [a, b, c] = ev;
  assert.equal(a.title, 'Toddler Storytime');
  assert.equal(a.url, 'https://multcolib.org/events-classes/toddler-storytime-1185');
  assert.equal(a.start, '2026-11-16T10:15:00-08:00');
  assert.equal(a.end, '2026-11-16T11:00:00-08:00');
  assert.equal(a.venue_name, 'Belmont Library');
  assert.match(a.description, /^Toddlers \(with a favorite adult\)/);
  assert.match(a.description, /The Library Foundation/);
  assert.equal(a.image, 'https://multcolib.org/sites/default/files/styles/medium/public/2026-07/generic_Storytime.png?itok=R79WcRIZ');
  assert.deepEqual(a.raw_audience, ['Kids and Family']);
  assert.deepEqual(a.raw_categories, []);
  assert.equal(a.cancelled, false);
  assert.equal(b.cancelled, true);
  assert.equal(c.title, 'East County Library Tour');
  assert.equal(c.start, '2026-07-07T12:00:00-07:00'); // PDT
  assert.equal(c.registration_url, 'https://events.multcolib.org/event/17639515&registration=true');
  assert.deepEqual(c.raw_categories, ['Registration required']);
});

test('multcolib list: empty page yields nothing', () => {
  assert.deepEqual(parseMultcolibList('<div class="view-empty">No events</div>', src), []);
});

test('multcolib branches: reads Leaflet features from /hours-and-locations', () => {
  const html = `<script type="application/json">{"leaflet":{"x":{"features":[{"type":"point","lat":45.541172079357999,"lon":-122.66314744959,"entity_id":"1238","weight":0,"popup":{"value":"\\u003Ca href=\\u0022\\/hours-and-locations\\/albina-library\\u0022 hreflang=\\u0022en\\u0022\\u003EAlbina Library\\u003C\\/a\\u003E\\n\\u003Cdiv class=\\u0022popup-note\\u0022\\u003E\\u003C\\/div\\u003E"}},{"type":"point","lat":45.5052,"lon":-122.43615,"entity_id":"9","weight":0,"popup":{"value":"\\u003Ca href=\\u0022\\/x\\u0022\\u003EEast County Library\\u003C\\/a\\u003E"}}]}}}</script>`;
  assert.deepEqual(parseMultcolibBranches(html), {
    'Albina Library': { lat: 45.541172, lon: -122.663147 },
    'East County Library': { lat: 45.5052, lon: -122.43615 }
  });
});
