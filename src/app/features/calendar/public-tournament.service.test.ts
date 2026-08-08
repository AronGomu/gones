import '@angular/compiler';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injector } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, PublicTournamentDetailResponse } from '../../api/generated/gones-api';
import { PublicTournamentService } from './public-tournament.service';

const response = { slug: 'lyon-legacy', title: 'Lyon Legacy' } as unknown as PublicTournamentDetailResponse;

describe('PublicTournamentService', () => {
  it('returns cached stale detail offline and revalidates with ETag', async () => {
    localStorage.clear();
    const get = vi.fn()
      .mockReturnValueOnce(of(new HttpResponse({ body: response, status: 200, headers: new HttpHeaders({ ETag: '"v1"' }) })))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 304, statusText: 'Not Modified' })))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Offline' })));
    const injector = Injector.create({ providers: [
      PublicTournamentService,
      { provide: HttpClient, useValue: { get } },
      { provide: API_BASE_URL, useValue: 'https://api.example' }
    ] });
    const service = injector.get(PublicTournamentService);

    const fresh = await service.detail('lyon-legacy');
    expect(fresh).toMatchObject({ data: response, stale: false });
    expect(Date.parse(fresh.cachedAt!)).toBeGreaterThan(0);
    await expect(service.detail('lyon-legacy')).resolves.toMatchObject({ data: response, stale: false, cachedAt: fresh.cachedAt });
    await expect(service.detail('lyon-legacy')).resolves.toMatchObject({ data: response, stale: true, cachedAt: fresh.cachedAt });

    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls[1][0]).toBe('https://api.example/api/tournaments/lyon-legacy');
    expect(get.mock.calls[1][1].headers.get('If-None-Match')).toBe('"v1"');
    expect(get.mock.calls[2][1].headers.get('If-None-Match')).toBe('"v1"');
  });

  it('builds the ICS download URL from the base API URL', () => {
    const injector = Injector.create({ providers: [
      PublicTournamentService,
      { provide: HttpClient, useValue: { get: vi.fn() } },
      { provide: API_BASE_URL, useValue: 'https://api.example' }
    ] });
    const service = injector.get(PublicTournamentService);

    expect(service.icsUrl('lyon-legacy')).toBe('https://api.example/api/tournaments/lyon-legacy.ics');
  });
});
