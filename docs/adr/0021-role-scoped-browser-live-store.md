# Role-Scoped Browser Live Store

## Status

Accepted. Narrows ADR 0020 for the Live Tournament capability only. Leaves ADR 0020 intact for
League, Calendar, auth, organizer and admin.

## Context

ADR 0020 retired the browser data authority: the API database owns everything, and the browser keeps
only language, view preference, filters and the anonymous public read cache.

The product owner then asked for something ADR 0020 cannot serve: **anyone** — anonymous visitor
included — must be able to start and run a Live Tournament. The server-side Live command surface sits
behind `AuthorizationPolicies.Organizer` and every write is an intent command guarded by a document
version and an owning identity. Three ways to satisfy the request:

1. **Anonymous writes to the server.** Needs an ownership token invented for anonymous callers,
   stored somewhere the browser can hold it, replayed on every command. That is a second, weaker
   authorization scheme bolted onto the one endpoint set — exactly the dual-rules cost ADR 0020 was
   written to remove.
2. **Public writes, no ownership.** Anyone edits anyone's running tournament. Not acceptable.
3. **Split the authority by role.** Privileged users keep the server. Everyone else gets a store the
   server never sees.

The Live domain is already pure and complete in TypeScript (`src/app/domain/live-tournament.ts`:
pairing, standings, checkpoints, finalize). A browser-local adapter composes those functions; it
invents no rules.

## Decision

**Live Tournament has two authorities, chosen by the caller's role at injection time.**

- `Organizer` and `Admin` → `AspNetApiBackend`, unchanged. Server-authoritative, audited, shareable.
- Anonymous and `User` → `LocalLiveBackend`, an IndexedDB store (`gones-live` / `tournaments`).
  Strictly offline. No request is ever made. No sync, in either direction, ever.

Selection is `resolveLiveBackendMode(authority, globalRole)`. It still refuses a non-server
authority, so ADR 0020's failure-closed startup is preserved.

Consequences of the split, accepted deliberately:

- **Synchronisation is a privilege.** Being able to put a Live Tournament on the server is what
  `Organizer` means now. This is the product rule, not an implementation detail.
- **No migration.** A plain user's server-side Live tournaments are not pulled into the local store,
  and local tournaments are never pushed up.
- **Finalize differs.** The server path writes the finished tournament into a League Archive. The
  local path cannot; it produces the same `TournamentDocument` and hands it to the user as a JSON
  download. The runner says so in its copy.
- **The role is read once.** The port resolves from the profile `AuthService.bootstrap()` loaded
  before the first route rendered. A role granted mid-session takes effect on the next reload.

## Consequences

- `LEAGUE_BACKEND` still binds to the API and nothing else. Leagues did not move.
- `server-authority-boundary.test.ts` gains a containment test: `indexedDB` may appear in
  `src/app/backend/indexed-db.ts` and `src/app/backend/local-live-backend.service.ts`, nowhere else.
  The `localStorage` allowlist is unchanged by this ADR.
- The retired `local-frontend-backend.service` name stays banned. The new adapter is a different
  file with a different scope, and the tests assert both facts by name.
- A local tournament lives in one browser profile. Clearing site data destroys it. The user is told.
- `AGENT.md`'s single-authority paragraph now names this exception explicitly, because an agent
  reading only that file would otherwise delete the local adapter on sight.
