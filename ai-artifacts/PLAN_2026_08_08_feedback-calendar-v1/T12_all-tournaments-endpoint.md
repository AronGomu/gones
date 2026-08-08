# T12: `GET /api/tournaments/all`

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T1
**Commit outcome:** One anonymous request returns every present-and-future published tournament in a single ETag'd payload, ready for the browser to cache for a day.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is the server half of Calendar §2 ("request to server all current present to future ALL tournaments").
- This slice: the bulk endpoint only. The browser cache, the fuzzy filter and the page rewiring are T13 and T14.
- Out of scope here: paging changes to the existing `GET /api/tournaments` — it stays exactly as it is, still used by nothing after T14 but still contract-tested.
- Assumptions in force: a bulk endpoint (user answer), so the client never walks pages.

## Requirements

- `GET /api/tournaments/all` is anonymous and returns every non-deleted tournament of a non-deleted organization whose `EndsAtUtc >= now`, ordered by `StartsAtUtc` then `Id`.
- Optional `from` query parameter (ISO date) overrides the default "now" lower bound; there is no upper bound and no paging.
- The response is `{ items: PublicTournamentSummaryResponse[], generatedAt: Instant, count: int, truncated: bool }`.
- A hard ceiling of 5000 items protects the endpoint; exceeding it sets `truncated: true` rather than failing, and logs a warning.
- The response carries a strong `ETag` and `Cache-Control: public, max-age=3600`; a matching `If-None-Match` returns `304`.
- Every item carries the same fields the existing list endpoint's items do, so the browser can reuse `PublicTournamentView` unchanged.

## Inputs

- `backend/src/Gones.Api/Tournaments/PublicTournamentEndpoints.cs`:
  - `:18-21` — `public const int DefaultPageSize = 20; public const int MaximumPageSize = 100; private const string PublicCacheControl = "public, max-age=60";`
  - `:25-30` — `app.MapGet("/api/tournaments", ListAsync).AllowAnonymous().Produces<PublicTournamentListResponse>().Produces(StatusCodes.Status304NotModified).ProducesProblem(StatusCodes.Status400BadRequest);`
  - `:49-105` — `ListAsync(...)`: builds `from tournament in database.ScheduledTournaments.AsNoTracking() join org in database.Organizations.AsNoTracking() on tournament.OrganizationId equals org.Id where tournament.DeletedAt == null && org.DeletedAt == null select new { Tournament = tournament, Organization = org }`, then applies `fromDate`, `toDate`, the "future only" rule `if (fromDate is null && !showPast) query = query.Where(item => item.Tournament.EndsAtUtc >= clock.GetCurrentInstant());`, city/country/organization/format/status/search filters, and finally `.OrderBy(item => item.Tournament.StartsAtUtc).ThenBy(item => item.Tournament.Id).Skip(...).Take(size).Select(item => new TournamentRow(...))`.
  - the private helpers `ParseDateQuery(value, name)`, `ParseOrganization(value)`, `ParseStatuses(value)`, the `TournamentRow` record and the projection that turns rows into `PublicTournamentSummaryResponse`. Reuse all of them; do not re-derive the projection.
- `backend/src/Gones.Api/Tournaments/PublicTournamentEndpoints.cs` — the existing ETag/`304` handling on this file's endpoints is the pattern to copy for the new one.
- `backend/src/Gones.Domain/Calendar/` — `ScheduledTournament` entity with `Status`, `DeletedAt`, `StartsAtUtc`, `EndsAtUtc`, `VenueStartDate`, `UpdatedAt`, `NormalizedSearchText`.
- `backend/src/Gones.Infrastructure/Observability/` — `OperationalMetrics` and the structured logging helpers used elsewhere in the API for warnings.
- `backend/tests/Gones.IntegrationTests/` — the public tournament API tests live here; follow their fixture and seeding helpers.
- Regeneration: start Postgres (`docker compose up -d postgres`) then `npm run api:generate`; verify with `npm run api:check`.
- **From Depends (T1):** nothing on the backend.

## TDD

1. **Red** — add `backend/tests/Gones.IntegrationTests/AllTournamentsEndpointTests.cs` with every row below; the route does not exist so they 404.
2. **Green** — add the endpoint, reusing `ListAsync`'s query construction and row projection.
3. **Refactor** — extract the shared query builder into `private static IQueryable<…> VisibleTournaments(GonesDbContext database)` so both endpoints use one definition of "visible".

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `All_is_anonymous` | no auth header | `200` |
| `All_returns_future_tournaments` | seed 3 future, 2 past | `count == 3`; no past slug present |
| `All_honours_an_explicit_from` | `?from=2020-01-01` with 2 past seeded | `count == 5` |
| `All_ignores_paging_parameters` | `?page=2&pageSize=1` | full set returned, parameters ignored |
| `All_orders_by_start_then_id` | two tournaments sharing a start instant | ordered by `Id` after `StartsAtUtc` |
| `All_excludes_deleted_tournaments_and_orgs` | one soft-deleted tournament, one under a soft-deleted org | neither appears |
| `All_sets_a_strong_etag_and_cache_control` | first request | `ETag` present, `Cache-Control: public, max-age=3600` |
| `All_returns_304_for_a_matching_etag` | replay with `If-None-Match` | `304`, empty body |
| `All_changes_its_etag_when_data_changes` | publish one more tournament, re-request | different `ETag` |
| `All_flags_truncation` | ceiling temporarily lowered in the test host | `truncated == true`, `items.Count == ceiling` |

Run: `npm run backend:test`

## Impl steps

- [ ] 1. In `backend/src/Gones.Api/Tournaments/PublicTournamentEndpoints.cs`, add `public const int MaximumCatalogSize = 5000;` next to the existing size constants and `private const string CatalogCacheControl = "public, max-age=3600";`.
- [ ] 2. Extract the shared query into `private static IQueryable<TournamentQueryItem> VisibleTournaments(GonesDbContext database)` returning the existing `ScheduledTournaments`/`Organizations` join with both `DeletedAt == null` guards; introduce `private sealed record TournamentQueryItem(ScheduledTournament Tournament, Organization Organization)` if the anonymous type cannot cross the method boundary.
- [ ] 3. Rewrite `ListAsync` to start from `VisibleTournaments(database)` so both endpoints share one visibility definition. Do not change any of its filters or its response shape.
- [ ] 4. Register the new route **before** the `{slug}` route so `all` is not captured as a slug:
  ```
  app.MapGet("/api/tournaments/all", ListAllAsync)
      .AllowAnonymous()
      .Produces<PublicTournamentCatalogResponse>()
      .Produces(StatusCodes.Status304NotModified)
      .ProducesProblem(StatusCodes.Status400BadRequest);
  ```
- [ ] 5. Implement `private static async Task<IResult> ListAllAsync(string? from, HttpRequest request, HttpResponse response, GonesDbContext database, IClock clock, ILoggerFactory loggerFactory, CancellationToken cancellationToken)`.
- [ ] 6. In it: `var fromDate = ParseDateQuery(from, nameof(from)); var query = VisibleTournaments(database); query = fromDate is not null ? query.Where(item => item.Tournament.VenueStartDate >= fromDate) : query.Where(item => item.Tournament.EndsAtUtc >= clock.GetCurrentInstant());`
- [ ] 7. Compute the cache validator without materialising the set twice: `var stamp = await query.Select(item => new { item.Tournament.UpdatedAt, item.Tournament.Id }).OrderByDescending(x => x.UpdatedAt).FirstOrDefaultAsync(cancellationToken); var total = await query.CountAsync(cancellationToken);` then `var etag = "\"" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{total}:{stamp?.UpdatedAt}:{stamp?.Id}"))).ToLowerInvariant()[..32] + "\"";`
- [ ] 8. Short-circuit on `request.Headers.IfNoneMatch` containing the etag: set the `ETag` and `Cache-Control` headers and `return Results.StatusCode(StatusCodes.Status304NotModified);`
- [ ] 9. Materialise with the ceiling: `.OrderBy(item => item.Tournament.StartsAtUtc).ThenBy(item => item.Tournament.Id).Take(MaximumCatalogSize).Select(item => new TournamentRow(...))` — copy the exact `TournamentRow` projection `ListAsync` uses.
- [ ] 10. Map rows to summaries with the same helper `ListAsync` uses; do not duplicate the mapping code.
- [ ] 11. When `total > MaximumCatalogSize`, log a warning through `loggerFactory.CreateLogger("Gones.Api.Tournaments")` naming `total` and the ceiling, and set `truncated: true`.
- [ ] 12. Set `response.Headers.ETag = etag;` and `response.Headers.CacheControl = CatalogCacheControl;` then `return Results.Ok(new PublicTournamentCatalogResponse(items, clock.GetCurrentInstant(), items.Count, total > MaximumCatalogSize));`
- [ ] 13. Add `internal sealed record PublicTournamentCatalogResponse(IReadOnlyList<PublicTournamentSummaryResponse> Items, Instant GeneratedAt, int Count, bool Truncated);` next to the other response records at the bottom of the file.
- [ ] 14. Add `backend/tests/Gones.IntegrationTests/AllTournamentsEndpointTests.cs` with all ten Test plan rows; for the truncation row, override `MaximumCatalogSize` through a test-only configuration value or seed past the ceiling — pick the configuration route and bind the ceiling to `Gones:Calendar:MaximumCatalogSize` with a 5000 default.
- [ ] 15. Run `npm run backend:test`.
- [ ] 16. Start Postgres (`docker compose up -d postgres`) and run `npm run api:generate`; confirm the generated client gained a method for `/api/tournaments/all` and commit `src/app/api/generated/gones-api.ts`.
- [ ] 17. Run `npm run api:check`, `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`.
- [ ] 18. Add a row to `ops/acceptance-matrix.json` under the calendar capability pointing at `backend/tests/Gones.IntegrationTests/AllTournamentsEndpointTests.cs`, then run `npm run acceptance:matrix`.

## Outputs

- Files created: `backend/tests/Gones.IntegrationTests/AllTournamentsEndpointTests.cs`.
- Files touched: `backend/src/Gones.Api/Tournaments/PublicTournamentEndpoints.cs`, `src/app/api/generated/gones-api.ts`, `ops/acceptance-matrix.json`, possibly `backend/src/Gones.Api/appsettings.json` for the ceiling.
- Public API / behavior change: new anonymous endpoint `GET /api/tournaments/all`.
- Migrate / config: optional `Gones:Calendar:MaximumCatalogSize`, default 5000.

## Validation

- [ ] `npm run backend:test` passes
- [ ] `npm run api:check` reports no drift
- [ ] `npm run test && npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run acceptance:matrix` passes
- [ ] manual check: `curl -i http://127.0.0.1:5080/api/tournaments/all` shows the ETag and `max-age=3600`; replaying with `If-None-Match` returns 304
- [ ] app functional — `GET /api/tournaments` behaves exactly as before
- [ ] commit msg draft: `feat(calendar): serve the full present-and-future tournament catalog in one request`
