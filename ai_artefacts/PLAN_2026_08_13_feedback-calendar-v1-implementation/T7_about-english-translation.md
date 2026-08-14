# T7: Full About English Translation

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`
**Depends:** T6
**Commit outcome:** `/about` renders complete English or French content from active locale; no forced French body/label remains.

## Context (self-contained)

- Goal: fix French About card/body while app is English.
- This slice: About route content only. Homepage ordering comes T15.
- Out of scope here: rewriting About facts; translating person/brand names/URLs.
- Assumptions in force: current French content is source meaning; translate it faithfully. Both locale maps complete.

## Requirements

- Remove `host: { lang: 'fr' }`; bind lang to current locale.
- Replace every user-visible French literal with `I18nService.t()` or localized computed data.
- Preserve names, social URLs, image paths.
- About menu label/desc EN become English now; T15 reorders card later.

## Inputs

- `src/app/features/menu/about.component.ts` — hardcoded body/arrays.
- `src/app/i18n/messages.ts` — EN/FR catalogs; About home keys currently French in EN.
- `src/app/features/menu/home-menu.component.ts` — About card forced `lang`/keys.
- **From Depends:** T6 auth/calendar only; About files unchanged.

## TDD

1. **Red** — create `about.component.test.ts`: no forced French lang; representative hero/sections/roles/contributor/contact use keys; EN/FR keys exist.
2. **Red** — home test: English About label/desc; no `lang="fr"` on card.
3. **Green** — inject i18n + convert literal arrays to key-backed computed view models.
4. **Refactor** — group keys under `about.*`; avoid HTML translation blobs when structured markup exists.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| EN locale | `/about` | all headings/body/aria English |
| FR locale | `/about` | original French meaning |
| host lang | locale switch | `en`/`fr` follows signal |
| stable proper data | names/URLs/images | unchanged |
| home card | EN/FR | translated label + desc |

## Impl steps

- [x] 1. Add `src/app/features/menu/about.component.test.ts` with key parity + no-hardcoded-French representative assertions.
- [x] 2. Inject `I18nService` in `AboutComponent`; bind host `[attr.lang]` to locale signal.
- [x] 3. Convert hero, intro, numbers, weekly Events, Fire/Ice seasons, team roles/bios/placeholders, contributors, contact/social aria copy to `about.*` keys.
- [x] 4. Keep proper nouns/assets as data; localized descriptors become key refs resolved in computed/template.
- [x] 5. Add every key to EN + FR in `messages.ts`; fix existing EN `home.about*` + breadcrumb keys.
- [x] 6. Remove forced French attr from About homepage card in `home-menu.component.ts`.
- [x] 7. Update `home-menu.component.test.ts` + i18n catalog tests.

## Outputs

- About component + catalog fully bilingual.
- New focused test.
- No API/data change.

## Validation

- [x] `npx vitest run src/app/features/menu/about.component.test.ts src/app/features/menu/home-menu.component.test.ts` → exit 0.
- [x] `npm run test` → exit 0.
- [x] `npm run typecheck && npm run build` → exit 0.
- [ ] manual check: switch EN/FR while on `/about`; full page changes; names/assets stable.
- [ ] app functional — About links/images still work.
- [x] commit msg draft: `feat(about): translate full page into English`
