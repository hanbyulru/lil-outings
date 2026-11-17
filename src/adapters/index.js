import { fetchIcal } from './ical.js';
import { fetchPortlandGov } from './portland_gov.js';
import { fetchBiblioCommons } from './bibliocommons.js';
import { fetchJsonLd } from './jsonld.js';
import { fetchManual } from './manual.js';
import { fetchMultcolib } from './multcolib.js';
import { fetchDrupalCalendar } from './drupal_calendar.js';
import { fetchClackamasEvents } from './clackamas_events.js';
import { fetchRevizeCalendar } from './revize_calendar.js';
import { fetchTribeEvents } from './tribe_events.js';
import { fetchOsmPlaces } from './osm_places.js';
import { fetchPortlandGovPrograms } from './portland_gov_programs.js';

export const EVENT_ADAPTERS = { ical: fetchIcal, portland_gov: fetchPortlandGov, bibliocommons: fetchBiblioCommons, jsonld: fetchJsonLd, manual: fetchManual, multcolib: fetchMultcolib, drupal_calendar: fetchDrupalCalendar, clackamas_events: fetchClackamasEvents, revize_calendar: fetchRevizeCalendar, tribe_events: fetchTribeEvents };
export const PLACE_ADAPTERS = { osm: fetchOsmPlaces };
export const PROGRAM_ADAPTERS = { portland_gov_programs: fetchPortlandGovPrograms };
