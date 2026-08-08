# T1: Deps, frontend agent contract, data-cy gate

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** none
**Commit outcome:** New dependencies installed, `src/AGENT.md` states the frontend rules, `docs/DESIGN.md` bans default kickers, and `npm run test` runs a data-cy coverage gate that passes with an explicit retrofit allowlist.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1 (menubar, auth persistence, merged settings, calendar fuzzy search, tournament proposal flow, local Live store, archive rename, data-cy coverage).
- This slice: the frontload ticket. Every human-blocking action (package installs) and every convention future tickets rely on lands here, plus the test that will enforce the `data-cy` rule.
- Out of scope here: touching any component template to add missing `data-cy`; that is T25 and the feature tickets.
- Assumptions in force:
  - **A1** — the attribute is `data-cy`, not `cy-data`. Repo, Cypress specs and 300+ existing selectors use `data-cy`.
  - **A10** — new deps allowed: `fuse.js` (runtime), `country-region-data` and `@etalab/decoupage-administratif` (dev only).
  - **A13** — retrofit is staged behind a `PENDING_DATA_CY_RETROFIT` allowlist so no intermediate commit is blocked.
  - **A11** — plan artifacts live in `ai-artifacts/`, ADRs in `docs/adr/` (lowercase).

## Requirements

- `fuse.js` in `dependencies`; `country-region-data` and `@etalab/decoupage-administratif` in `devDependencies`.
- New file `src/AGENT.md`, the frontend agent contract, holding the `data-cy` rule verbatim.
- Root `AGENT.md` "Repository layout" table gains a row pointing at `src/AGENT.md`.
- `docs/DESIGN.md` gains a named rule and a "Don't" entry: no kicker above a page title by default.
- New test `src/app/shared/data-cy-coverage.test.ts` fails when a component template contains an element without `data-cy` / `[attr.data-cy]`, or when two static `data-cy` values collide inside one file — unless the file is in `PENDING_DATA_CY_RETROFIT`.
- The allowlist is seeded with **every** existing `src/app/**/*.ts` file that contains a `template:` block, so the suite is green on commit.

## Inputs

- `package.json` — scripts already present: `test` (`vitest run`), `lint`, `typecheck`, `build`, `cy:run`, `backend:test`.
- `AGENT.md` — root context file; "Repository layout" markdown table lists `src/`, `backend/`, `ops/`, …
- `docs/DESIGN.md` — 256 lines; `## 3. Typography` has a `### Named Rules` block; `## 6. Do's and Don'ts` has `### Don't:` bullets.
- `src/styles.css:80` — `.kicker { … }` class, kept (still used by `about.component.ts`).
- Component templates are inline: every component uses `template: \`…\`` in its `.ts` file. There are no `.html` templates under `src/app/`.
- **From Depends:** none — first ticket.

## TDD

1. **Red** — write `src/app/shared/data-cy-coverage.test.ts` with the allowlist **empty**; run `npm run test` and watch it list the offending files. Capture that list.
2. **Green** — paste the captured list verbatim into `PENDING_DATA_CY_RETROFIT`; `npm run test` passes.
3. **Refactor** — none needed. Keep the allowlist sorted so later tickets can delete one line cleanly.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `every non-allowlisted template tags every element with data-cy` | all `src/app/**/*.ts` with a `template:` block | empty violation array |
| `rejects an element without data-cy` | inline fixture string `` `<div><button>x</button></div>` `` | `findMissingDataCy(source)` returns `['div', 'button']` |
| `accepts data-cy and [attr.data-cy]` | fixture `` `<div data-cy="a"><button [attr.data-cy]="b">x</button></div>` `` | returns `[]` |
| `ignores structural and svg tags` | fixture `` `<ng-container><ng-template><svg><path d="M0"/></svg></ng-template></ng-container>` `` | returns `[]` |
| `rejects duplicate static data-cy in one file` | fixture `` `<a data-cy="x"></a><b data-cy="x"></b>` `` | `findDuplicateDataCy(source)` returns `['x']` |
| `allowlist holds only files that still exist` | each entry of `PENDING_DATA_CY_RETROFIT` | `existsSync(join(repoRoot, entry))` is `true` |

Run: `npm run test -- data-cy-coverage`

## Impl steps

- [x] 1. Run `npm install fuse.js`.
- [x] 2. Run `npm install --save-dev country-region-data @etalab/decoupage-administratif`.
- [x] 3. Confirm `node -e "require('fuse.js')"` exits 0.
- [x] 4. Create `src/AGENT.md` with exactly these sections: `# Frontend AGENT contract`, `## Test identifiers`, `## Page titles`, `## Component style`. Under `## Test identifiers` write: "Every HTML element rendered by a component template MUST carry a `data-cy` attribute (`data-cy="..."` for static values, `[attr.data-cy]="..."` for computed ones). The value is a unique identifier for that element inside its component: kebab-case, prefixed with the feature (`settings-account-save`, `calendar-search-input`). Structural directives (`ng-container`, `ng-template`, `ng-content`) and inline SVG shape elements are exempt. Enforced by `src/app/shared/data-cy-coverage.test.ts`."
- [x] 5. Under `## Page titles` in `src/AGENT.md` write: "By default DO NOT add a kicker (`<p class=\"kicker\">`) above a page title. Add one only when the page is a sub-page whose parent context is otherwise invisible."
- [x] 6. Under `## Component style` in `src/AGENT.md` write: "Standalone components, Signals, zoneless change detection, Angular Material, inline `template:` strings, i18n through `I18nService.t()` with keys added to BOTH the `en` and `fr` maps in `src/app/i18n/messages.ts`."
- [x] 7. In `AGENT.md`, add a row to the "Repository layout" table immediately after the `src/` row: `| \`src/AGENT.md\` | Frontend agent contract: data-cy rule, title/kicker rule, component style |`.
- [x] 8. In `docs/DESIGN.md`, under `## 3. Typography` → `### Named Rules`, append the bullet: `- **No default kicker** — page titles stand alone. A kicker above an \`<h1>\` is opt-in, never the default.`
- [x] 9. In `docs/DESIGN.md`, under `## 6. Do's and Don'ts` → `### Don't:`, append: `- **Don't** put a kicker above a page title by default; only add one when the parent context is otherwise invisible.`
- [x] 10. Create `src/app/shared/data-cy-coverage.test.ts`. Export two pure helpers from the test file itself: `findMissingDataCy(source: string): string[]` and `findDuplicateDataCy(source: string): string[]`.
- [x] 11. In that file, define `const EXEMPT_TAGS = ['ng-container','ng-template','ng-content','svg','path','defs','g','use','circle','rect','line','polyline','polygon','br','hr'];`
- [x] 12. Implement `templateBlocks(source: string): string[]` — match `` /template:\s*`([\s\S]*?)`\s*\n\s*\}\)/g `` and return capture group 1 for each match.
- [x] 13. Implement `findMissingDataCy`: for each template block, scan opening tags with `` /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g ``; skip when tag is in `EXEMPT_TAGS`; push the tag name when the attribute chunk matches neither `/\sdata-cy\s*=/` nor `/\[attr\.data-cy\]\s*=/`.
- [x] 14. Implement `findDuplicateDataCy`: collect every `` /\sdata-cy="([^"]+)"/g `` value across the file's template blocks; return values seen more than once.
- [x] 15. Implement `componentSourceFiles()`: walk `src/app` recursively, keep `.ts` files that are not `*.test.ts` and whose contents match `/template:\s*`/`.
- [x] 16. Add the six tests from the Test plan table. The repo-wide test iterates `componentSourceFiles()`, skips paths present in `PENDING_DATA_CY_RETROFIT`, and asserts `findMissingDataCy(source)` and `findDuplicateDataCy(source)` are both `[]`.
- [x] 17. Declare `export const PENDING_DATA_CY_RETROFIT: string[] = [];` above the tests, run `npm run test -- data-cy-coverage`, copy the reported repo-relative paths (POSIX separators, e.g. `src/app/features/menu/home-menu.component.ts`) into the array, sorted.
- [x] 18. Re-run `npm run test -- data-cy-coverage` and confirm it passes.
- [x] 19. Run `npm run lint && npm run typecheck && npm run build`.

## Outputs

- Files touched: `package.json`, `package-lock.json`, `AGENT.md`, `docs/DESIGN.md`.
- Files created: `src/AGENT.md`, `src/app/shared/data-cy-coverage.test.ts`.
- Public API / behavior change: none at runtime. New test gate only.
- Migrate / config: none.

## Validation

- [x] `npm run test` passes
- [x] `npm run lint` passes
- [x] `npm run typecheck` passes
- [x] `npm run build` passes
- [x] manual check: deleting one path from `PENDING_DATA_CY_RETROFIT` makes `npm run test -- data-cy-coverage` fail with that file named — then restore it
- [x] app functional — no runtime code changed
- [x] commit msg draft: `chore(frontend): add data-cy contract, kicker rule and calendar-v1 dependencies`
