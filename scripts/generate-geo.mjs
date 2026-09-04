#!/usr/bin/env node
// Generates the offline geo datasets consumed by GeoService from the two dev
// dependencies `country-region-data` and `@etalab/decoupage-administratif`.
// Run with `npm run geo:generate`; the three output files are committed.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'src', 'assets', 'geo');

const countryRegionData = require('country-region-data/data.json');
const timeZones = require('@vvo/tzdb/raw-time-zones.json');
const departements = require('@etalab/decoupage-administratif/data/departements.json');
const communes = require('@etalab/decoupage-administratif/data/communes.json');

function buildCountries() {
  const fallbackTimeZones = {
    BV: ['Etc/UTC'],
    HM: ['Indian/Kerguelen'],
    XK: ['Europe/Belgrade']
  };
  const timeZonesByCountry = new Map();
  for (const timeZone of timeZones) {
    const countryTimeZones = timeZonesByCountry.get(timeZone.countryCode) ?? [];
    countryTimeZones.push(timeZone.name);
    timeZonesByCountry.set(timeZone.countryCode, countryTimeZones);
  }
  const byCode = new Map();
  for (const entry of countryRegionData) {
    if (!byCode.has(entry.countryShortCode)) {
      const timeZoneIds = timeZonesByCountry.get(entry.countryShortCode) ?? fallbackTimeZones[entry.countryShortCode];
      if (!timeZoneIds?.length) throw new Error(`No timezone found for ${entry.countryShortCode}.`);
      byCode.set(entry.countryShortCode, {
        code: entry.countryShortCode,
        name: entry.countryName,
        timeZoneIds
      });
    }
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// `zone: 'com'` entries are overseas collectivities, not départements — excluding them
// yields the 96 metropolitan + 5 DROM départements (101), matching the official count.
function buildRegions() {
  return departements
    .filter(departement => departement.zone !== 'com')
    .map(departement => ({ code: departement.code, name: departement.nom }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

const departementCodes = new Set(departements.filter(departement => departement.zone !== 'com').map(departement => departement.code));

function buildCities() {
  const byDepartement = {};
  for (const commune of communes) {
    if (commune.type !== 'commune-actuelle') continue;
    const code = commune.departement;
    if (!code || !departementCodes.has(code)) continue;
    (byDepartement[code] ??= []).push(commune.nom);
  }
  for (const code of Object.keys(byDepartement)) {
    byDepartement[code] = [...new Set(byDepartement[code])].sort((a, b) => a.localeCompare(b));
  }
  return byDepartement;
}

function writeJson(fileName, data) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, fileName), JSON.stringify(data), 'utf8');
}

const countries = buildCountries();
const regions = buildRegions();
const cities = buildCities();

writeJson('countries.json', countries);
writeJson('fr-regions.json', regions);
writeJson('fr-cities.json', cities);

console.log(`countries.json: ${countries.length} entries`);
console.log(`fr-regions.json: ${regions.length} entries`);
console.log(`fr-cities.json: ${Object.keys(cities).length} départements`);
