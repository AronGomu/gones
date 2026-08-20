# One TTL Cache Contract For Every Data Page

## Status

Accepted. **Amends ADR 0031** (authenticated offline read cache) from fallback-only to
fallback-plus-TTL. Extends the pattern ADR 0023 set for the public catalog. Planned by T7–T11 in
`artifacts/PLAN_2026_08_15_feedback-app-wide-round-5.md`.

## Context

Website data changes rarely — roughly once a day. Navigating between tabs refetched everything every
time, which is wasted work on every page and a visible stall on the heavy ones.

The Events page already solved this (ADR 0023): load the whole catalog once, cache it in
`localStorage` with a 24-hour TTL and an ETag, show a "last synced" label and a Synchronize button.
The product owner asked for that exact behaviour on every page that reads server data: Registrations,
Global Rankings, Leagues Archive, Live Tournament, Settings, every admin page, every player page.

Taken literally that meant `localStorage` everywhere — and most of those pages hold **private** rows.
A registration list or an admin user list in `localStorage` outlives logout and is readable by the
next account on the same browser. ADR 0031 already built the right store for private data: per-user
keys, a cross-tab lock, and a purge registered with `SessionScopeService` so logout drops the whole
database. Its contract, though, was deliberately **fallback-only** — a row was read *only* after the
server read had already failed. It could not serve a fresh navigation.

Two further tensions surfaced. Some of these pages are server-paged, so "cache the catalog" has no
single meaning. And some of them mutate their own data — an admin who grants a role must not then see
the old role for up to a day.

## Decision

**One contract, two stores, chosen by privacy.**

Every listed page gets identical behaviour: load once on page load; serve the cached copy while it is
under 24 hours old; show the "last synced" instant and a Synchronize button (`gones-sync-bar`);
refetch automatically when the copy is older than 24 hours.

- **Public data** caches in `localStorage` through `src/app/shared/catalog-cache.ts`
  (`readCatalogEntry`, `writeCatalogEntry`, `isCatalogFresh`, `CATALOG_TTL_MS`).
- **Private data** caches in the ADR 0031 per-user IndexedDB store, through a new TTL-primary read
  `ServerReadCacheService.readCached(resource, load, { ttlMs?, force? })` returning
  `{ value, fetchedAt, fromCache, stale }`. The existing `read()` keeps its fallback-only contract
  for its current callers, unchanged.

**Cache shape follows the endpoint, not the privacy.** Public read-mostly pages (Global Rankings,
Leagues Archive) get full-catalog endpoints mirroring `/api/events/all` — row cap, `truncated` flag,
SHA-256 ETag, `Cache-Control: public, max-age=3600` — cached once and then filtered, sorted and paged
in the browser. Private and admin lists stay server-paged, and their cache entry is keyed by the query
parameters that produced it (`adminCacheKey(family, params)`).

**Mutation invalidates its own entry.** After a successful write, the page calls
`invalidate(resource)` or `invalidateFamily(family)` and refetches at once. A rejected write leaves
the cache untouched. The TTL governs navigation; it never governs correctness.

## Consequences

- Switching tabs stops refetching. Sorting and filtering the rankings become instant, because the
  whole catalog is already in the browser.
- ADR 0031's privacy guarantees are untouched: rows are still keyed `<userId>:<resource>`, still
  written under the cross-tab lock with a re-checked session scope, and still dropped whole by the
  logout purge. **No private row ever reaches `localStorage`.**
- `ServerReadCacheStore` grows `delete(key)` and `keys()` to support targeted and family
  invalidation. `indexedDB` stays confined to the three files
  `src/app/backend/server-authority-boundary.test.ts` allows.
- A 24-hour-stale copy can be shown to a user whose data another actor changed. The Synchronize
  button is the manual escape hatch, and self-inflicted changes are never stale.
- Every new data page must join this contract. `AGENT.md` states it as a standing rule.
- The Live Tournament list joins it; the Live **runner** does not, and the role-scoped adapter choice
  of ADR 0021 is not touched. When `LocalLiveBackend` is selected the read is already local, and
  `readCached` degrades to a pass-through for anonymous callers.
