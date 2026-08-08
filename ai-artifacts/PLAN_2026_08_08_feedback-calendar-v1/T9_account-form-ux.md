# T9: Account form UX

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T8, T9b
**Commit outcome:** The account form labels the username "Pseudo", keeps its submit disabled until something actually changes, renames it "Modifier Information du Compte" in warning colours behind a confirmation dialog, persists the change, folds the email section into the details card, and links OAuth providers without asking for a password.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket covers Profile §1, §4, §5, §6, §7, §8, §9 and §10.
- This slice: the account form's behaviour and copy. The geo selects (§2) land in T10 and the delete button (§11) in T11 — both edit this same file afterwards, so leave the form structure easy to extend.
- Out of scope here: geo datasets, account deletion, routing.
- Assumptions in force:
  - "Enregistrer does not register in backend" is a **dirty-state bug**: `saveProfile()` already calls `PATCH /api/users/me`, but the component fields are initialised once from `this.profile()` at construction time and never re-read after `bootstrap()` resolves, so a page load can submit stale values and a reload appears to lose the change. The fix is to seed the form from a signal `effect` and to reset the baseline after a successful save.
  - Changing the username still requires the current password server-side (`LocalIdentityEndpoints.PatchProfileAsync` enforces it); the password input therefore stays, but only shows when the pseudo actually changed.

## Requirements

- The username label reads `Pseudo` (fr) / `Nickname` (en).
- The submit button is `disabled` whenever the form values equal the loaded profile values.
- The submit button reads "Modifier Information du Compte" (fr) / "Update account information" (en).
- The submit button uses the warning colour (yellow/orange), not the blood-red primary.
- Submitting opens a confirmation dialog; cancelling makes no request.
- After a successful save the values persist: a reload of `/settings/account` shows the saved values, and the button returns to disabled.
- The "Paramètres e-mail" card is merged into the details card as a section, not a separate card.
- The "Comptes liés" section has no password input and no password condition; `link()` and `unlink()` call the API without `currentPassword`.
- Every element carries a unique `data-cy`; the file stays out of the retrofit allowlist.

## Inputs

- `src/app/features/settings/account-settings.component.ts` — created by T8 as a verbatim move of the old `ProfileComponent`. Current shape:
  - fields seeded once at construction: `username = this.profile()?.username ?? ''` and siblings for `firstName`, `lastName`, `locationCountry`, `locationRegion`, `locationCity`, `birthDate`, `preferredLanguage`, `isFirstNamePublic`, `isLastNamePublic`, `isLocationPublic`, `isBirthDatePublic`, `isPreferredLanguagePublic`, plus `currentPassword`, `newEmail`, `emailPassword`, `linkPassword`.
  - `readonly profile = this.auth.profile;` — an Angular signal holding `UserProfileResponse | null`.
  - `saveProfile()` calls `await this.auth.updateProfile({ … currentPassword: this.currentPassword || undefined })`, then `await this.settings.setLanguage(this.preferredLanguage)`, clears `currentPassword`, sets `status`.
  - `link(provider)` calls `await this.auth.startLink(provider, this.linkPassword || undefined)`; `unlink(provider)` calls `await this.auth.unlink(provider, this.linkPassword || undefined)`.
  - `private async run(lock: WritableSignal<boolean>, action: () => Promise<void>)` clears `error`/`status`/`fieldErrors`, sets the lock, maps failures through `fieldErrorsFromProblem`.
  - The submit button is `<button mat-flat-button class="home-primary-action" data-cy="account-save" type="submit">`.
- `src/app/auth/auth.service.ts:105-109` — `updateProfile(request)` calls `this.client.mePATCH(request)` and sets `this.profile.set(profile)` with the server response. So a successful save already refreshes the signal.
- `src/app/auth/auth.service.ts:123-128` — `startLink(provider, currentPassword?)` and `unlink(provider, currentPassword?)`; both parameters are optional, so dropping the argument needs no service change.
- `src/app/shared/dialogs.ts` — `ConfirmDialogComponent`, opened as `firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title, message, confirmLabel, destructive } }).afterClosed())`, resolving to a boolean. Example call site: `src/app/app.component.ts:313-324`.
- `src/styles.css:115-117` — `.home-primary-action` (blood red) and `.danger-ghost-action` (hot blood). There is **no** warning-coloured button class yet; add one.
- `src/styles.css` — the `:root` block (lines 3-18) does **not** define `--rust`. The only rust token is
  `--rust-plate: oklch(30% 0.06 38)`, a dark plate fill that is unreadable as a filled-button background. Use the
  literal `oklch(72% 0.16 62)` for the new class and do **not** introduce a `--rust` fallback that never resolves.
- `src/app/i18n/messages.ts` — `const en = {` line 5, `const fr` line 1000; every key in BOTH.
- **From Depends (T9b):** `AuthService.startLink(provider: string)` and `AuthService.unlink(provider: string)` now take
  **one** argument each — the optional `currentPassword` parameter is gone from the service, the generated client and
  both API endpoints. The `linkPassword` field and its label/input row are already deleted from
  `account-settings.component.ts`. Step 18 is therefore a verification, not an edit. The i18n key
  `profile.currentPasswordOptional` may now be unused; leave it for the T25 sweep. T9b also edited
  `cypress/e2e/auth-profile.cy.js:104-106`, which used to type into the deleted `#link-password` and assert the
  request carried `currentPassword`; that edit was **never run against a browser**, so step 24 of this ticket is
  the first execution of it — treat a failure there as yours to fix.
- **From Depends (T8):** the component lives at `src/app/features/settings/account-settings.component.ts`, its route is `settings/account` behind `userGuard`, its selectors are prefixed `account-`, and it is already out of `PENDING_DATA_CY_RETROFIT`. The profile fields are the T5 shape: `locationCountry`, `locationRegion`, `locationCity`, `birthDate` (ISO `yyyy-MM-dd`), `isBirthDatePublic`.

## TDD

1. **Red** — create `src/app/features/settings/account-form.ts` tests first (`account-form.test.ts`) for `accountFormValues`, `accountFormIsDirty` and `accountFormPayload`; they fail because the module does not exist.
2. **Green** — add the pure module, then rewire the component to use it, add the dialog, the disabled binding, the copy and the CSS class.
3. **Refactor** — keep every derived value in the pure module so T10 can extend it with geo fields without touching component logic.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `maps a profile to form values` | `accountFormValues(profileFixture)` | every field equals the profile field; `birthDate` is `'1990-04-17'`; nulls become `''` |
| `maps a null profile to empty values` | `accountFormValues(null)` | all strings `''`, all booleans `false`, `preferredLanguage` `'fr'` |
| `is not dirty when unchanged` | `accountFormIsDirty(values, values)` | `false` |
| `is dirty on a changed pseudo` | baseline vs `{...baseline, username: 'x'}` | `true` |
| `is dirty on a changed privacy flag` | baseline vs `{...baseline, isLocationPublic: true}` | `true` |
| `ignores the password field for dirtiness` | baseline vs `{...baseline, currentPassword: 'abc'}` | `false` |
| `payload sends undefined for empty optionals` | `accountFormPayload({...baseline, locationCity: '', birthDate: ''})` | `locationCity` and `birthDate` are `undefined` |
| `dialog cancel makes no request` | component with a stubbed dialog resolving `false` | `auth.updateProfile` spy not called |
| `dialog confirm saves and resets the baseline` | stub resolving `true`, `updateProfile` returning the patched profile | spy called once; `isDirty()` becomes `false` |
| `link sends no password` | click `[data-cy=account-link-google]` | `auth.startLink` called with `('google')` only |

Run: `npm run test -- account-form account-settings`

## Impl steps

- [ ] 1. Create `src/app/features/settings/account-form.ts` with `export interface AccountFormValues { username: string; firstName: string; lastName: string; locationCountry: string; locationRegion: string; locationCity: string; birthDate: string; preferredLanguage: string; isFirstNamePublic: boolean; isLastNamePublic: boolean; isLocationPublic: boolean; isBirthDatePublic: boolean; isPreferredLanguagePublic: boolean; }`.
- [ ] 2. In the same file add `export function accountFormValues(profile: UserProfileResponse | null): AccountFormValues` mapping nulls to `''` / `false` and defaulting `preferredLanguage` to `'fr'`; `birthDate` comes from the profile's ISO date string, `''` when absent.
- [ ] 3. Add `export function accountFormIsDirty(baseline: AccountFormValues, current: AccountFormValues): boolean` comparing every key of `AccountFormValues` with `!==`. The password is deliberately not part of the interface, so it cannot influence dirtiness.
- [ ] 4. Add `export function accountFormPayload(values: AccountFormValues, currentPassword: string): PatchUserProfileRequest` turning `''` into `undefined` for `locationCountry`, `locationRegion`, `locationCity`, `birthDate` and `currentPassword`.
- [ ] 5. Create `src/app/features/settings/account-form.test.ts` with the first seven Test plan rows.
- [ ] 6. In `account-settings.component.ts`, replace the seventeen loose field declarations with `readonly baseline = signal<AccountFormValues>(accountFormValues(this.profile()));` and `readonly form = signal<AccountFormValues>(accountFormValues(this.profile()));` plus `currentPassword = ''`, `newEmail = ''`, `emailPassword = ''`.
- [ ] 7. Add a constructor `effect(() => { const values = accountFormValues(this.profile()); this.baseline.set(values); if (!this.isDirty()) this.form.set(values); });` so a profile arriving after `bootstrap()` seeds the form without clobbering user edits.
- [ ] 8. Add `readonly isDirty = computed(() => accountFormIsDirty(this.baseline(), this.form()));` and `readonly pseudoChanged = computed(() => this.baseline().username !== this.form().username);`.
- [ ] 9. Add `setField<K extends keyof AccountFormValues>(key: K, value: AccountFormValues[K]): void { this.form.update(values => ({ ...values, [key]: value })); }` and bind every input with `[ngModel]="form().x"` / `(ngModelChange)="setField('x', $event)"`.
- [ ] 10. Change the username label to `{{ i18n.t('account.pseudo') }}`; add `account.pseudo` to BOTH maps (en `'Nickname'`, fr `'Pseudo'`).
- [ ] 11. Wrap the current-password input in `@if (pseudoChanged()) { … }` and label it `{{ i18n.t('account.pseudoPassword') }}` (en `'Current password (required to change your nickname)'`, fr `'Mot de passe actuel (requis pour changer de pseudo)'`).
- [ ] 12. Replace the submit button with `<button mat-flat-button class="warning-action" data-cy="account-save" type="submit" [disabled]="pending() || !isDirty()">{{ pending() ? i18n.t('common.saving') : i18n.t('account.submit') }}</button>`; add `account.submit` to BOTH maps (en `'Update account information'`, fr `'Modifier Information du Compte'`).
- [ ] 13. Add to `src/styles.css`: `.warning-action { --mdc-filled-button-container-color: var(--rust, oklch(72% 0.16 62)); --mdc-filled-button-label-text-color: oklch(15% 0.02 60); min-height: 48px; padding-inline: 1.2rem !important; border-radius: 0 !important; font-weight: 900; letter-spacing: .03em; }` and a `:hover` darkening it one step. Confirm `--rust` exists in the `:root` block; if it does not, use the literal oklch value.
- [ ] 14. Inject `private readonly dialog = inject(MatDialog);` and add `MatDialogModule` to the component imports.
- [ ] 15. Rewrite `saveProfile()` to first open the confirmation:
  ```
  const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: this.i18n.t('account.confirmTitle'), message: this.i18n.t('account.confirmMessage'), confirmLabel: this.i18n.t('account.submit'), destructive: false } }).afterClosed());
  if (!confirmed) return;
  ```
  then run the existing `this.run(this.pending, …)` body with `accountFormPayload(this.form(), this.currentPassword)`, and on success `this.baseline.set(accountFormValues(this.auth.profile()));` and `this.currentPassword = '';`.
- [ ] 16. Add `account.confirmTitle` (en `'Update your account?'`, fr `'Modifier votre compte ?'`) and `account.confirmMessage` (en `'Your account information will be updated.'`, fr `'Les informations de votre compte seront mises à jour.'`) to BOTH maps.
- [ ] 17. Move the email card's contents into the details card: delete the second `<mat-card class="panel auth-card">` wrapper and re-insert its `<h2>` and form as a `<section class="account-email-section" data-cy="account-email-section">` at the bottom of the first card, after the privacy fieldset and before the submit button.
- [ ] 18. Verify the "Comptes liés" card carries no password: **T9b already deleted** the `link-password` label and input, the `linkPassword` field and the second argument of `startLink` / `unlink` (the backend stopped accepting `currentPassword` there, so the parameter no longer exists on `AuthService`). Re-apply only what is actually missing — validate: `grep -n "linkPassword\|link-password" src/app/features/settings/account-settings.component.ts` returns nothing and `this.auth.startLink(provider)` / `this.auth.unlink(provider)` are called with one argument.
- [ ] 19. Delete the `profile.linkHelp` sentence if it mentions the password, and replace with `account.linkHelp` (en `'Link a provider to sign in with it. You can unlink at any time.'`, fr `'Liez un fournisseur pour vous connecter avec. Vous pouvez délier à tout moment.'`) in BOTH maps.
- [ ] 20. Re-check that every element in the file still has a unique `data-cy`, including the new email section and the conditional password row.
- [ ] 21. Create `src/app/features/settings/account-settings.component.test.ts` with the last three Test plan rows, stubbing `AuthService` and `MatDialog`.
- [ ] 22. Update `cypress/e2e/auth-profile.cy.js`: after editing a field, assert `[data-cy=account-save]` is enabled, click it, confirm the dialog, then `cy.reload()` and assert the new value is still rendered.
- [ ] 23. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 24. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js`.

## Outputs

- Files created: `src/app/features/settings/account-form.ts`, `src/app/features/settings/account-form.test.ts`, `src/app/features/settings/account-settings.component.test.ts`.
- Files touched: `src/app/features/settings/account-settings.component.ts`, `src/styles.css`, `src/app/i18n/messages.ts`, `cypress/e2e/auth-profile.cy.js`.
- Public API / behavior change: linking an OAuth provider no longer sends `currentPassword`; the save button is disabled while pristine and gated by a dialog.
- Migrate / config: none.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js` passes
- [ ] manual check: open `/settings/account`; the button is disabled; change the city; it enables in warning colour; click it; confirm; reload; the city is still there and the button is disabled again
- [ ] app functional — email change and provider linking still work
- [ ] commit msg draft: `feat(account): dirty-gated, confirmed account updates with merged email settings`
