# T2: Worldwide manual location editor

**Plan:** `./artifacts/PLAN_2026_09_03_create_edit_event_page.md`
**Depends:** T1
**Commit outcome:** Event create/edit provides manual worldwide address controls, country select, and backend-sourced IANA timezone select without provider calls.

## Context

- C1 Goal: zero paid location API while retaining worldwide Event scheduling.
- C2 This slice: Angular controls, timezone catalog loading, EN/FR copy, tests.
- C3 Out: autocomplete, geocoding, maps attribution, provider retry, image/draft work.
- C4 Assumption: user owns address/timezone correctness.

## Requirements

- R1 Inject `GeoService`; load `GeoOption[]` from `assets/geo/countries.json`; render `<select id="event-country">` with every option.
- R2 Use `GeoOption.name` as value. If edit value is absent from asset, append current value as selected fallback.
- R3 Keep manual street, postal code, city, region fields editable and required.
- R4 Load timezone IDs from T1 backend catalog; render required searchable/select control using exact IANA ID as value and label.
- R5 If current edit timezone is absent from catalog, append selected fallback so existing Event remains visible; server still decides write validity.
- R6 Country/timezone catalog loading joins existing reference loading/error/Retry contract.
- R7 Remove autocomplete suggestions, provider attribution, session UUID, resolution status, retry chains, location token, coordinates, and expiry UI/state.
- R8 Create/edit/proposal payloads send six manual location fields including `timeZoneId`; no `/api/event-locations/*` provider calls.
- R9 Preview updates directly from manual form. Publication remains blocked until all location fields valid.
- R10 Add/adjust `data-cy` on every rendered element; add EN + FR keys together.
- R11 Non-retriable catalog failures call `logBoundaryError` and expose existing reference Retry.

## Inputs

- I1 `src/app/features/events/organizer-event-create.component.ts`
- I2 `src/app/features/events/organizer-event-create.component.test.ts`
- I3 `src/app/features/events/organizer-event-create.test.ts`
- I4 `src/app/features/events/organizer-event-create.ts`
- I5 `src/app/features/events/event-management.ts`
- I6 `src/app/features/events/event-management.test.ts`
- I7 `src/app/shared/geo.service.ts`
- I8 `src/app/shared/geo-assets.test.ts`
- I9 `src/assets/geo/countries.json`
- I10 `src/app/i18n/messages.ts`
- I11 `src/app/shared/app-logger.ts`
- I12 `src/app/api/generated/gones-api.ts`
- I13 `cypress/e2e/organizer-event-create.cy.js`
- I14 `cypress/e2e/organizer-event-management.cy.js`
- I15 `src/AGENT.md`
- I16 **From Depends T1:** generated timezone catalog client, `EventLocationInput.timeZoneId`, removed provider endpoints/token fields.

## Interface contract

- P1 `countries = signal<GeoOption[]>([])` and `timeZones = signal<string[]>([])`.
- P2 Country uses canonical visible long name; timezone uses exact backend TZDB ID.
- P3 Catalog failure → `eventCreate.referencesFailed` + Retry.
- P4 Manual change updates preview and payload without hidden provider state.
- P5 Integration: form → generated client payload → T1 backend validation → persisted address/timezone.

## TDD

1. **Red** — tests for country/timezone options, fallback values, catalog failure/Retry, payload, and absence of provider calls/state.
2. **Green** — minimal controls + catalog load + payload changes.
3. **Refactor** — remove only newly orphaned autocomplete/resolution helpers/imports/copy.

## Impl steps

- [ ] 1. Write failing component/payload tests.
- [ ] 2. Load country + backend timezone catalogs through reference state.
- [ ] 3. Replace country input; add timezone select/search control.
- [ ] 4. Remove autocomplete/provider/token/coord/expiry state and DOM.
- [ ] 5. Update create/edit/proposal payloads + preview.
- [ ] 6. Add EN/FR copy + complete `data-cy` coverage.
- [ ] 7. Run focused checks; prove no provider requests.

## Validation

- [ ] V1 tests: `npm run test -- src/app/features/events/organizer-event-create.component.test.ts src/app/features/events/organizer-event-create.test.ts src/app/features/events/event-management.test.ts src/app/shared/geo-assets.test.ts`
- [ ] V2 backend-generated contract consumed: `npm run api:check`
- [ ] V3 no silent failure: catalog catch logs + visible reference Retry; list exact lines.
- [ ] V4 app functional: `npm run typecheck && npm run lint && npm run build`
- [ ] V5 manual: create/edit with `Europe/Paris`; invalid/missing timezone blocks publish; no autocomplete/network provider traffic.
- [ ] V6 commit msg draft: `feat(events): add manual worldwide location editor`
