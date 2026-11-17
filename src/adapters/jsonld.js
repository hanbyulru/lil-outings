import { politeFetch } from '../lib/http.js';
import { jsonLdBlocks, htmlToText } from '../lib/html.js';
import { withOffset } from '../lib/time.js';

function asArray(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }

function flatten(node, acc = []) {
  for (const n of asArray(node)) {
    if (!n || typeof n !== 'object') continue;
    if (n['@graph']) flatten(n['@graph'], acc);
    const types = asArray(n['@type']);
    if (types.some((t) => /Event$/.test(String(t)))) acc.push(n);
    if (n.itemListElement) flatten(asArray(n.itemListElement).map((e) => e.item || e), acc);
  }
  return acc;
}

function isoWithOffset(s) {
  if (!s) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return withOffset(s + 'T00:00:00');
  return withOffset(s.replace(/\.\d+$/, ''));
}

/** schema.org Event JSON-LD -> raw events. Works on any page that embeds it (many venue sites, Eventbrite listings, etc). */
export function parseJsonLdEvents(html, source, pageUrl = null) {
  return flatten(jsonLdBlocks(html)).map((e) => {
    const loc = asArray(e.location)[0] || {};
    const geo = loc.geo || {};
    const offers = asArray(e.offers)[0] || {};
    const addr = loc.address;
    const free = offers.price === 0 || offers.price === '0' || /free/i.test(String(offers.price ?? ''));
    return {
      source_id: source.id,
      source_event_id: e.url || e['@id'] || `${e.name}|${e.startDate}`,
      title: htmlToText(String(e.name || '')),
      description: htmlToText(String(e.description || '')),
      start: isoWithOffset(e.startDate),
      end: isoWithOffset(e.endDate),
      all_day: !!e.startDate && !String(e.startDate).includes('T'),
      url: e.url || pageUrl,
      venue_name: loc.name || null,
      address: typeof addr === 'string' ? addr : addr ? [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean).join(', ') : null,
      lat: geo.latitude != null ? Number(geo.latitude) : null,
      lon: geo.longitude != null ? Number(geo.longitude) : null,
      raw_categories: asArray(e.keywords).flatMap((k) => String(k).split(',')).map((s) => s.trim()).filter(Boolean),
      raw_audience: asArray(e.audience).map((a) => a.audienceType || a.name || String(a)),
      price_text: free ? 'Free' : offers.price != null ? `${offers.priceCurrency === 'USD' || !offers.priceCurrency ? '$' : ''}${offers.price}` : null,
      image: asArray(e.image)[0]?.url || asArray(e.image)[0] || null,
      cancelled: /Cancel/i.test(String(e.eventStatus || ''))
    };
  });
}

export async function fetchJsonLd(source, ctx) {
  const out = [];
  for (const url of source.config.urls) out.push(...parseJsonLdEvents(await politeFetch(url, ctx.http), source, url));
  return out;
}
