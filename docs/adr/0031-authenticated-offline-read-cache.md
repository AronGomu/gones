# Authenticated Offline Read Cache

## Status

Accepted. Extends ADR 0020 (server is the data authority) without weakening it. Does not create a
sync path; ADR 0021 and ADR 0028 still stand.

Amended by ADR 0039: the same store also serves fresh navigations under a 24h TTL. The fallback rule
below still holds for every caller of `read()`.

## Context

Gones is an installable PWA. Offline, it answers well for anonymous readers and badly for everyone
else.

What already survives a lost network:

- the public tournament catalog — `AllTournamentsCacheService` keeps a 24-hour snapshot in
  `localStorage` under `gones.calendar-v1.all-tournaments`, and the Calendar page renders it with an
  offline banner;
- the browser-local Live store (`gones-live`, ADR 0021) for anonymous visitors and the plain `User`
  role;
- the browser-local League store (`gones-leagues`, ADR 0028) for the leagues created in this browser.

What does not survive: everything a **signed-in** visitor reads from the API. An Organizer who loaded
their League Archives and their running tournaments a minute ago sees a failed request on reload
without a network. The service worker's data cache is deliberately purged on logout by
`SessionScopeService` and is not a durable answer either.

The user's requirement is explicit: *"whenever a user logs in and retrieves all their remote data, it
is cached and stored locally, so that the next time the user connects to the website without an
internet connection, they should see everything that has already been loaded"* — with the conflict
rule *"the remote data always prevails and erases the local data"*.

Two constraints shape the answer.

**A cache is not an authority.** ADR 0020 says the API database owns everything. A cached response
must never become a second source of truth, must never be merged with a fresh response, and must
never be replayed as a write.

**A cache of private data is a privacy surface.** The same browser is shared. `SessionScopeService`
already purges the service worker's API cache on logout for exactly that reason. A durable cache of
user A's leagues that user B can read in the same browser is a data leak, and no offline convenience
justifies it.

## Decision

**A per-user, read-only, logout-scoped IndexedDB cache sits in front of the server adapters.**

### Shape

`src/app/backend/server-read-cache.service.ts`, database `gones-cache`, object store `reads`,
`keyPath: 'key'`. A row is `{ key: '<userId>:<resource>', value, cachedAt }`.

```ts
read<T>(resource: string, load: () => Promise<T>): Promise<{ value: T; stale: boolean; cachedAt?: string }>
purge(): Promise<void>
```

- `load()` fulfils → the row is **overwritten** and `{ value, stale: false }` returned. This is
  "remote prevails" in code: a successful server read never merges with the cache, it replaces it.
- `load()` rejects and a row exists → `{ value: <row>, stale: true }`. The caller renders the stale
  answer and says so.
- `load()` rejects and no row exists → the original rejection propagates. There is no empty-state lie.
- No signed-in user → pass-through, nothing written. Anonymous data has its own stores already.

### What goes through it

Server **reads** only: `LeagueArchiveRepository.listLeagues()` and `getLeague(id)` for server ids, and
`LiveTournamentRepository.list()` / `get(id)` when `LIVE_BACKEND_MODE` is `aspnet-api`. Mutations are
not wrapped. A write that fails offline still fails, loudly, with nothing queued.

The browser-local League and Live stores are not wrapped either: they are already offline, and
double-storing them would create two answers for one document.

The anonymous public catalog cache stays where it is. It is public data with no user to scope it to,
and moving it would break `cypress/e2e/offline-public-read.cy.js` for no gain.

### Lifetime

`SessionScopeService.register(() => void this.purge())` in the constructor. Logout, a failed bootstrap
and account deletion all reach `AuthService.clear()`, which calls `SessionScopeService.clear()`, which
drops the database. A session that merely ends with a closed tab keeps its cache — that is the whole
point.

### Boundary

`server-authority-boundary.test.ts` pins the exact set of files allowed to touch IndexedDB. This ADR
adds the fourth and, at the time of writing, last: `src/app/backend/server-read-cache.service.ts`. Its
persistence sits behind a `ServerReadCacheStore` seam so the service is unit-testable with a fake and
so nothing else in the app grows an `IDBDatabase` parameter.

### The other face of "remote prevails"

The cache is one of exactly two places where local and remote data can disagree. The other is the deck
archetype catalog, which exists both in `localStorage` (`gones.settings`, ADR 0032) and on the server.
There, "remote prevails" is implemented as `DeckArchetypeSettingsService.adoptServerCatalog(names)`,
called once per session after sign-in and after a successful bootstrap: the server list **replaces**
the browser list. Nothing local is uploaded, in either surface.

Browser-local League and Live *documents* are deliberately outside this rule. Their ids carry a
`local-` prefix (ADR 0028) or live in a role-selected store (ADR 0021), so they cannot collide with a
server id and have no conflict to resolve. Signing in does not erase them.

## Consequences

- A signed-in Organizer keeps reading their leagues and running tournaments offline, with a visible
  staleness signal.
- Exactly one new browser database, exactly one new file on the IndexedDB allowlist.
- Cached private data does not outlive the session that fetched it, and never crosses users.
- A cache failure is never fatal: a write error is logged and swallowed, a read error is a miss.
- Offline writes are still refused. This ADR does not open an outbox and does not want one.
- `serverUnavailable()` on the League list now also means "you are looking at a cached answer", which
  is what its banner already says.
