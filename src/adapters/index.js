import { fetchIcal } from './ical.js';
import { fetchPortlandGov } from './portland_gov.js';
import { fetchBiblioCommons } from './bibliocommons.js';
import { fetchJsonLd } from './jsonld.js';
import { fetchManual } from './manual.js';
import { fetchMultcolib } from './multcolib.js';
import { fetchOsmPlaces } from './osm_places.js';
import { fetchPortlandGovPrograms } from './portland_gov_programs.js';

export const EVENT_ADAPTERS = { ical: fetchIcal, portland_gov: fetchPortlandGov, bibliocommons: fetchBiblioCommons, jsonld: fetchJsonLd, manual: fetchManual, multcolib: fetchMultcolib };
export const PLACE_ADAPTERS = { osm: fetchOsmPlaces };
export const PROGRAM_ADAPTERS = { portland_gov_programs: fetchPortlandGovPrograms };
