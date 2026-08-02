import '@angular/compiler';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injector } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, PublicTournamentListResponse } from '../../api/generated/gones-api';
import { PublicTournamentService } from './public-tournament.service';

const response: PublicTournamentListResponse = { items: [], page: 1, pageSize: 20, totalCount: 0 };
const query = { month: '2026-08', view: 'calendar' as const, page: 1, past: false, status: '', city: '', country: '', organization: '', format: '', search: '' };

describe('PublicTournamentService', () => {
  it('returns cached stale response offline and revalidates with ETag', async () => {
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

    await expect(service.list(query)).resolves.toMatchObject({ data: response, stale: false });
    await expect(service.list(query)).resolves.toMatchObject({ data: response, stale: false });
    await expect(service.list(query)).resolves.toMatchObject({ data: response, stale: true });

    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls[1][0]).toBe('https://api.example/api/tournaments');
    expect(get.mock.calls[1][1].headers.get('If-None-Match')).toBe('"v1"');
    expect(get.mock.calls[2][1].headers.get('If-None-Match')).toBe('"v1"');
  });
});
