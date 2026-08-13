# T6: Calendar List Register Resume

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`
**Depends:** T5
**Commit outcome:** Calendar list cards show green Register where relevant; anonymous intent survives login/signup, rechecks eligibility, confirms, registers once.

## Context (self-contained)

- Goal: list-view registration + requested card cleanup.
- This slice: Calendar list card + auth-return intent. Detail registration from T5 remains.
- Out of scope here: bulk capability endpoint; persistent local pending intent; auto-register before confirmation.
- Assumptions in force: anonymous card shows Register. Intent encoded only in sanitized internal return URL. After auth, capability rechecked; ineligible reason shown; intent cleared after cancel/attempt.

## Requirements

- List card removes first status line + standalone date line.
- Start time moves beside Tournament/Event name same row.
- Add to Calendar + green Register share action row.
- Anonymous Register → `/login?returnUrl=<sanitized calendar URL with register slug>`.
- Intent survives Login ↔ Register → verification email link → Verify Email → Login.
- Resume once: locate Event, recheck capability, eligible→confirmation, ineligible→reason, missing→unavailable; strip `register` query via replace URL.
- Signed-in card shows Register only when `canRegister`; registered/ineligible hides it.
- Card action click/Enter/Space never triggers card navigation.

## Inputs

- `src/app/features/calendar/public-calendar.ts`, `.component.ts`, tests.
- `src/app/features/calendar/event-registration.service.ts`.
- `src/app/auth/auth-entry.component.ts`, `auth-return-link.ts`, `return-url.ts`, `registration-gate.ts`.
- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, `AccountLifecycleService.cs`, `AccountLifecycleEndpoints.cs` — registration/resend verification email action URL.
- `backend/tests/Gones.IntegrationTests/LocalIdentityApiTests.cs` — outbox/action-link contract.
- `src/app/shared/dialogs.ts`; registration success dialog.
- **From Depends:** T5 moved detail actions; existing `EventRegistrationService.capability/register` semantics unchanged. T4 fixture includes anonymous-register targets.

## TDD

1. **Red** — list tests: status/date removed, time beside title, action row, green Register, propagation stopped.
2. **Red** — auth + backend tests: safe returnUrl carries `register=<slug>` through login/register req, outbox verification action URL, verify page, login link. Unsafe/off-site return URL never enters email.
3. **Red** — resume tests: capability recheck; no mutation pre-confirm; cancel/ineligible/missing cleanup; mutation exactly once.
4. **Green** — implement max 20 visible-card capability calls + route-intent resume.
5. **Refactor** — pure helpers for transient register query; request generation counter drops stale capability responses.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| anonymous click | Event card | login returnUrl with register slug |
| eligible signed-in | capability true | green Register; confirmation; one POST |
| registered/ineligible | capability false | no button; reason on resumed intent |
| auth chain | login→register→verify→login | same safe returnUrl |
| unsafe return | off-site URL | rejected/fallback |
| stale list req | page/filter changes | old capability ignored |

## Impl steps

- [x] 1. Add pure intent helpers/tests in `src/app/features/calendar/public-calendar.ts`: parse/add/remove `register` while preserving safe internal Calendar query.
- [x] 2. Add signals to `PublicCalendarComponent`: capability map, pending Event ID, message, request generation.
- [x] 3. Load capability for current visible list page after profile/page/filter changes; max list page size 20; failure hides signed-in CTA.
- [x] 4. Add `registerFromCard(item,event)`; always prevent default/stop propagation.
- [x] 5. Anonymous path navigates to login with sanitized return URL.
- [x] 6. Signed-in path rechecks capability immediately; open `ConfirmDialogComponent`; confirmed calls `EventRegistrationService.register(item.id)` once + existing success dialog.
- [x] 7. Resume `register` after catalog + `AuthService.whenSessionReady()`; handle eligible/ineligible/missing; strip transient param after cancel/attempt.
- [x] 8. Extend generated `RegisterRequest` + `EmailAccountRequest` inputs with optional sanitized internal `returnUrl` (max 2048). `LocalIdentityEndpoints.RegisterAsync()`/resend pass it to `AccountLifecycleService.IssueAsync()`; service appends it as encoded `returnUrl` query only after server-side local-path validation. Invalid value omitted.
- [x] 9. Update `AuthEntryComponent` links/nav: carry safe `returnUrl` through Login/Register/Verify Email; submitRegister sends it; resend sends it; verify-login link retains it; successful verification still leads login before resumed registration.
- [x] 10. Add `LocalIdentityApiTests`: registration/resend outbox URL contains encoded safe return; off-site/control-char value absent; existing token hash secrecy unchanged. Run `npm run api:generate` for request fields.
- [x] 11. Update list template: remove status/date lines; backend `displayTitle` + start time row; ICS+Register action row; all new nodes `data-cy`.
- [x] 12. Update `src/styles.css` + EN/FR confirmation/reason labels.
- [x] 13. Extend `cypress/e2e/event-registration.cy.js`: anonymous list→register acct→email verification link→login→return→confirm; capacity change/ineligible path.

## Outputs

- Calendar list registration UX.
- Auth return URL carries non-secret Event intent.
- Identity API gains optional sanitized `returnUrl` only for verification-link continuity; no Event registration mutation occurs in auth endpoints. Up to 20 capability reqs/page accepted V1.

## Validation

- [x] `npx vitest run src/app/features/calendar/public-calendar.test.ts src/app/features/calendar/public-calendar.component.test.ts src/app/features/calendar/event-registration.service.test.ts src/app/auth/auth-entry.register.test.ts src/app/auth/return-url.test.ts` → exit 0.
- [x] `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~LocalIdentityApiTests` → exit 0.
- [x] `npm run api:check` → exit 0.
- [x] `npm run typecheck && npm run build` → exit 0.
- [x] `npx cypress run --spec cypress/e2e/event-registration.cy.js` → exit 0.
- [ ] manual check: anonymous Register through acct creation/verification/login; no surprise mutation.
- [x] app functional — card opens on body; ICS/Register do not navigate.
- [ ] commit msg draft: `feat(calendar): resume confirmed registration from list`
