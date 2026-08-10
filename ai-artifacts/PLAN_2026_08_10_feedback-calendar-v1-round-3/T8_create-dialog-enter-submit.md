# T8: Create dialog Enter

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** none
**Commit outcome:** The New League dialog opens with the name field focused, and pressing Enter creates the league. Every create-a-thing prompt dialog in the app behaves the same, because they all use the same component.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice is feedback #4 — "In the dialog to create a new league, on the leagues archive page, by default the input should be auto-focused to type the name of the league, and when I press Enter, it should auto-validate and create the league. All dialogues that create something should follow the same procedure."
- This slice: fix the one shared prompt dialog component, not each caller.
- Out of scope here: `ConfirmDialogComponent` (it confirms, it does not create, and its confirm button already carries `cdkFocusInitial`). `PasswordConfirmDialogComponent`. `ApproverSelectionDialogComponent`. Any caller's own logic.
- Assumptions in force: `TextPromptDialogComponent` in `src/app/shared/dialogs.ts` is the **only** create-a-thing prompt dialog in the app today — its single caller is `LeagueArchiveListComponent.createLeague()`. Fixing it fixes every current and future create dialog. No TestBed — assert on the component source string.

## Inputs

- `src/app/shared/dialogs.ts`, current `TextPromptDialogComponent`:
  ```ts
  export interface TextPromptData { title: string; label: string; confirmLabel: string; initialValue?: string; }

  @Component({
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
    template: `<h2 mat-dialog-title data-cy="text-prompt-dialog-title">{{ data.title }}</h2><mat-dialog-content data-cy="text-prompt-dialog-content"><mat-form-field appearance="outline" class="dialog-field" data-cy="text-prompt-dialog-field"><mat-label data-cy="text-prompt-dialog-label">{{ data.label }}</mat-label><input matInput data-cy="text-prompt-dialog-input" [(ngModel)]="value" cdkFocusInitial></mat-form-field></mat-dialog-content><mat-dialog-actions align="end" data-cy="text-prompt-dialog-actions"><button mat-button mat-dialog-close data-cy="text-prompt-dialog-cancel">{{ i18n.t('common.cancelEsc') }}</button><button mat-flat-button color="primary" data-cy="text-prompt-dialog-confirm" [disabled]="!value.trim()" (click)="close()">{{ data.confirmLabel }}</button></mat-dialog-actions>`
  })
  export class TextPromptDialogComponent {
    readonly data = inject<TextPromptData>(MAT_DIALOG_DATA);
    readonly i18n = inject(I18nService);
    private readonly ref = inject<MatDialogRef<TextPromptDialogComponent, string>>(MatDialogRef);
    value = this.data.initialValue ?? '';
    close(): void { this.ref.close(this.value.trim()); }
  }
  ```
- Its only caller, `src/app/features/leagues-archive/league-archive-list.component.ts` line ~109:
  ```ts
  const name = await firstDialogValue(this.dialog.open(TextPromptDialogComponent, { data: { title: this.i18n.t('leagues.createTitle'), label: this.i18n.t('leagues.createLabel'), confirmLabel: this.i18n.t('leagues.createConfirm') } }).afterClosed());
  if (!name || this.creating()) return;
  ```
  It already treats `undefined` and `''` the same way, so an empty Enter must resolve to neither a close nor a create.
- `src/app/shared/password-confirm-dialog.component.test.ts` — the style to copy for a new dialog test file.
- **From Depends:** none.

## Requirements

- Wrap the dialog body in a real form so the browser's native Enter-submits-a-single-input behaviour applies:
  ```html
  <form data-cy="text-prompt-dialog-form" (ngSubmit)="close()">
    <mat-dialog-content …>…</mat-dialog-content>
    <mat-dialog-actions align="end" …>
      <button mat-button type="button" mat-dialog-close data-cy="text-prompt-dialog-cancel">…</button>
      <button mat-flat-button color="primary" type="submit" data-cy="text-prompt-dialog-confirm" [disabled]="!value.trim()">…</button>
    </mat-dialog-actions>
  </form>
  ```
  The `(click)="close()"` on the confirm button is removed — `type="submit"` inside the form routes both the click and the Enter through `ngSubmit`.
- The input keeps `cdkFocusInitial` so the dialog opens focused. Add `name="value"` to the input, required by `FormsModule` inside a `<form>`.
- `close()` becomes a no-op when the trimmed value is empty, so Enter on an empty field neither closes the dialog nor creates a league:
  ```ts
  close(): void {
    const value = this.value.trim();
    if (!value) return;
    this.ref.close(value);
  }
  ```
- `<h2 mat-dialog-title>` stays outside the form (Material expects it as a direct dialog child).
- Every element in the new markup carries a `data-cy` (`src/app/shared/data-cy-coverage.test.ts` enforces it).
- No caller changes. `MatDialogRef<TextPromptDialogComponent, string>` keeps returning `string | undefined`.

## TDD

1. **Red** — write `src/app/shared/dialogs.test.ts` with the four tests below. They fail today.
2. **Green** — edit `TextPromptDialogComponent`.
3. **Refactor** — none needed.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the prompt dialog submits on Enter` | source of `src/app/shared/dialogs.ts` | contains `data-cy="text-prompt-dialog-form"` and `(ngSubmit)="close()"` |
| `the confirm button submits the form instead of handling its own click` | same source | the `text-prompt-dialog-confirm` button markup contains `type="submit"` and does **not** contain `(click)="close()"` |
| `the input keeps initial focus` | same source | the `text-prompt-dialog-input` markup contains `cdkFocusInitial` |
| `an empty value never closes the dialog` | build the class body slice for `close()` from the source | contains `if (!value) return;`; and, in a direct unit assertion, construct a stub `{ value: '   ', ref: { close: spy } }` and call `TextPromptDialogComponent.prototype.close.call(stub)` — `spy` is not called; with `value: ' Ligue 8 '` the spy is called with `'Ligue 8'` |

For the last test, `close()` reads only `this.value` and `this.ref`, so `Function.prototype.call` on a
plain stub object is enough — no TestBed, no injector.

Run: `npx vitest run src/app/shared/dialogs.test.ts`

## Impl steps

- [x] 1. Create `src/app/shared/dialogs.test.ts` with the four tests above. Confirm red. Evidence: initial run showed 3 failed/1 passed.
- [x] 2. In `src/app/shared/dialogs.ts`, wrap `<mat-dialog-content>` and `<mat-dialog-actions>` of `TextPromptDialogComponent` in `<form data-cy="text-prompt-dialog-form" (ngSubmit)="close()">`. Evidence: dialogs.ts edited.
- [x] 3. Add `name="value"` to the `matInput`, keep `cdkFocusInitial` and `[(ngModel)]="value"`. Evidence: dialogs.ts edited.
- [x] 4. Give the cancel button `type="button"` and the confirm button `type="submit"`; delete `(click)="close()"` from the confirm button. Evidence: dialogs.ts edited.
- [x] 5. Rewrite `close()` to return early on an empty trimmed value. Evidence: `if (!value) return;` in dialogs.ts.
- [x] 6. Run `npx vitest run src/app/shared/dialogs.test.ts` — green. Evidence: "Test Files 1 passed (1); Tests 4 passed (4)".
- [x] 7. Run `npm run test && npm run lint && npm run typecheck && npm run build` — `data-cy-coverage.test.ts` must stay green. Evidence: test 808 passed, lint "All files pass linting", typecheck clean, build "Application bundle generation complete".
- [ ] 8. Manual: `/leagues-archive` → New League. The cursor is already in the field; type a name, press Enter — the dialog closes and the league is created and opened. Re-open, press Enter with the field empty — nothing happens. Re-open, press Escape — the dialog closes with no league created.

## Outputs

- Files edited: `src/app/shared/dialogs.ts`.
- Files added: `src/app/shared/dialogs.test.ts`.
- Behaviour change: `TextPromptDialogComponent` submits on Enter and refuses an empty value. Its `MatDialogRef` result type is unchanged.
- Migration/config: none.

## Validation

- [x] `npx vitest run src/app/shared/dialogs.test.ts` passes with 4 tests. Evidence: "Test Files 1 passed (1); Tests 4 passed (4)".
- [x] `npm run test` passes, including `src/app/shared/data-cy-coverage.test.ts`. Evidence: "Test Files 96 passed (96); Tests 808 passed (808)".
- [x] `npm run lint` passes. Evidence: "All files pass linting."
- [x] `npm run typecheck` passes. Evidence: clean exit, no diagnostics.
- [x] `npm run build` passes. Evidence: "Application bundle generation complete."
- [x] `npm run cy:run -- --spec cypress/e2e/league-local.cy.js` passes. Evidence: ran via steam-run wrapper (host quirk) — "5 passing", 0 failing, incl. the league-creation-dialog flow.
- [ ] Manual: Enter creates; empty Enter does nothing; Escape cancels; the field is focused on open. Deferred to `ai-artifacts/manual_test_checklist.md` — no interactive browser session available to this worker; source-level tests + cypress cover the logic, this line needs a human eyes-on pass.
- [x] App functional — no broken path from this slice. Evidence: full `npm run test`, `lint`, `typecheck`, `build`, and cypress `league-local.cy.js` all green with no other files touched.
- [ ] Commit msg draft: `fix(dialogs): focus the prompt field and create on Enter`
