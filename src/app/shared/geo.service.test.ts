import '@angular/compiler';
import { HttpClient } from '@angular/common/http';
import { Injector } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { GeoService } from './geo.service';

const countries = [{ code: 'FR', name: 'France' }, { code: 'BE', name: 'Belgium' }];
const regions = [{ code: '69', name: 'Rhône' }];
const cities = { '69': ['Lyon'] };

function fixtureFor(url: string): unknown {
  if (String(url).includes('fr-cities.json')) return cities;
  if (String(url).includes('fr-regions.json')) return regions;
  return countries;
}

function createService() {
  const get = vi.fn().mockImplementation((url: string) => of(fixtureFor(url)));
  const injector = Injector.create({ providers: [GeoService, { provide: HttpClient, useValue: { get } }] });
  return { service: injector.get(GeoService), get };
}

describe('GeoService', () => {
  it('fetches each file once', async () => {
    const { service, get } = createService();
    await service.countries();
    await service.countries();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('does not fetch cities before FR is selected', async () => {
    const { service, get } = createService();
    await service.countries();
    await service.regions('FR');
    expect(get.mock.calls.some(call => String(call[0]).includes('fr-cities.json'))).toBe(false);
  });

  it('unknown country yields no regions', async () => {
    const { service } = createService();
    await expect(service.regions('JP')).resolves.toEqual([]);
  });
});
