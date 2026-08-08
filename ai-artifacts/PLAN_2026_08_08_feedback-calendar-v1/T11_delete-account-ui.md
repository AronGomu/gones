# T11: Delete account UI

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T6, T8
**Commit outcome:** The account page ends with a "Supprimer Compte" button whose confirmation dialog demands the current password; confirming deletes the account and returns the user to the home page signed out.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is Profile §11's UI half.
- This slice: one dialog component, one danger zone section, one navigation. The endpoint already exists.
- Out of scope here: the account form polish (T9) and geo selects (T10) — both edit the same file; if they have already landed, keep their structure intact and append the danger zone last.
- Assumptions in force: **A7** — deletion is a hard delete, so the dialog copy must say the account and its data are removed permanently and cannot be recovered.

## Requirements

- A `Zone de danger` section renders at the bottom of `/settings/account`, visually separated, with a red "Supprimer Compte" button.
- Clicking it opens a modal that (a) explains the deletion is permanent, (b) requires the current password, (c) disables its confirm button while the password is empty.
- Confirming calls `DELETE /api/users/me` with the password. A validation failure keeps the dialog open and shows the field error. Success closes the dialog, clears the session and navigates to `/`.
- The existing logout button stays.
- Every element carries a unique `data-cy`.

## Inputs

- `src/app/features/settings/account-settings.component.ts` — the merged account page created by T8. It has `readonly i18n`, `private readonly auth`, `private readonly router`, signals `pending`, `error`, `status`, `fieldErrors`, `identities`, and a `private async run(lock, action)` helper. Its `logout()` is `await this.auth.logout(); await this.router.navigate(['/login'])` — change the destination to `'/'` if T3 has not already.
- `src/app/auth/auth.service.ts` — T6 added `deleteAccount(currentPassword: string): Promise<void>`, which calls the generated client's `DELETE /api/users/me` method and then `this.clear()` (clearing the token store, the profile signal and the session scope).
- `src/app/auth/auth-errors.ts` — `fieldErrorsFromProblem(error): AuthFieldErrors` maps an `ApiProblemError` body's `errors` map into `Record<string, string[]>`; the backend returns the failure under key `currentPassword`.
- `src/app/shared/dialogs.ts` — 33 lines, holds `ConfirmDialogComponent` taking `{ title, message, confirmLabel, destructive }` and closing with a boolean. It has **no** input-carrying dialog; a new one is needed.
- Dialog usage pattern: `firstValueFrom(this.dialog.open(X, { data: … }).afterClosed())` — see `src/app/app.component.ts:313-324`.
- `src/styles.css:117` — `.danger-ghost-action` gives the outlined red treatment used for destructive actions elsewhere.
- `src/app/api/api-boundary.ts` — `ApiProblemError` carries `status` and the parsed problem body.
- `src/app/i18n/messages.ts` — `const en = {` line 5, `const fr` line 1000; add every key to BOTH.
- Backend contract from T6: `DELETE /api/users/me`, body `{ "currentPassword": string }`; `400` with `errors.currentPassword` on a bad password; `409` with `lastAdmin` when the sole admin tries to delete themselves; `204` on success.
- **From Depends (T6):** the endpoint and `AuthService.deleteAccount` exist and are unit-tested. **From Depends (T8):** the page lives at `src/app/features/settings/account-settings.component.ts` on route `settings/account`, uses `account-` prefixed selectors, and is out of `PENDING_DATA_CY_RETROFIT`.

## TDD

1. **Red** — write `src/app/shared/password-confirm-dialog.component.test.ts` and `src/app/features/settings/account-delete.test.ts` against a dialog component and a `deleteAccount()` method that do not exist.
2. **Green** — add the dialog, the danger zone and the handler.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `confirm is disabled without a password` | freshly opened dialog | `[data-cy=password-confirm-submit]` has the `disabled` attribute |
| `confirm returns the typed password` | type `hunter2`, click confirm | dialog closes with `'hunter2'` |
| `cancel returns undefined` | click cancel | dialog closes with `undefined` |
| `cancelling makes no request` | dialog stub resolving `undefined` | `auth.deleteAccount` spy not called |
| `confirming deletes and navigates` | stub resolving `'pw'`, `deleteAccount` resolving | spy called with `'pw'`; `router.navigate` called with `['/']` |
| `a bad password shows a field error` | `deleteAccount` rejecting with a 400 problem naming `currentPassword` | `fieldErrors()['currentPassword']` non-empty; no navigation |
| `the last-admin conflict shows its own message` | reject with a 409 whose detail contains `lastAdmin` | `error()` equals `i18n.t('account.deleteLastAdmin')` |
| `data-cy coverage` | both touched files | suite green |

Run: `npm run test -- password-confirm-dialog account-delete data-cy-coverage`

## Impl steps

- [ ] 1. Create `src/app/shared/password-confirm-dialog.component.ts` exporting `PasswordConfirmDialogComponent` and `export interface PasswordConfirmDialogData { title: string; message: string; confirmLabel: string; passwordLabel: string; }`.
- [ ] 2. Its template: `<h2 mat-dialog-title data-cy="password-confirm-title">`, `<mat-dialog-content data-cy="password-confirm-content">` with the message paragraph and `<input type="password" autocomplete="current-password" data-cy="password-confirm-input" [(ngModel)]="password">`, `<mat-dialog-actions data-cy="password-confirm-actions">` with a cancel button `data-cy="password-confirm-cancel"` closing with `undefined` and a confirm button `data-cy="password-confirm-submit"` with `class="danger-ghost-action"` and `[disabled]="!password"` closing with `password`.
- [ ] 3. Give every element in that template a unique `data-cy`; import `FormsModule`, `MatButtonModule`, `MatDialogModule`.
- [ ] 4. Create `src/app/shared/password-confirm-dialog.component.test.ts` with the first three Test plan rows.
- [ ] 5. Add these keys to BOTH maps in `src/app/i18n/messages.ts`:
  - `account.dangerZone` — en `'Danger zone'`, fr `'Zone de danger'`
  - `account.delete` — en `'Delete account'`, fr `'Supprimer Compte'`
  - `account.deleteTitle` — en `'Delete your account?'`, fr `'Supprimer votre compte ?'`
  - `account.deleteMessage` — en `'This permanently deletes your account and everything attached to it. This cannot be undone. Enter your current password to confirm.'`, fr `'Cette action supprime définitivement votre compte et tout ce qui y est rattaché. Elle est irréversible. Saisissez votre mot de passe actuel pour confirmer.'`
  - `account.deletePassword` — en `'Current password'`, fr `'Mot de passe actuel'`
  - `account.deleteFailed` — en `'Account deletion failed. Check your password, then retry.'`, fr `'La suppression du compte a échoué. Vérifiez votre mot de passe, puis réessayez.'`
  - `account.deleteLastAdmin` — en `'The last administrator cannot delete their own account.'`, fr `'Le dernier administrateur ne peut pas supprimer son propre compte.'`
- [ ] 6. In `src/app/features/settings/account-settings.component.ts`, append after the linked-accounts card and before the closing `</section>`:
  ```
  <mat-card class="panel auth-card account-danger-zone" data-cy="account-danger-zone"><mat-card-content class="stack" data-cy="account-danger-zone-content">
    <h2 data-cy="account-danger-zone-title">{{ i18n.t('account.dangerZone') }}</h2>
    <p class="muted" data-cy="account-danger-zone-help">{{ i18n.t('account.deleteMessage') }}</p>
    <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="account-delete" [disabled]="deletePending()" (click)="deleteAccount()">{{ i18n.t('account.delete') }}</button>
  </mat-card-content></mat-card>
  ```
- [ ] 7. Add `readonly deletePending = signal(false);` and inject `private readonly dialog = inject(MatDialog);` (already present if T9 landed) plus `MatDialogModule` in the component imports.
- [ ] 8. Implement:
  ```
  async deleteAccount(): Promise<void> {
    const password = await firstValueFrom(this.dialog.open(PasswordConfirmDialogComponent, {
      data: { title: this.i18n.t('account.deleteTitle'), message: this.i18n.t('account.deleteMessage'), confirmLabel: this.i18n.t('account.delete'), passwordLabel: this.i18n.t('account.deletePassword') }
    }).afterClosed());
    if (!password) return;
    if (this.deletePending()) return;
    this.deletePending.set(true); this.error.set(''); this.status.set(''); this.fieldErrors.set({});
    try {
      await this.auth.deleteAccount(password);
      await this.router.navigate(['/']);
    } catch (error) {
      this.fieldErrors.set(fieldErrorsFromProblem(error));
      this.error.set(error instanceof ApiProblemError && error.status === 409 ? this.i18n.t('account.deleteLastAdmin') : this.i18n.t('account.deleteFailed'));
    } finally {
      this.deletePending.set(false);
    }
  }
  ```
- [ ] 9. Render `fieldErrors()['currentPassword']` under the delete button so a bad password is visible after the dialog closes, with `data-cy="account-delete-error"`.
- [ ] 10. Add `.account-danger-zone { border-color: var(--hot-blood); }` to `src/styles.css`.
- [ ] 11. Confirm `logout()` in this component navigates to `'/'`, not `'/login'`.
- [ ] 12. Create `src/app/features/settings/account-delete.test.ts` with Test plan rows four to seven, stubbing `AuthService`, `MatDialog` and `Router`.
- [ ] 13. Add a Cypress case to `cypress/e2e/auth-profile.cy.js`: register a throwaway user, open `/settings/account`, click `[data-cy=account-delete]`, type the password into `[data-cy=password-confirm-input]`, submit, assert the URL is `/` and `[data-cy=profile-link]` is absent; then assert signing in with the deleted credentials fails.
- [ ] 14. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 15. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js`.

## Outputs

- Files created: `src/app/shared/password-confirm-dialog.component.ts`, `src/app/shared/password-confirm-dialog.component.test.ts`, `src/app/features/settings/account-delete.test.ts`.
- Files touched: `src/app/features/settings/account-settings.component.ts`, `src/app/i18n/messages.ts`, `src/styles.css`, `cypress/e2e/auth-profile.cy.js`.
- Public API / behavior change: a signed-in user can destroy their account from the UI.
- Migrate / config: none.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js` passes
- [ ] manual check: a wrong password keeps the user signed in and shows the field error; the right password lands on `/` signed out and the credentials no longer work
- [ ] app functional — logout, email change and provider linking still work
- [ ] commit msg draft: `feat(account): delete your own account behind a password-confirmation dialog`
