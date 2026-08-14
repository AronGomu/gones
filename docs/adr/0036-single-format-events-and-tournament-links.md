# Single-Format Events and Optional Tournament Links

## Status

Accepted. Implemented by T3–T7 in `ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`. Finalized T15.

## Context

ADR 0035 renamed Calendar record to Event, retained many-format shape, deferred Event-as-container model. Product rule now tighter: one Event represents one tournament concept; one tournament has exactly one format. Existing local demo rows grouped multiple tournaments under one Event.

Calendar Event may point users toward corresponding Live Tournament and Archive Tournament pages. Those targets may not exist yet or may later break. Relationship is navigation, not data authority.

Gones is unreleased; no prod env exists. Local DB reset + fixture reshape accepted until `AGENT.md` release-state note changes.

## Decision

- Event has exactly one active Tournament Format.
- Keep `formatIds` wire array + `event_formats` table for minimal compatibility. Domain/API enforce exactly one; DB unique index enforces at most one. All writes remain domain-owned, so zero rows cannot be produced through supported commands.
- Remove V1 Legacy-format requirement. Any active catalog format valid.
- Persist optional `liveTournamentUrl` + `archiveTournamentUrl`, max 2048.
- Links are strings, never FK. No existence/reachability check.
- Accept app-relative `/...` + absolute HTTP(S). Reject protocol-relative, backslash, control chars, other schemes.
- Persist base Event title. Backend derives public `displayTitle = "{Format} — {Title}"`.
- Backend derives new slug `{title-slug}-{format-slug}` and truncates title prefix so total stays within max length.
- Format soft-delete conflicts while any active/nondeleted Event references it. Existing Events never become stranded on inactive format.
- Existing local multi-format rows are reset before this constraint applies. T4 reshapes demo fixtures into one Event per format; registration placement and fixture-specific text belong to that follow-up.

## Consequences

- Local DB reset needed before unique Event-format index when multi-format rows exist.
- No prod migration guarantee exists under current unreleased state.
- Broken optional links are valid by design.
- Event remains distinct from Live Tournament + Archive Tournament; no sync/lifecycle coupling.
- List/detail clients consume backend `displayTitle`; they do not reconstruct it.

## References

- ADR 0035 — Calendar Event Vocabulary
- `backend/src/Gones.Domain/Calendar/Event.cs`
- `backend/src/Gones.Infrastructure/Persistence/EventRecordConfigurations.cs`
- `fixtures/dev-environments/demo/tournaments.json`
