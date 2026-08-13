# T4: Split Demo Events + Purpose Accounts

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`
**Depends:** T3
**Commit outcome:** `demo` env resets/seeds single-format Events + 7 literal purpose accts; Gones Organizer has one registration; generated docs match fixtures.

## Context (self-contained)

- Goal: useful, truthful demo data. Existing grouped Event = multiple real tournaments → split per format.
- This slice: local fixtures/seeder/docs only.
- Out of scope here: prod migration; minimal/default/Cypress acct rename; duplicate registrations across split children.
- Assumptions in force: app unreleased/local-only. Reset allowed. Existing registrations move to first catalog-sorted child (`legacy`). Split children clone date/org/venue/capacity; stored title remains base title; slug includes format; summaries/bodies become format-specific.

## Requirements

- Demo 9 Events → 16 Events: 4 existing single-format + split 2+2+2+2+4.
- Every `formatKeys` has length 1.
- Split fixture key = `{source-key}-{format-slug}`. API derives slug `{base-title-slug}-{format-slug}` from T3 exact-one format. Stored title = original base title.
- Registrations on grouped rows move to Legacy child only.
- Literal roster/email=username local part:
  - `admin-empty@gones.test`
  - `organizer-gones-one-registration@gones.test`
  - `organizer-aura-live-standings@gones.test`
  - `user-four-registrations@gones.test`
  - `user-two-registrations@gones.test`
  - `user-empty@gones.test`
  - `user-unverified@gones.test`
- Gones Organizer registers for `aura-spring-classic-legacy`.
- User registration counts: 4/2/0. Unverified 0.

## Inputs

- `fixtures/dev-environments/demo/{accounts,organizations,tournaments,registrations,live-tournaments}.json`.
- `scripts/dev-environments.mjs` — `validateEnvironment()`.
- `scripts/seed-dev-environment.mjs` — Event preview/publish, registrations; no caller-supplied slug.
- `scripts/generate-demo-accounts-doc.mjs`; `DEMO_ACCOUNTS.md`.
- `ops/dev-environments.test.ts`; `ops/demo-accounts-doc.test.ts`.
- **From Depends:** T3 API requires exactly one `formatIds` + accepts optional URLs. Browser form/client compiles.

## TDD

1. **Red** — fixture validator rejects 0/2 formats, malformed/duplicate split keys, dangling renamed email refs.
2. **Red** — shipped demo assertions: 16 Events, every one format, exact split key set + expected server-derived slug set, format-specific text excludes sibling format names.
3. **Red** — roster asserts exact 7 emails/usernames/roles/verification/org ownership/Live organizers/registration counts.
4. **Green** — edit fixtures; keep seeder server-owned slug path; regenerate doc.
5. **Refactor** — calendar fixture variable/log language to Event where safe; keep filename `tournaments.json` historical per ADR 0030 unless changing loader contract is needed.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| Event fixture | all demo rows | 16, exact-one format, unique split key + derived slug |
| split metadata | source vs children | same date/venue/capacity/org |
| text | split child body/summary | only child format described |
| registrations | grouped refs | Legacy child only |
| acct roster | 7 rows | exact purpose names + counts |
| doc gen | fixtures | byte-equal `DEMO_ACCOUNTS.md` |

## Impl steps

- [x] 1. Add exact-one format + split-key validation in `scripts/dev-environments.mjs`; compute expected slug from base title + format slug in tests, not fixture payload.
- [x] 2. Extend `ops/dev-environments.test.ts` with 16-row/split/metadata/text/registration assertions.
- [x] 3. Keep `scripts/seed-dev-environment.mjs` payload server-owned: send title + one format only; assert returned slug matches computed `{base-title-slug}-{format-slug}` in tests/seed validation.
- [x] 4. Split `aura-winter-open`, `pauper-night`, `aura-spring-classic`, `commander-social`, `aura-summer-open` in `tournaments.json`.
- [x] 5. Rewrite each split summary/body to mention only its format. Preserve base title, source dates/venue/capacity/org.
- [x] 6. Rename 7 `accounts.json` rows to literal roster; set usernames = local parts; preserve roles + unverified flag.
- [x] 7. Update email refs in `organizations.json`, `tournaments.json`, `live-tournaments.json`, `registrations.json`.
- [x] 8. Set registrations: `user-four` 4 Legacy-child Events; `user-two` 2; `user-empty` 0; Gones Organizer 1 at `aura-spring-classic-legacy`.
- [x] 9. Update `ops/demo-accounts-doc.test.ts` exact roster/org/unverified/registration-purpose assertions.
- [x] 10. Run `npm run docs:demo-accounts`; never hand-edit generated table.
- [x] 11. Update `docs/adr/0030-file-driven-local-dev-environments.md` demo counts + single-format rule.
- [x] 12. Reset + seed `demo`; verify 16 Events + exactly 7 registrations: `user-four` 4, `user-two` 2, Gones Organizer 1, all other demo accts 0.

## Outputs

- Demo fixture data + generated `DEMO_ACCOUNTS.md`.
- Seeder asserts deterministic server-derived slug; fixture never supplies slug.
- No release artifact reads fixtures.

## Validation

- [x] `npx vitest run ops/dev-environments.test.ts ops/demo-accounts-doc.test.ts` → exit 0.
- [x] `npm run docs:demo-accounts && git diff --exit-code -- DEMO_ACCOUNTS.md` after generated file staged/accepted → no generator drift.
- [x] `npm run dev -- --env=demo` → reset/seed succeeds; expect 16 Events + exact fixture registration count.
- [ ] manual check: every purpose acct logs in with `Gones-dev-pass-123!`; Gones Organizer sees own registration.
- [x] `npm run typecheck && npm run build` → exit 0.
- [x] app functional — Calendar seeded; Live + League fixtures resolve renamed owners.
- [x] commit msg draft: `test(fixtures): split demo events and name purpose accounts`
