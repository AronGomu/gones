import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface GeoOption {
  code: string;
  name: string;
}

/** Only France has structured Region/City data; every other country falls back to free text. */
export function hasStructuredRegions(countryCode: string): boolean {
  return countryCode === 'FR';
}

@Injectable({ providedIn: 'root' })
export class GeoService {
  private readonly http = inject(HttpClient);
  private countriesCache?: Promise<GeoOption[]>;
  private regionsCache?: Promise<GeoOption[]>;
  private citiesCache?: Promise<Record<string, string[]>>;

  countries(): Promise<GeoOption[]> {
    this.countriesCache ??= firstValueFrom(this.http.get<GeoOption[]>('assets/geo/countries.json'));
    return this.countriesCache;
  }

  async regions(countryCode: string): Promise<GeoOption[]> {
    if (countryCode !== 'FR') return [];
    this.regionsCache ??= firstValueFrom(this.http.get<GeoOption[]>('assets/geo/fr-regions.json'));
    return this.regionsCache;
  }

  async cities(countryCode: string, regionCode: string): Promise<string[]> {
    if (countryCode !== 'FR' || !regionCode) return [];
    this.citiesCache ??= firstValueFrom(this.http.get<Record<string, string[]>>('assets/geo/fr-cities.json'));
    const data = await this.citiesCache;
    return data[regionCode] ?? [];
  }
}
