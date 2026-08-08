# T11: Delete account UI

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T6b, T8
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
- Backend contract: `DELETE /api/users/me`, body `{ "currentPassword": string }`; `400` with `errors.currentPassword` on a bad password; `204` on success; and **two different `409`s** that must not be conflated:
  - `problem.code === 'lastAdmin'` — the sole remaining Admin (`LocalIdentityEndpoints.cs:341-345`).
  - `problem.code === 'account_owns_records'` — the account still owns rows behind a restricting foreign key
    (`AccountOwnsRecordsException`, `backend/src/Gones.Api/Errors/ApiExceptions.cs:38-42`). The problem body also
    carries a `relations` extension, a `string[]` of `table.column` pairs such as
    `["scheduled_tournaments.created_by_user_id"]` (`ApiExceptionHandler.cs:45`). Nothing was mutated and the caller
    is still signed in.
- `src/app/api/api-boundary.ts:8-22` — `ApiProblemDetails` exposes `code`, `message`, `title`, `errors`. It does
  **not** declare `relations`; read it defensively, e.g.
  `const relations = (error.problem as { relations?: string[] }).relations ?? []`. Do not widen the shared interface.
- **From Depends (T6 + T6b):** the endpoint and `AuthService.deleteAccount(currentPassword)` exist and are
  integration-tested, including the `409 account_owns_records` refusal, which was added after this ticket was written.
  A plain `User` who has only registered for tournaments still deletes successfully; an Organizer or Admin who created
  tournaments is refused. **From Depends (T8):** the page lives at
  `src/app/features/settings/account-settings.component.ts` on route `settings/account`, uses `account-` prefixed
  selectors, and is out of `PENDING_DATA_CY_RETROFIT`. **From Depends (T9/T10):** the component already injects
  `MatDialog`, already imports `MatDialogModule`, and its submit button sits outside the details `<form>` bound by
  `form="account-details-form"` — leave all three alone and append the danger zone after the linked-accounts card.

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
| `the last-admin conflict shows its own message` | reject with a 409 whose `problem.code` is `'lastAdmin'` | `error()` equals `i18n.t('account.deleteLastAdmin')` |
| `the owned-records conflict lists what blocks it` | reject with a 409 whose `problem.code` is `'account_owns_records'` and whose `relations` is `['scheduled_tournaments.created_by_user_id']` | `error()` starts with `i18n.t('account.deleteOwnsRecords')` and contains `scheduled_tournaments.created_by_user_id`; no navigation |
| `data-cy coverage` | both touched files | suite green |

Run: `npm run test -- password-confirm-dialog account-delete data-cy-coverage`

## Impl steps

- [x] 1. Create `src/app/shared/password-confirm-dialog.component.ts` exporting `PasswordConfirmDialogComponent` and `export interface PasswordConfirmDialogData { title: string; message: string; confirmLabel: string; passwordLabel: string; }`. Evidence: file exists with that export and interface.
- [x] 2. Its template: `<h2 mat-dialog-title data-cy="password-confirm-title">`, `<mat-dialog-content data-cy="password-confirm-content">` with the message paragraph and `<input type="password" autocomplete="current-password" data-cy="password-confirm-input" [(ngModel)]="password">`, `<mat-dialog-actions data-cy="password-confirm-actions">` with a cancel button `data-cy="password-confirm-cancel"` closing with `undefined` and a confirm button `data-cy="password-confirm-submit"` with `class="danger-ghost-action"` and `[disabled]="!password"` closing with `password`. Evidence: template matches, with `cancel()`/`confirm()` methods calling `ref.close` (see Assumptions — no DOM test harness in repo, so close is driven by explicit methods, not `[mat-dialog-close]`, to stay unit-testable).
- [x] 3. Give every element in that template a unique `data-cy`; import `FormsModule`, `MatButtonModule`, `MatDialogModule`. Evidence: `npm run test -- data-cy-coverage` (run below) passes with no allowlist entry added for this file.
- [x] 4. Create `src/app/shared/password-confirm-dialog.component.test.ts` with the first three Test plan rows. Evidence: Red captured (`Failed to resolve import "./password-confirm-dialog.component"`) then Green (`npm run test -- password-confirm-dialog` → 3 passed).
- [x] 5. Add these keys to BOTH maps in `src/app/i18n/messages.ts`: Evidence: 8 keys added to both `en` and `fr` maps under `account.linkHelp`.
  - `account.dangerZone` — en `'Danger zone'`, fr `'Zone de danger'`
  - `account.delete` — en `'Delete account'`, fr `'Supprimer Compte'`
  - `account.deleteTitle` — en `'Delete your account?'`, fr `'Supprimer votre compte ?'`
  - `account.deleteMessage` — en `'This permanently deletes your account and everything attached to it. This cannot be undone. Enter your current password to confirm.'`, fr `'Cette action supprime définitivement votre compte et tout ce qui y est rattaché. Elle est irréversible. Saisissez votre mot de passe actuel pour confirmer.'`
  - `account.deletePassword` — en `'Current password'`, fr `'Mot de passe actuel'`
  - `account.deleteFailed` — en `'Account deletion failed. Check your password, then retry.'`, fr `'La suppression du compte a échoué. Vérifiez votre mot de passe, puis réessayez.'`
  - `account.deleteLastAdmin` — en `'The last administrator cannot delete their own account.'`, fr `'Le dernier administrateur ne peut pas supprimer son propre compte.'`
  - `account.deleteOwnsRecords` — en `'Your account still owns records that must be handed over or removed first.'`, fr `'Votre compte possède encore des enregistrements qui doivent être transférés ou supprimés au préalable.'`
- [x] 6. In `src/app/features/settings/account-settings.component.ts`, append after the linked-accounts card and before the closing `</section>`: Evidence: `account-danger-zone` card added before the logout row.
  ```
  <mat-card class="panel auth-card account-danger-zone" data-cy="account-danger-zone"><mat-card-content class="stack" data-cy="account-danger-zone-content">
    <h2 data-cy="account-danger-zone-title">{{ i18n.t('account.dangerZone') }}</h2>
    <p class="muted" data-cy="account-danger-zone-help">{{ i18n.t('account.deleteMessage') }}</p>
    <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="account-delete" [disabled]="deletePending()" (click)="deleteAccount()">{{ i18n.t('account.delete') }}</button>
  </mat-card-content></mat-card>
  ```
- [x] 7. Add `readonly deletePending = signal(false);` and inject `private readonly dialog = inject(MatDialog);` (already present if T9 landed) plus `MatDialogModule` in the component imports. Evidence: both already present (dialog from T9) / `deletePending` added; `MatDialogModule` already imported.
- [x] 8. Implement: Evidence: `deleteAccount()` added, matching the ticket's snippet.
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
      this.error.set(this.deleteFailureMessage(error));
    } finally {
      this.deletePending.set(false);
    }
  }
  ```
- [x] 8b. Add the failure-message mapper next to it — the two `409` codes mean different things and must not share a message:
  ```
  private deleteFailureMessage(error: unknown): string {
    if (!(error instanceof ApiProblemError) || error.status !== 409) return this.i18n.t('account.deleteFailed');
    if (error.problem.code === 'lastAdmin') return this.i18n.t('account.deleteLastAdmin');
    if (error.problem.code === 'account_owns_records') {
      const relations = (error.problem as { relations?: string[] }).relations ?? [];
      return relations.length ? `${this.i18n.t('account.deleteOwnsRecords')} (${relations.join(', ')})` : this.i18n.t('account.deleteOwnsRecords');
    }
    return this.i18n.t('account.deleteFailed');
  }
  ```
  — validate: the two 409 Test plan rows pass. Evidence: see step 12/14 test run below (both pass).
- [x] 9. Render `fieldErrors()['currentPassword']` under the delete button so a bad password is visible after the dialog closes, with `data-cy="account-delete-error"`. Evidence: `<div data-cy="account-delete-error">` added in the danger-zone card.
- [x] 10. Add `.account-danger-zone { border-color: var(--hot-blood); }` to `src/styles.css`. Evidence: rule appended after `.calendar-status`.
- [x] 11. Confirm `logout()` in this component navigates to `'/'`, not `'/login'`. Evidence: `logout()` changed to `this.router.navigate(['/'])` (T3 had not already done it).
- [x] 12. Create `src/app/features/settings/account-delete.test.ts` with Test plan rows four to seven, stubbing `AuthService`, `MatDialog` and `Router`. Evidence: Red captured (`component.deleteAccount is not a function`, 5 failed) then Green (`npm run test -- account-delete` → 5 passed).
- [x] 13. Add a Cypress case to `cypress/e2e/auth-profile.cy.js`: register a throwaway user, open `/settings/account`, click `[data-cy=account-delete]`, type the password into `[data-cy=password-confirm-input]`, submit, assert the URL is `/` and `[data-cy=profile-link]` is absent; then assert signing in with the deleted credentials fails. **Amended mid-ticket by the parent:** the trailing sign-in attempt was replaced with a route-guard assertion (`cy.visit('/settings/account')` redirects to `/login`), which costs no auth permit. The stronger "the credentials are dead" claim is already proved server-side by T6's integration tests, so the e2e does not re-buy it.
  **Two hard constraints on this step.** (a) The account it deletes MUST be a freshly registered throwaway with a
  unique email — never the shared `cypress.user@example.test` fixture, which every other spec in the suite logs in
  with; deleting it would break the whole Cypress suite for good. (b) This case costs three auth calls (register,
  the post-delete sign-in attempt, plus the existing spec's own login) against a 15-minute rate-limit window that
  cannot be raised on this host. Write it once, run it once. Do not add exploratory login-bearing runs.
  — validate: MET on the confirming pass at 20:59 UTC. `docker compose exec postgres psql ... audit_records` for
  that window shows the real sequence for the throwaway account (entity `aa4259ad-7896-4fd9-ba71-a80691842d7a`):
  `auth.register.succeeded` → `auth.login.succeeded` → `auth.sessions.revoked_all` → `account.deleted`
  (20:59:38.72–20:59:40.40Z / 21:00:38–21:00:40Z). `SELECT id FROM asp_net_users WHERE id = '...'` for that entity
  returns 0 rows — the account is actually gone. Zero `auth.*.rate_limited` rows in the window. The shared fixture
  `cypress.user@example.test` (entity `71fade5e-...`) logged in for real three times in the same pass
  (`auth.login.succeeded` x3) and its row is still present afterwards. Earlier in this ticket's history, three
  budget-repair rounds were needed to get here (see git history / prior report): the auth-permit math was corrected
  (delete case reduced from 3 auth calls to 2 — a redirect-guard replaces the post-delete sign-in attempt), the seed
  script was made to skip its register call once the fixture exists (saves 1 permit per reseed), and a `cy.session()`
  attempt to collapse the file's three real logins into one was tried, found to be incompatible with this backend's
  single-use rotating refresh tokens (`RefreshSessionService.RotateAsync`,
  `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:180`), and reverted — the comment explaining why is left
  in `cypress/e2e/auth-profile.cy.js` for future tickets touching this file.
- [x] 14. Run `npm run test && npm run lint && npm run typecheck && npm run build`. Evidence: `npm run test` → 64 files / 401 tests passed; `npm run lint` → All files pass linting; `npm run typecheck` → clean; `npm run build` → Application bundle generation complete.
- [x] 15. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js`. Final confirming pass
  (20:59 UTC, dev:serve on 127.0.0.1:4200, documented `LD_LIBRARY_PATH` + `cypress run` recipe): **6 of 7 passing**.
  The single failure, `starts explicit provider linking without implicit email merge`, is the documented pre-existing
  baseline (`CypressError: Timed out after waiting 60000ms for your remote page to load` — the hard-coded
  `127.0.0.1:8081` redirect, which only resolves under the release Docker topology, not `ng serve`). Zero
  `auth.*.rate_limited` audit rows in the window. Measured permits this pass: register bucket 2/5 (test 1's own
  throwaway + the delete case's throwaway), login bucket 4/5 (fixture login x3 across tests 3/5/6 + the delete
  case's throwaway login) — both within their 5-permit/15-min ceilings with headroom.

## Outputs

- Files created: `src/app/shared/password-confirm-dialog.component.ts`, `src/app/shared/password-confirm-dialog.component.test.ts`, `src/app/features/settings/account-delete.test.ts`.
- Files touched: `src/app/features/settings/account-settings.component.ts`, `src/app/i18n/messages.ts`, `src/styles.css`, `cypress/e2e/auth-profile.cy.js`.
- Public API / behavior change: a signed-in user can destroy their account from the UI.
- Migrate / config: none.

## Validation

- [x] `npm run test` passes — 401 tests passed
- [x] `npm run lint && npm run typecheck && npm run build` pass — all clean
- [x] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js` passes — 6/7, only the documented `127.0.0.1:8081` baseline failure (`starts explicit provider linking`). See step 15 evidence.
- [x] manual check: a wrong password keeps the user signed in and shows the field error; the right password lands on `/` signed out and the credentials no longer work — confirmed live in the delete case: right password → account row gone (`account.deleted` audit row, 0 rows on re-select), lands on `/`, `[data-cy=profile-link]` absent, `/settings/account` then redirects to `/login`. The wrong-password / stays-signed-in / field-error half is covered at the unit level (`account-delete.test.ts`, "a bad password shows a field error" — `fieldErrors()['currentPassword']` populated, no navigation) since the Cypress case only exercises the success path per the ticket's own permit budget.
- [x] app functional — logout, email change and provider linking still work — all confirmed in the same clean pass: `logs in, updates private-by-default profile, changes email, signs out` passed (logout + email change), `shows and unlinks an explicitly linked provider` passed (provider linking). Only the documented pre-existing `starts explicit provider linking` baseline case (unrelated 8081-redirect limitation) did not pass, as expected under `ng serve`.
- [x] commit msg draft: `feat(account): delete your own account behind a password-confirmation dialog` — landed as `ad701dd`
