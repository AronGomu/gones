# Rename the Archived League Feature

## Status

Accepted. Does not amend ADR 0007 (League source data as JSON documents) or ADR 0020's one-way
migration door.

## Context

Gones now has two things called "tournament": the Calendar V1 scheduled tournament that people
register for, and the historical result tournament stored inside a League. The League surface is no
longer the product's front door — it is the archive of past results, kept for standings and player
statistics. Every new reader, human or agent, has to learn that twice.

The product owner asked for the archive to say what it is: `leagues-archive` and
`tournament-archive`.

The question was depth. Labels only would leave `/api/leagues`, `LeagueAggregate` and
`league_aggregates` contradicting the UI. Frontend-only would leave the API contradicting both.

## Decision

**Rename the whole stack**: application routes, frontend folders and symbols, API route templates,
endpoint operation names, domain and EF type names, and the `league_aggregates` table.

Two things are deliberately **not** renamed:

1. **The export bundle format.** `kind: "league"`, `kind: "fullData"` and every JSON field name in
   `src/app/domain/models.ts` and `export-schemas.ts` stay exactly as they are. ADR 0020 left one
   door open — the import CLI applies bundles exported before it — and a wire-format rename would
   slam it. The golden fixtures under `fixtures/league-domain/v1/` are unchanged, byte for byte.
2. **`/api/maintenance/player-names*`.** Cross-league player-name maintenance is not the archive
   feature.

**No API path aliases.** The old routes return `404`. The only client is this repository's frontend,
renamed in the same series, and the OpenAPI snapshot is regenerated with it. An alias would be dead
weight that outlives its reason.

**Frontend redirects, yes.** `/leagues/:id/tournaments/:tid` redirects to
`/leagues-archive/:id/tournaments-archive/:tid` with its parameters preserved. Bookmarks and old
links are a real user's problem; a stale HTTP client is not.

## Consequences

- One EF migration renames the table and its indexes. It is a `RenameTable`, never a drop and
  recreate — EF's default scaffold must be hand-corrected or archived data is lost.
- Operation names change, so the generated client's method names change. `npm run api:generate` must
  run between the backend and frontend commits; the frontend does not compile in between, which is
  why the two land as separate tickets in a fixed order.
- `docs/CONTEXT.md` and `docs/GLOSSARY.md` gain the new vocabulary with the old words kept as
  "formerly" notes, so an agent reading a year-old commit message can still resolve them.
- Live finalize keeps returning a field named `leagueId`. Renaming it would ripple into the local
  Live adapter contract (ADR 0021) for no user-visible gain.
