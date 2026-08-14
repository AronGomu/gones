# T2: Universal Card Hover + Auth Button Alignment

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`  
**Depends:** T1  
**Commit outcome:** Every user-visible card gets shared hover lift/border/shadow; static cards keep default cursor; signin/register OAuth icon + label share centered row.

## Context (self-contained)

- Goal: consistent card feedback + fixed auth button row.
- This slice: visual-only contract, no click behavior changes.
- Out of scope here: making static cards clickable; adding tabindex to static cards; refactoring templates into generic card component.
- Assumptions in force: hover applies all visible card-like surfaces, including static cards. Pointer cursor only existing interactive roots. Touch/reduced-motion safe.

## Requirements

- Global Material cards + custom card roots transition + hover on fine pointer.
- Hover: hot-red border, small upward lift, stronger structural shadow; no `cursor: pointer` in shared rule.
- Existing click/focus behaviors stay intact.
- OAuth buttons’ Material `.mdc-button__label` uses inline flex, middle alignment, one line.

## Inputs

- `src/styles.css` — current home/calendar/League/Live/About/card rules.
- `src/app/auth/auth-entry.component.ts` — `.oauth-button`, label, logo markup.
- `src/app/auth/auth-entry.layout.test.ts` — auth layout contract.
- `src/app/features/calendar/public-calendar.component.test.ts` — card hover/focus contract.
- **From Depends:** T1 leaves auth component markup unchanged; only session behavior changed.

## TDD

1. **Red** — add `src/app/shared/card-hover-contract.test.ts`. Tests: `covers Material cards and every custom card family`; `shared hover never sets pointer cursor`; `fine-pointer hover lifts and shadows`; `reduced motion removes transform`.
2. **Red** — extend `auth-entry.layout.test.ts`: `.oauth-button .mdc-button__label` contains `display:inline-flex`, `align-items:center`, `justify-content:center`, `gap`, `white-space:nowrap`.
3. **Green** — add explicit shared selector inventory; preserve specialized colors after generic rule.
4. **Refactor** — consolidate duplicate transition declarations only where exact behavior matches. Do not touch adjacent component layout.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| Material card | static `mat-card` hover | lift/border/shadow, arrow cursor |
| custom card | home/Event/League/Archive/Live/player/About card | same base hover |
| interactive card | existing link/button card | existing pointer + nav unchanged |
| reduced motion | media pref | no transform motion |
| OAuth button | icon + translated label | same centered row, vertical middle |

## Impl steps

- [x] 1. Inventory exact selectors in `src/styles.css`: `mat-card`, `.home-destination`, `.league-card`, `.tournament-rect-card`, `.running-tournament-card`, `.public-tournament-card`, `.registration-card`, `.organization-card`, `.live-registration-player-card`, `.live-round-card`, `.match-card`, `.about-event`, `.about-person`, `.about-contributor`. Criterion: each selector is accounted for by `src/app/shared/card-hover-contract.test.ts`; `.organization-card` is reserved by the shared inventory despite no current standalone rule.
- [x] 2. Add failing selector/behavior tests in `src/app/shared/card-hover-contract.test.ts`. Criterion: targeted Vitest run fails before production CSS changes, then passes.
- [x] 3. Add failing OAuth wrapper assertions in `src/app/auth/auth-entry.layout.test.ts`. Criterion: targeted Vitest run fails before production CSS changes, then passes.
- [x] 4. Add shared transition + `@media (hover: hover) and (pointer: fine)` hover rule in `src/styles.css`. Criterion: contract test proves transition plus fine-pointer lift, hot-red border, structural shadow, no shared pointer cursor.
- [x] 5. Add `@media (prefers-reduced-motion: reduce)` transform/transition override. Criterion: contract test proves shared card transform and transition are disabled.
- [x] 6. Add `.oauth-button .mdc-button__label` row rule + middle-align `.oauth-button__logo`. Criterion: auth layout test proves inline flex, centered alignment, gap, nowrap, middle logo alignment.
- [x] 7. Keep existing `.public-tournament-card` keyboard/focus behavior; adjust duplicate rules only if tests require. Criterion: `public-calendar.component.test.ts` passes unchanged.

## Outputs

- `src/styles.css` changed.
- `src/app/shared/card-hover-contract.test.ts` created.
- `src/app/auth/auth-entry.layout.test.ts` changed.
- Visual behavior only; no public API/config change.

## Validation

- [x] `npx vitest run src/app/shared/card-hover-contract.test.ts src/app/auth/auth-entry.layout.test.ts src/app/features/calendar/public-calendar.component.test.ts` → exit 0.
- [x] `npm run test` → exit 0.
- [x] `npm run typecheck && npm run build` → exit 0.
- [ ] manual check: home, Calendar list/month, registration/auth, League, Archive Tournament, Live, player, About cards hover consistently; static cursor unchanged. Criterion: unchecked human steps recorded under `## T2 card-hover-auth-button-alignment` in `ai_artefacts/manual_test_checklist.md`.
- [x] app functional — all card links/buttons retain behavior. Criterion: automated layout contracts pass; runtime click behavior remains manual checklist item.
- [x] commit msg draft: `style(cards): unify hover feedback and auth button alignment`. Criterion: published commit uses exact message.
