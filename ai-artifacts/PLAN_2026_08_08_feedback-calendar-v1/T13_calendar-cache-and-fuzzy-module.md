# T13: Calendar cache + fuzzy search module

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T12
**Commit outcome:** A service caches the whole tournament catalog for 24 hours and a tested pure module fuzzy-filters it from one search string, both fully unit-covered and not yet wired into any page.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is the data half of Calendar §2 (cache with timestamp, no request within 24h), §6 (filter the cached result) and §7 (one fuzzy input over all tournament data except the description, with `\`-escapable separators).
- This slice: two standalone modules plus their tests. The page keeps working unchanged until T14 consumes them.
- Out of scope here: any template change, the Synchroniser button, removing the old filter form.
- Assumptions in force:
  - **A10** — `fuse.js` is installed (T1) and used for the scoring.
  - Fuzzy matching runs over every summary field **except** any description/summary long text: the searchable corpus is title, slug, status, organization name, format names, street address, postal code, city, country, time zone, venue start/end date and time, and capacity.
  - Multiple terms are ANDed: a tournament must match every term.

## Requirements

- `splitSearchTerms(query)` splits on `,` `;` and whitespace; a separator preceded by `\` is a literal character of the term and the backslash is dropped.
- `filterTournaments(items, query)` returns `items` unchanged for an empty query, and otherwise every item matching all terms fuzzily.
- Matching is accent- and case-insensitive.
- `AllTournamentsCacheService.load()` returns the cached catalog when it is under 24 hours old and issues no HTTP request; `load({ force: true })` always refetches.
- The cache entry records the fetch timestamp and survives a reload (`localStorage`).
- A failed refetch with a usable cache returns the cache flagged stale rather than throwing.
- `src/app/backend/server-authority-boundary.test.ts`'s browser-storage allowlist is extended with the new file, with a comment saying why.

## Inputs

- `src/app/features/calendar/public-tournament.service.ts` — the existing cached-GET pattern: `CACHE_PREFIX = 'gones.calendar-v1.cache.'`, `CacheEntry<T> { etag?, cachedAt?, data }`, `getCached<T>(path, params)` using `If-None-Match`, treating `304` as fresh and `0`/`5xx` as stale-but-usable, writing through `globalThis.localStorage?.setItem`. Reuse the shape, not the code.
- `src/app/features/calendar/public-calendar.ts` — `PublicTournamentView` interface with `id, title, slug, summary, venue, timeZoneId, venueStartDate, venueStartTime, venueEndDate, venueEndTime, startsAtUtc, endsAtUtc, capacity, status, organization, formats`; `venue` is `PublicTournamentSummaryResponse['venue']` (`streetAddress`, `postalCode`, `city`, `country`); `organization` has `name`; `formats` is an array with `name`.
- `src/app/backend/server-authority-boundary.test.ts` — the test `keeps global browser storage access inside the documented browser-only allowlist` asserts `filesMatching(/localStorage\??\.(get|set|remove)Item/)` equals exactly:
  ```
  'src/app/features/calendar/public-calendar.component.ts',
  'src/app/features/calendar/public-tournament.service.ts',
  'src/app/shared/deck-archetype-settings.service.ts'
  ```
  A new `localStorage` caller **fails this test** until it is added to that array with a justifying comment. This is mandatory, not optional.
- `src/app/api/generated/gones-api.ts:134` — T12 has landed and the generated method is
  `all(from: string | undefined): Observable<PublicTournamentCatalogResponse>`, with
  `PublicTournamentCatalogResponse { items, generatedAt, count, truncated }`. Note this ticket's steps 11-12 use a
  raw `HttpClient.get` with `observe: 'response'` instead, because the generated method does not surface response
  headers and this service needs `ETag` / `If-None-Match`. That is deliberate — follow the steps, and do not
  "simplify" onto the generated method.
- **Test harness — there is no Angular `TestBed` and no zone.js in this repo.** `@angular/common/http/testing` is not
  installed, so `HttpTestingController` and `provideHttpClientTesting()` are unavailable. Copy the working pattern in
  `src/app/features/calendar/public-tournament.service.test.ts:1-25`:
  ```ts
  import '@angular/compiler';
  import { HttpClient } from '@angular/common/http';
  import { Injector } from '@angular/core';
  import { of, throwError } from 'rxjs';
  import { vi } from 'vitest';

  const get = vi.fn().mockReturnValueOnce(of(new HttpResponse({ body, status: 200, headers: new HttpHeaders({ ETag: '"v1"' }) })));
  const injector = Injector.create({ providers: [
    AllTournamentsCacheService,
    { provide: HttpClient, useValue: { get } },
    { provide: API_BASE_URL, useValue: 'https://api.example' }
  ] });
  ```
  That same file also shows how to fake a `304` and an offline failure (`throwError(() => new HttpErrorResponse({ status: 304 }))` / `status: 0`) — reuse it rather than inventing a new stub shape.
- `src/app/backend/server-authority-boundary.test.ts:86-90` — the allowlist array to extend is here; the three
  existing entries are on lines 88-90.
- `src/app/api/api-boundary.ts` — `joinApiUrl(base, path)`; `API_BASE_URL` injection token comes from `src/app/api/generated/gones-api.ts`.
- `fuse.js` v7 API: `new Fuse(items, { keys, threshold, ignoreLocation, getFn })`, `fuse.search(term)` returning `{ item }[]`.
- **From Depends (T12):** `GET /api/tournaments/all?from=<ISO date>` is anonymous, returns the full catalog with a strong `ETag` and `Cache-Control: public, max-age=3600`, and answers `304` to a matching `If-None-Match`.

## TDD

1. **Red** — write `src/app/features/calendar/tournament-fuzzy-search.test.ts` and `src/app/features/calendar/all-tournaments-cache.service.test.ts` first; both modules are missing.
2. **Green** — implement the tokenizer, the filter and the cache service.
3. **Refactor** — keep every pure function in `tournament-fuzzy-search.ts` so the component in T14 holds no matching logic.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `splits on comma, semicolon and whitespace` | `'lyon, legacy; 2026 modern'` | `['lyon','legacy','2026','modern']` |
| `keeps an escaped comma inside a term` | `'saint\\,étienne'` | `['saint,étienne']` |
| `keeps an escaped space inside a term` | `'grand\\ prix'` | `['grand prix']` |
| `drops empty terms` | `'lyon,,  ,legacy'` | `['lyon','legacy']` |
| `empty query returns every item` | `filterTournaments(items, '   ')` | `items` (same reference contents) |
| `matches on city` | query `'lyon'` | only the Lyon tournament |
| `matches on organization name` | query `'gones'` | only tournaments of that organization |
| `matches on format name` | query `'legacy'` | only Legacy tournaments |
| `matches on status` | query `'cancelled'` | only cancelled tournaments |
| `matches on venue date` | query `'2026-09-12'` | only that day's tournaments |
| `ignores accents and case` | query `'RHONE'` on a `Rhône` item | matches |
| `ANDs multiple terms` | query `'lyon legacy'` | only tournaments that are both |
| `never matches the long description` | item whose only occurrence of `'zzzq'` is in `summary` | no match |
| `load fetches once and caches` | two `load()` calls | one HTTP request; second returns `fromCache: true` |
| `load skips the request within 24h` | cache stamped 23h ago | no HTTP request |
| `load refetches after 24h` | cache stamped 25h ago | one HTTP request |
| `force always refetches` | fresh cache, `load({ force: true })` | one HTTP request |
| `a failed refetch falls back to the cache` | cache present, request rejects with status 0 | resolves with the cached items and `stale: true` |
| `a failed first load rejects` | no cache, request rejects | promise rejects |
| `storage allowlist` | `server-authority-boundary.test.ts` | green with the new file listed |

Run: `npm run test -- tournament-fuzzy-search all-tournaments-cache server-authority-boundary`

## Impl steps

- [ ] 1. Create `src/app/features/calendar/tournament-fuzzy-search.ts`.
- [ ] 2. Implement `export function splitSearchTerms(query: string): string[]` — walk the string character by character; on `\` take the next character literally into the current term; on `,`, `;` or whitespace close the current term; push non-empty terms.
- [ ] 3. Implement `export function searchableText(item: PublicTournamentView): string` joining, with `' '`: `title`, `slug`, `status`, `organization?.name`, every `formats[].name`, `venue.streetAddress`, `venue.postalCode`, `venue.city`, `venue.country`, `timeZoneId`, `venueStartDate`, `venueStartTime`, `venueEndDate`, `venueEndTime`, `String(capacity ?? '')`. **`summary` is deliberately excluded.**
- [ ] 4. Implement `export function normalizeSearchValue(value: string): string { return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase(); }`
- [ ] 5. Implement `export function filterTournaments(items: PublicTournamentView[], query: string): PublicTournamentView[]` — return `items` when `splitSearchTerms(query)` is empty; otherwise build one `Fuse` over `items.map(item => ({ item, text: normalizeSearchValue(searchableText(item)) }))` with `keys: ['text']`, `threshold: 0.35`, `ignoreLocation: true`, `minMatchCharLength: 2`, and intersect the result sets of every normalized term, preserving the input order.
- [ ] 6. Create `src/app/features/calendar/tournament-fuzzy-search.test.ts` with Test plan rows 1-13, using a fixture array of at least four `PublicTournamentView` objects declared in the test file.
- [ ] 7. Create `src/app/features/calendar/all-tournaments-cache.service.ts` with `export const ALL_TOURNAMENTS_CACHE_KEY = 'gones.calendar-v1.all-tournaments';` and `export const ALL_TOURNAMENTS_TTL_MS = 24 * 60 * 60 * 1000;`.
- [ ] 8. Define `export interface AllTournamentsResult { items: PublicTournamentView[]; fetchedAt: string; fromCache: boolean; stale: boolean; truncated: boolean; }`.
- [ ] 9. Implement `@Injectable({ providedIn: 'root' }) export class AllTournamentsCacheService` injecting `HttpClient` and `API_BASE_URL`, with `async load(options: { force?: boolean } = {}): Promise<AllTournamentsResult>`.
- [ ] 10. `load` reads the cache entry `{ items, etag, fetchedAt, truncated }` from `globalThis.localStorage?.getItem(ALL_TOURNAMENTS_CACHE_KEY)`; when `!options.force` and `Date.now() - Date.parse(fetchedAt) < ALL_TOURNAMENTS_TTL_MS`, return it with `fromCache: true, stale: false` and issue no request.
- [ ] 11. Otherwise `GET joinApiUrl(base, '/api/tournaments/all')` with `observe: 'response'` and an `If-None-Match` header when an etag is cached; on `304` refresh `fetchedAt` in storage and return the cached items; on `200` write the new entry and return it.
- [ ] 12. On failure with a usable cache, return the cached items with `stale: true`; with no cache, rethrow.
- [ ] 13. Wrap every `localStorage` access in `try { … } catch { }` — a private-mode browser must degrade to "always fetch", never crash.
- [ ] 14. Add `readonly cachedAt = signal<string | undefined>(undefined);` and `readonly truncated = signal(false);` on the service so T14's page can show both without re-reading storage.
- [ ] 15. Create `src/app/features/calendar/all-tournaments-cache.service.test.ts` with Test plan rows 14-19, using a fake `localStorage` stub installed on `globalThis`. **Do not use `HttpTestingController` or `TestBed`** — see the Inputs note; build the service with `Injector.create` and a `vi.fn()` `HttpClient` stub instead, and assert request counts through `get.mock.calls.length`.
- [ ] 16. In `src/app/backend/server-authority-boundary.test.ts`, add to the allowlist array, keeping the array sorted and each entry commented:
  ```
  // Public read cache (C39) — the 24h full-catalog snapshot, anonymous GET responses only.
  'src/app/features/calendar/all-tournaments-cache.service.ts',
  ```
- [ ] 17. Run `npm run test -- tournament-fuzzy-search all-tournaments-cache server-authority-boundary`.
- [ ] 18. Run `npm run test && npm run lint && npm run typecheck && npm run build`.

## Outputs

- Files created: `src/app/features/calendar/tournament-fuzzy-search.ts`, `src/app/features/calendar/tournament-fuzzy-search.test.ts`, `src/app/features/calendar/all-tournaments-cache.service.ts`, `src/app/features/calendar/all-tournaments-cache.service.test.ts`.
- Files touched: `src/app/backend/server-authority-boundary.test.ts`.
- Public API / behavior change: none visible — no page consumes these yet.
- Migrate / config: a new `localStorage` key `gones.calendar-v1.all-tournaments`.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint && npm run typecheck && npm run build` pass
- [ ] manual check: none — nothing is rendered yet
- [ ] app functional — the calendar page still uses the old paged service and behaves exactly as before
- [ ] commit msg draft: `feat(calendar): add a 24h full-catalog cache and a fuzzy tournament filter`
