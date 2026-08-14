# T3: Single-Format Event Contract + Tournament URLs

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`
**Depends:** T2
**Commit outcome:** Event create/update/persistence accepts exactly one active format + optional Live/Archive Tournament URL strings; OpenAPI/client/form compile.

## Context (self-contained)

- Goal: one Event represents one single-format tournament concept; optional simple links point to Live/Archive Tournament pages.
- This slice: backend/domain/DB/API/frontend form contract. Demo splitting comes T4; display comes T5.
- Out of scope here: FK/existence checks; URL reachability; prod-safe multi-format migration; Event detail layout.
- Assumptions in force: app unreleased/local-only; DB reset allowed. Keep `formatIds` wire array + `event_formats` table for min diff, require length exactly 1. URLs accept app-relative `/...` + absolute `http(s)://...`, broken dest allowed.

## Requirements

- Domain/API enforce exactly one format. DB unique index enforces max one row; domain-owned writes guarantee required row. Remove `legacy` requirement.
- Add nullable `LiveTournamentUrl`, `ArchiveTournamentUrl`, max 2048.
- URL normalizer accepts blank→null, `/path`, HTTP(S). Reject `//host`, backslash, ctrl chars, other schemes.
- Detail/preview/management DTOs carry URLs. Every Event response carries backend-derived `displayTitle = "{Format} — {base title}"`; persisted `Title` stays base title. Calendar summary stays URL-free.
- New Event slug base = `{EventSlugGenerator.FromTitle(title)}-{singleFormat.Slug}`; helper truncates title prefix so final slug stays ≤ `Event.MaximumSlugLength`; this gives format-specific slugs without exposing caller-controlled slug input.
- Referenced format cannot be soft-deleted. `AdminCatalogService.SoftDeleteAsync()` returns conflict while any active/nondeleted Event references it; existing Event never becomes stranded on inactive format.
- Browser form uses one format selector + 2 URL inputs.

## Inputs

- `backend/src/Gones.Domain/Calendar/Event.cs` — `ScheduledTournamentDraft`, `Event`, `NormalizeDraft()`.
- `backend/src/Gones.Domain/Catalog/TournamentFormat.cs` — `TournamentFormatSelection.RequireLegacyForV1()`.
- `backend/src/Gones.Infrastructure/Persistence/EventRecordConfigurations.cs`.
- `backend/src/Gones.Api/Events/EventPublicationEndpoints.cs` — `EventPayloadRequest`.
- `backend/src/Gones.Api/Events/EventLifecycleEndpoints.cs` — `UpdateEventDetailsRequest`, management/audit DTO.
- `backend/src/Gones.Api/Events/PublicEventEndpoints.cs`.
- `src/app/features/calendar/organizer-event-create.ts`, `.component.ts`, `event-management.ts`.
- **From Depends:** T2 changed CSS/tests only; no Event API/symbol changes.

## TDD

1. **Red** — `ScheduledTournamentDomainTests`: zero/two formats reject; one active format succeeds; non-Legacy succeeds; URL accept/reject matrix.
2. **Red** — publication/lifecycle API tests: 0/2 `formatIds` → 400 `errors.formatIds`; one → success; links round-trip.
3. **Red** — persistence test: second `event_formats` row for same Event fails unique constraint.
4. **Red** — frontend tests: single `formatId`; payload emits `[formatId]`; links trim blanks + map edit/preview.
5. **Green** — implement domain, migration, endpoints, form; regenerate API once.
6. **Refactor** — rename validator to exact-one semantics; update stale “V1 tournaments require Legacy” docs/tests.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| exact one | 0, 1, 2 active formats | reject, accept, reject |
| format catalog | Modern only | accepted |
| URLs | null/blank/relative/http/https/unsafe | normalized or rejected |
| persistence | second EventFormat row | DB constraint failure; zero-row impossible through domain writes |
| catalog lifecycle | delete referenced format | 409; Event remains valid/editable |
| slug bound | max title + max format slug | deterministic slug ≤ 120 chars |
| API | preview/publish/update/detail | URL fields round-trip |
| form | select format + links | generated req compiles |

## Impl steps

- [x] 1. Add exact-one + URL unit tests in `backend/tests/Gones.UnitTests/ScheduledTournamentDomainTests.cs` and `TournamentFormatTests.cs`.
- [x] 2. In `Event.cs`, extend `ScheduledTournamentDraft`; add properties/constants; implement `EventTournamentUrl.NormalizeOptional()`; replace `RequireLegacyForV1()` with exact-one active validation.
- [x] 3. Update `TournamentFormatSelection` in `backend/src/Gones.Domain/Catalog/TournamentFormat.cs`; keep shared catalog active check. Add referenced-format delete conflict in `backend/src/Gones.Api/Admin/AdminCatalogService.cs` + focused admin catalog integration test.
- [x] 4. Map URL cols + unique `EventFormat.EventId` index in `EventRecordConfigurations.cs`.
- [x] 5. Generate EF migration `EnforceSingleEventFormatAndAddTournamentLinks`; verify add cols/index only; no split/data copy.
- [x] 6. Extend `EventPayloadRequest`, `UpdateEventDetailsRequest`, preview/management/detail responses + audit hash/diff in Event endpoint files. Add `DisplayTitle` to summary/detail/preview/management responses from one helper; derive new slug via `FromTitleAndFormat(title, formats.Single().Slug)`, truncating base-title segment before suffix.
- [x] 7. Add/update API tests: `EventPublicationApiTests.cs`, `EventLifecycleApiTests.cs`, `PublicEventApiTests.cs`, persistence test.
- [x] 8. In `organizer-event-create.ts`, replace `formatIds` draft control with `formatId`; payload keeps `formatIds: [formatId]`; add link fields.
- [x] 9. In `organizer-event-create.component.ts`, use one select (no `multiple`) + `type="url"` inputs with `data-cy`.
- [x] 10. Update `event-management.ts` mappings/stale diff + focused tests.
- [x] 11. Add EN/FR format/link labels/errors in `src/app/i18n/messages.ts`.
- [x] 12. Run `npm run api:generate`; commit `backend/openapi/gones.json` + `src/app/api/generated/gones-api.ts`.
- [x] 13. Before applying migration to current local stack, run `npm run db:reset`; reseed minimal/demo only after T4 fixture update. Verify T3 app compiles and empty/minimal local stack starts.
- [x] 14. Write `docs/adr/0036-single-format-events-and-tournament-links.md`; update `docs/CONTEXT.md`, `docs/GLOSSARY.md`.

## Outputs

- Backend Event contract + EF migration.
- OpenAPI/client regenerated.
- Event create/edit form exact-one + link fields.
- Public API: `liveTournamentUrl?: string`, `archiveTournamentUrl?: string` on detail/management/preview; `displayTitle` on every Event response.

## Validation

- [x] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ScheduledTournamentDomainTests|FullyQualifiedName~TournamentFormatTests|FullyQualifiedName~EventPublicationApiTests|FullyQualifiedName~EventLifecycleApiTests|FullyQualifiedName~PublicEventApiTests"` → exit 0.
- [x] `npx vitest run src/app/features/calendar/organizer-event-create.test.ts src/app/features/calendar/organizer-event-create.component.test.ts src/app/features/calendar/event-management.test.ts` → exit 0.
- [x] `npm run api:check` → exit 0.
- [x] `npm run typecheck && npm run build` → exit 0.
- [x] `npm run db:reset` → exit 0 before migration runtime check; local stack starts without preexisting multi-format rows.
- [x] manual check: create/edit Event with one format + each link type; referenced-format deletion conflicts; unsafe scheme refused.
- [x] app functional — Calendar list/detail load against generated API.
- [x] commit msg draft: `feat(events): enforce one format and add tournament links`
