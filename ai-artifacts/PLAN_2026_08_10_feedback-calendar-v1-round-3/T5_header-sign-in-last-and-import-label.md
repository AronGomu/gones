# T5: Header sign-in last + import label

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** none
**Commit outcome:** On every page, the sign-in / profile-and-logout block is the right-most thing in the header, after the page's own actions. The League Archive import button reads "Importer ligue(s)" / "Import league(s)".

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice covers two lines:
  - #6 — "On every single page of the application, the login button should be at the absolute right of the header. For example, on the leagues archive page, move its position to the right of the other two buttons."
  - #5 — "Rename the button 'Importer 1+ ligues' to 'Importer ligues' (with the final S in parentheses) to show that you can import one or more files."
- This slice: reorder two blocks in the app shell template and change one i18n pair. Nothing else.
- Out of scope here: what the header actions themselves do; the breadcrumb bar; the auth pages; any other label.
- Assumptions in force: every user-facing string exists in **both** the `en` and the `fr` map of `src/app/i18n/messages.ts`. This repo has no TestBed — component tests assert on the template source string.

## Inputs

- `src/app/app.component.ts` — the shell. Current header order inside `<mat-toolbar class="app-toolbar" …>`:
  1. `<a class="brand" routerLink="/" …>` — logo.
  2. `<span class="spacer" data-cy="app-header-spacer"></span>`.
  3. `@if (auth.enabled) { <div class="auth-toolbar-actions" data-cy="auth-toolbar-actions"> … </div> }` — holds `data-cy="profile-link"` + `data-cy="logout-button"` when signed in, `data-cy="toolbar-sign-in-link"` when signed out.
  4. A single `@if / @else if` chain of page-scoped action groups, in this order: `showLiveTournamentActions()` → `data-cy="app-live-tournament-header-actions"`; `showHeaderImport()` → `data-cy="app-leagues-header-actions"` (holds `data-cy="app-leagues-import-button"`, the hidden `#headerImportInput`, and `data-cy="app-full-data-export-button"`); `headerTournament()` → `data-cy="app-tournament-header-actions"`; `headerLeague()` → `data-cy="app-league-header-actions"`; `showSettingsActions()` → `data-cy="app-settings-header-actions"`.
- `src/styles.css` — `.spacer` pushes everything after it to the right; `.header-actions` and `.auth-toolbar-actions` are the two flex groups involved.
- `src/app/i18n/messages.ts` — line ~62 `'common.import': 'Import 1+ league'` (en) and line ~1114 `'common.import': 'Importer 1+ ligue'` (fr). `'common.importing'` is a separate key and is **not** changed.
- `src/app/app.component.auth-entry.test.ts` — existing shell test file; add to it rather than creating a new one.
- **From Depends:** none.

## Requirements

- Move the whole `@if (auth.enabled) { <div class="auth-toolbar-actions" …> … </div> }` block so it comes **after** the page-scoped `@if / @else if` chain and immediately before the closing `</mat-toolbar>`.
- Keep the `<span class="spacer">` where it is — it still pushes the first action group right; the auth block then trails it.
- Add `.auth-toolbar-actions { margin-left: .75rem; }` to `src/styles.css` so the auth block is visually separated from the page actions it now follows. Put it next to the existing `.auth-toolbar-actions` rule if one exists, otherwise directly after the `.header-actions` rule.
- Change `'common.import'` to `'Import league(s)'` (en) and `'Importer ligue(s)'` (fr). Change nothing else about that button.

## TDD

1. **Red** — add the three tests below. The order test fails against today's template; the label tests fail against today's strings.
2. **Green** — move the auth block, add the CSS rule, edit the two i18n entries.
3. **Refactor** — none needed.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the auth block is the last thing in the toolbar` (in `src/app/app.component.auth-entry.test.ts`) | `source.indexOf('data-cy="auth-toolbar-actions"')` vs the index of each of `app-live-tournament-header-actions`, `app-leagues-header-actions`, `app-tournament-header-actions`, `app-league-header-actions`, `app-settings-header-actions` | the auth index is greater than every one of them |
| `nothing but the toolbar close follows the auth block` (same file) | `source.slice(source.indexOf('data-cy="auth-toolbar-actions"'))` up to `'</mat-toolbar>'` | contains no `data-cy="app-` action-group identifier |
| `the import label names one or more leagues` (new file `src/app/i18n/import-label.test.ts`) | `messages.en['common.import']`, `messages.fr['common.import']` | `'Import league(s)'` and `'Importer ligue(s)'`; neither contains `'1+'` |

If `src/app/i18n/messages.ts` does not export the two maps under names usable from a test, assert on
the file source instead: `expect(source).toContain("'common.import': 'Importer ligue(s)'")` and
`expect(source).not.toContain('1+')`. Pick whichever the existing i18n tests already do.

Run: `npx vitest run src/app/app.component.auth-entry.test.ts src/app/i18n`

## Impl steps

- [x] 1. Add the two order tests to `src/app/app.component.auth-entry.test.ts`. Evidence: added `the auth block is the last thing in the toolbar` and `nothing but the toolbar close follows the auth block`.
- [x] 2. Create `src/app/i18n/import-label.test.ts` with the label test. Evidence: file created, asserts `catalogs.en['common.import']`/`catalogs.fr['common.import']`.
- [x] 3. Run `npx vitest run src/app/app.component.auth-entry.test.ts src/app/i18n` — confirm red. Evidence: 3 failed / 3 passed (order test, tail test, label test all red as expected).
- [x] 4. In `src/app/app.component.ts`, cut the `@if (auth.enabled) { … }` block containing `data-cy="auth-toolbar-actions"` and paste it after the last `@else if` branch of the page-action chain, still inside `<mat-toolbar>`. Evidence: `grep -n` shows `auth-toolbar-actions` at line 78, after `app-settings-header-actions` (line 71), before `</mat-toolbar>` (line 87).
- [x] 5. In `src/styles.css`, add `.auth-toolbar-actions { margin-left: .75rem; }` (merge into the existing rule if there is one). Evidence: merged into existing rule — `.auth-toolbar-actions { display: inline-flex; align-items: center; gap: .35rem; margin-left: .75rem; }`.
- [x] 6. In `src/app/i18n/messages.ts`, set the `en` `'common.import'` to `'Import league(s)'` and the `fr` one to `'Importer ligue(s)'`. Evidence: both lines edited, `common.importing` untouched.
- [x] 7. Run `npx vitest run src/app/app.component.auth-entry.test.ts src/app/i18n` — green. Evidence: `Test Files 2 passed (2)`, `Tests 6 passed (6)`.
- [x] 8. Run `npm run test && npm run lint && npm run typecheck && npm run build`. Evidence: test 796 passed, lint "All files pass linting.", typecheck clean exit, build "Application bundle generation complete."
- [ ] 9. Manual: on `/leagues-archive` signed out, the header reads logo … Import league(s) · Full data export · Sign in, with Sign in right-most. Signed in, the same page ends … Full data export · username · Log out. Automated substitute/context only, not manual execution: template source order places `auth-toolbar-actions` after page actions in the shared toolbar.
- [ ] 10. Manual: check `/settings`, `/live-tournaments/{id}` and a league detail page — the auth block is right-most on each. Automated substitute/context only, not manual execution: all page-action branches precede the trailing `auth-toolbar-actions` block; `the auth block is the last thing in the toolbar` checks all five markers.

## Outputs

- Files edited: `src/app/app.component.ts`, `src/styles.css`, `src/app/i18n/messages.ts`, `src/app/app.component.auth-entry.test.ts`.
- Files added: `src/app/i18n/import-label.test.ts` (only if no existing i18n test file fits).
- Behaviour change: header ordering and one button label. No route or data change.
- Migration/config: none.

## Validation

- [x] `npx vitest run src/app/app.component.auth-entry.test.ts src/app/i18n` passes. Evidence: `Test Files 2 passed (2)`, `Tests 6 passed (6)`.
- [x] `npm run test` passes. Evidence: `Test Files 95 passed (95)`, `Tests 796 passed (796)`.
- [x] `npm run lint` passes. Evidence: `All files pass linting.`
- [x] `npm run typecheck` passes. Evidence: `tsc --noEmit` clean, exit 0.
- [x] `npm run build` passes. Evidence: `Application bundle generation complete.`
- [ ] Manual: sign-in / logout is right-most on `/leagues-archive`, `/settings`, `/calendar`, a league detail page and a live tournament runner page. Automated substitute/context only, not manual execution: shared-toolbar source order places `auth-toolbar-actions` after all page-scoped action branches.
- [ ] Manual: the import button reads "Importer ligue(s)" in French and "Import league(s)" in English, and still opens the file picker. Automated substitute/context only, not manual execution: `import-label.test.ts` proves both strings; source retains `(click)="openImportPicker()"` and `#headerImportInput` wiring.
- [x] App functional — no broken path from this slice. Evidence: full `npm run test && npm run lint && npm run typecheck && npm run build` all green, no other files touched.
- [x] Commit msg draft: `fix(header): put the account block last and rename the league import button`. Evidence: used verbatim as commit message.
