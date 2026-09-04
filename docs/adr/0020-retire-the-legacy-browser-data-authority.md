# Retire the Legacy Browser Data Authority

## Status

Accepted. Supersedes ADR 0019 and retires ADR 0008; amends ADR 0004 and ADR 0006.

> Amended by [ADR-0055](0055-account-scoped-event-create-drafts.md): one account-scoped unsent Event-create draft may use `localStorage`; it is recovery input, never canonical Event authority.

## Context

ADR 0019 (C42) replaced four inferred per-capability flags with one declared data authority, typed
`legacy-browser | server`. `legacy-browser` existed for one reason: the deployed static site owned
real user data in `localStorage`, and that data still had to be exported into a migration bundle
before it could be thrown away.

That reason has expired. The owner has the data out, in JSON, and has decided the deployed build is
the API-connected one from now on. Keeping a second authority alive past its purpose costs real
things:

1. **A dual code path in every mutating surface.** The Live Tournament runner alone branched on
   `serverMode` in twenty-five places — one arm sending intent commands with an `If-Match` version,
   the other mutating a local document and re-persisting it. Two arms, one of them dead in every
   deployment we ship.
2. **A second, weaker set of rules.** Browser-store writes had no authorization, no concurrency
   control, and no audit. Every capability check had to spell out `!serverMode ||` to stay honest
   about that, and each of those is a place to get the polarity wrong.
3. **A default that shipped the wrong artifact.** `npm run images:build` defaulted the frontend to
   `legacy-browser`, so a release built without two environment variables set silently produced a
   static browser-store SPA — the C42 carry-forward that C44 had to work around by hand.

## Decision

**There is one data authority: the API database.** The `legacy-browser` mode, the browser store that
backed it, and everything reachable only from it are removed:

- `DATA_MODES` is `['server']`. `DataAuthority.legacyBrowserAuthority` and the
  `legacyModeApiBaseUrlForbidden` / `legacyModeCapabilityForbidden` failure codes are gone.
- `LocalFrontendBackend`, `LEGACY_BROWSER_BACKEND`, `requireLegacyBrowserStore`, the whole-document
  `saveLeague` / `insertLeague` / `saveLiveTournament` ports and `CalendarEventRepository` are
  deleted. `LEAGUE_BACKEND` and `LIVE_BACKEND` bind to the API adapter, and nothing else exists to
  bind to.
- The browser-store Calendar and Event pages, the local Deck Archetype editor, the local Player
  rename and the migration-bundle export are deleted. `/events/:slug` still redirects into the
  Calendar V1 detail so existing links resolve.
- `authV1` and `adminV1` remain real capability flags — they gate routes, not data ownership — and
  both now default to on.

**The declaration itself is kept, and it is still validated.** `dataMode` is a single-valued field
rather than an assumption, so a host that still injects `GONES_DATA_MODE=legacy-browser` at container
start is refused with `dataModeUnknown` at all three layers — the build-time checker, the
container-start gate and the browser resolver — instead of being served a build that means something
else. `ops/frontend-data-authority.test.ts` feeds the retired value to all three and asserts they
reject it identically.

**The repository default is the modern build.** `src/environments/environment*.ts`,
the Dockerfile build arguments and `scripts/build-release-images.mjs` all declare `server`, with
`authV1` and `adminV1` on and the local Compose API as the default origin. A release is API-connected
because that is the only thing it can be, not because someone remembered a flag.

**`npm run dev` starts the whole thing.** It brings up `postgres`, `migrator`, `api` and `worker` in
Docker, waits for `/health/ready`, then serves the app against that origin. `npm run dev:serve` is
the bare dev server for when an API is already running, and `--no-docker` does the same through the
main entry point.

## Consequences

- Browser `localStorage` now holds preferences and the anonymous public read cache only — never
  canonical data. `server-authority-boundary.test.ts` asserts the canonical store keys and the
  adapter import appear in **no** source file, so the store cannot be reintroduced quietly.
- **There is no longer any way to produce a migration bundle.** The import CLI (C37/C38) still reads
  and applies bundles, and `migration:smoke` still rehearses it, but the browser exporter that
  produced them is gone. Bundles not already exported cannot be recovered without reverting this
  commit. This was the owner's explicit call: the data is already out as JSON.
- Deployments that are still serving the frozen static build keep working — they are serving an
  already-built artifact — but they can never be rebuilt from this revision. There is no supported
  path back to a browser-authority build.
- The TypeScript Swiss pairing, standings and checkpoint engine is no longer executed by the app; it
  remains as the golden-parity reference the C# implementation is tested against, which is what it
  was really for.
- Non-Admin users cannot add Deck Archetypes to their own autocomplete list. That was already true
  of every server-mode build before this change — the local editor was only ever reachable in legacy
  mode — and the Admin catalog is the supported route.
- ADR 0008 ("browser store as temporary source of truth") is retired rather than amended: the
  temporary arrangement it described has ended. ADR 0004's centralized-storage rule now governs
  preferences and the read cache only. ADR 0006's bridge survives with exactly one adapter, which is
  worth keeping for the seam it gives the tests.
