// Real basemap: MapLibre GL + a self-hosted Protomaps extract of the metro (web/map/portland.pmtiles, built by
// `npm run build:map`). Everything is served from this site: no API key, no third-party tile requests.
// If anything fails to load (or the page is the single-file snapshot), initMap() resolves false and app.js keeps
// the illustrative SVG map.

const BOUNDS = [[-123.05, 45.28], [-122.35, 45.70]]; // same box as the extract and the OSM places query
const MAX_BOUNDS = [[-123.35, 45.15], [-122.05, 45.83]];
const ATTRIBUTION = '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> © <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

let M = null; // { gl, map, el, markers: Map<id, {marker, btn}>, key, sel }

const loadScript = (src) => new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = () => fail(new Error(`could not load ${src}`));
  document.head.append(s);
});

export async function initMap() {
  if (!/^https?:$/.test(location.protocol)) return false;
  try {
    const base = new URL('.', location.href).href;
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = base + 'vendor/maplibre-gl.css';
    document.head.append(css);
    const [gl] = await Promise.all([import(base + 'vendor/maplibre-gl.mjs'), loadScript(base + 'vendor/pmtiles.js'), loadScript(base + 'vendor/basemaps.js')]);
    const { pmtiles, basemaps } = window;
    gl.addProtocol('pmtiles', new pmtiles.Protocol().tile);

    // Protomaps "light", re-tinted to the Editorial palette; no POI icons so our pins are the only markers.
    const light = basemaps.namedFlavor('light');
    const flavor = { ...light, background: '#F3EEE4', earth: '#F3EEE4', water: '#BFD9EA', park_a: '#DCE9D0', park_b: '#DCE9D0', wood_a: '#E1EBD6', wood_b: '#E1EBD6', zoo: '#E4EBD2', pois: undefined };
    const style = {
      version: 8,
      glyphs: base + 'map/fonts/{fontstack}/{range}.pbf',
      sprite: base + 'map/sprites/light',
      sources: { protomaps: { type: 'vector', url: `pmtiles://${base}map/portland.pmtiles`, attribution: ATTRIBUTION } },
      layers: basemaps.layers('protomaps', flavor, { lang: 'en' })
    };

    const el = document.createElement('div');
    el.className = 'mapgl';
    const map = new gl.Map({
      container: el, style, bounds: BOUNDS, maxBounds: MAX_BOUNDS, minZoom: 8, maxZoom: 17,
      attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      // On phones, one finger scrolls the page and two fingers move the map.
      cooperativeGestures: matchMedia('(pointer: coarse)').matches
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new gl.NavigationControl({ showCompass: false }), 'bottom-right');
    M = { gl, map, el, markers: new Map(), key: '', sel: null };
    return true;
  } catch (err) {
    console.warn('Map unavailable, using the illustrative map:', err);
    return false;
  }
}

/**
 * Put the persistent map into `slot` (app.js re-renders its HTML, so the map element moves between renders)
 * and sync markers. items: one per location, [{ id, lat, lon, n, color, count }]. Pins are <button data-pin> so app.js's click handler
 * selects them exactly like the old SVG pins.
 */
export function showPins(slot, items, selected, cardHeight = 0) {
  if (!M) return;
  const { gl, map, el } = M;
  if (el.parentNode !== slot) { slot.prepend(el); map.resize(); }
  const key = items.map((i) => `${i.id}:${i.count}`).join('|');
  if (key !== M.key) {
    M.markers.forEach(({ marker }) => marker.remove());
    M.markers.clear();
    // Lowest numbers on top, so a branch with several events shows its earliest one.
    [...items].reverse().forEach((it) => {
      const wrap = document.createElement('div');
      const btn = document.createElement('button');
      btn.className = 'pin';
      btn.dataset.pin = it.id;
      btn.style.background = it.color;
      btn.textContent = it.n;
      if (it.count > 1) { const b = document.createElement('b'); b.className = 'cnt'; b.textContent = `+${it.count - 1}`; btn.append(b); }
      btn.setAttribute('aria-label', it.count > 1 ? `${it.count} items here, starting with ${it.n}` : `Show item ${it.n} on the map`);
      wrap.append(btn);
      M.markers.set(it.id, { marker: new gl.Marker({ element: wrap }).setLngLat([it.lon, it.lat]).addTo(map), btn });
    });
    M.key = key;
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); // undo any selection offset
    if (items.length) {
      const b = new gl.LngLatBounds();
      items.forEach((it) => b.extend([it.lon, it.lat]));
      map.fitBounds(b, { padding: 48, maxZoom: 14, duration: 0 });
    } else {
      map.fitBounds(BOUNDS, { duration: 0 });
    }
    M.sel = null;
  }
  if (selected !== M.sel) {
    M.markers.forEach(({ marker, btn }, id) => {
      const on = id === selected;
      btn.classList.toggle('on', on);
      marker.getElement().style.zIndex = on ? 5 : '';
    });
    // The selection card covers the top of the map: center the pin in the space below it.
    const hit = M.markers.get(selected);
    if (hit) map.easeTo({ center: hit.marker.getLngLat(), padding: { top: cardHeight ? cardHeight + 28 : 0, bottom: 0, left: 0, right: 0 }, duration: 400 });
    M.sel = selected;
  }
}
