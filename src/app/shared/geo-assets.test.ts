import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const geoDir = join(__dirname, '..', '..', 'assets', 'geo');

function readJson(fileName: string): unknown {
  return JSON.parse(readFileSync(join(geoDir, fileName), 'utf8'));
}

describe('generated geo assets', () => {
  it('generated countries are sorted and unique', () => {
    const countries = readJson('countries.json') as { code: string; name: string }[];
    expect(countries.length).toBeGreaterThanOrEqual(200);
    for (const country of countries) {
      expect(typeof country.code).toBe('string');
      expect(typeof country.name).toBe('string');
    }
    const names = countries.map(c => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const codes = countries.map(c => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('generated FR regions match the départements count', () => {
    const regions = readJson('fr-regions.json') as { code: string; name: string }[];
    expect(regions.length).toBe(101);
    expect(regions).toContainEqual({ code: '69', name: 'Rhône' });
  });

  it('generated FR cities are keyed by region', () => {
    const cities = readJson('fr-cities.json') as Record<string, string[]>;
    expect(cities['69']).toContain('Lyon');
  });
});
