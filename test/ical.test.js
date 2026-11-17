import test from 'node:test';
import assert from 'node:assert/strict';
import { parseICal, parseICalDate } from '../src/lib/ical.js';

const SAMPLE = [
  'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:c847',
  'DTSTART;TZID=America/Los_Angeles:20261203T103000', 'DTEND;TZID=America/Los_Angeles:20261203T120000',
  'SUMMARY:Early Educator Series: Music and Movement!',
  'LOCATION:Midland Library\\nMidland Library',
  'GEO:45.5167135;-122.5385024',
  'DESCRIPTION:Plain text version\\nhttps://multcolib.libnet.info/event/12854476',
  'X-ALT-DESC;FMTTYPE=text/html:<p>Join us as we sing\\, dance\\, and learn together!</p>\\n<p>Second&nbsp;paragraph</p>',
  ' with a folded continuation line',
  'END:VEVENT', 'END:VCALENDAR'
].join('\r\n');

test('parses Communico-style event: tz, geo, location, html description, folded lines', () => {
  const [e] = parseICal(SAMPLE);
  assert.equal(e.title, 'Early Educator Series: Music and Movement!');
  assert.equal(e.start, '2026-12-03T10:30:00-08:00');
  assert.equal(e.end, '2026-12-03T12:00:00-08:00');
  assert.equal(e.lat, 45.5167135);
  assert.equal(e.location, 'Midland Library');
  assert.match(e.description, /sing, dance, and learn together!/);
  assert.match(e.description, /Second paragraph/);
  assert.equal(e.url, 'https://multcolib.libnet.info/event/12854476');
});

test('DST: summer events get -07:00', () => {
  assert.equal(parseICalDate('20260818T180000', { TZID: 'America/Los_Angeles' }).iso, '2026-08-18T18:00:00-07:00');
});

test('UTC timestamps convert to Portland wall time', () => {
  assert.equal(parseICalDate('20261203T183000Z').iso, '2026-12-03T10:30:00-08:00');
});

test('all-day dates are flagged', () => {
  assert.equal(parseICalDate('20261203').allDay, true);
});
