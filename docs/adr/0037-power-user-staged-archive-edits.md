# Power User Capability and Staged Archive Edits

## Status

Accepted. Implemented by T8–T13 in `ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`.

## Context

Advanced League Archive, Archive Tournament, Live Tournament, and Event mutation controls overwhelm regular browse workflows. Product wants browser-local opt-in without hiding destinations. Product also wants Archive Tournament pages read-only until explicit Edit, then one confirmed Save Changes.

Power preference cannot grant server privilege. ADR 0021/0028 authority boundaries + Organizer/Admin API policies remain binding. Current Archive editor sends many immediate commands; one staged session needs atomic explicit intent without introducing whole-document save.

## Decision

### Power User

- Browser-local key `gones.settings.power-user`; default false; usable signed out.
- UX capability only. Never role/claim/security boundary.
- Mode off keeps browse/export/registration/Settings available.
- Mode off blocks advanced Event source-data mutations in shipped UI/routes (create/edit/publish/cancel/delete), every League Archive/Archive Tournament mutation at UI/repository, and every Live Tournament mutation at UI/repository.
- Event registration remains available. Existing regular-User proposal API remains callable but hidden from shipped UI/routes. Event create/edit UI additionally requires verified Organizer/Admin.
- Local browser owns all local Archive Tournaments. Any Organizer/Admin may edit server Archive Tournaments.

### Staged Archive edit

- Archive Tournament page starts read-only for everyone.
- Authorized Power User clicks Edit, mutates memory draft, then Save Changes.
- Staged scope: name, date, same-authority League move, rounds, entries/imports, archetypes.
- Whole Tournament/League deletion remains separate.
- Save sends fixed explicit intent batch + expected source/target versions. No whole doc req.
- Server endpoint is `POST /api/leagues-archive/{id}/tournaments-archive/{tournamentId}/edit-batch`. Source `If-Match` is mandatory. `targetLeagueId` plus `Target-If-Match` are present together only for a move.
- Server locks source/target rows in deterministic League-id order, validates both versions before transforms, calls aggregate `Apply` once per changed League, then saves/commits once.
- Local adapter reads, validates, transforms, and puts source/target rows in one IndexedDB `readwrite` transaction. Request/action failure aborts; results become visible only after transaction completion.
- Same-authority move only; no sync/cross-authority move.
- Stale/validation failure writes nothing. 412 preserves draft; discard needs confirmation; no auto-merge.
- Round/entry deletion summarized once in final save dialog.
- Empty Save exits edit mode without a repository call. Cancel Edit discards only after confirmation when dirty.
- Validation, network, and 412 failures retain the single in-memory draft. Reload Latest never merges or retries: cancellation keeps the draft; confirmation reloads authoritative versions, discards it, and exits.
- A successful same-League batch adopts `sourceLeague`. A move adopts `destinationLeague`, refreshes source readers, and navigates to the destination route.

## Consequences

- Frontend pref can be bypassed by custom HTTP calls; server role policies still protect server data.
- Signed-out Power User may mutate local stores.
- Existing local move becomes atomic; ADR 0028 non-atomic consequence must be amended when shipped.
- Same-League batch returns `{ sourceLeague, destinationLeague: null }` with one version bump. Move returns both authoritative documents/ETags with one bump each.
- Current immediate Archive content commands remain API-compatible but editor stops using them.

## References

- ADR 0010 — Optimistic Concurrency
- ADR 0021 — Role-Scoped Browser Live Store
- ADR 0028 — Dual-Source League Archive
- `src/app/data/league-archive-repository.service.ts`
- `src/app/features/tournaments-archive/tournament-archive-detail.component.ts`
