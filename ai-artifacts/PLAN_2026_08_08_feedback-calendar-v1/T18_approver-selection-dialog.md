# T18: Approver-selection dialog

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T16
**Commit outcome:** A verified non-organizer filling the tournament creation form can submit it: a dialog lists every admin and organizer with checkboxes, and confirming sends the proposal.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is Tournament Event Creation §2 steps 1-3 on the client: "open dialog with checkbox lists of admins & organizers", "user check 1 or more", "send mail to all selected".
- This slice: the dialog component and the submit path for non-privileged users. The review page the mail links to is T19.
- Out of scope here: the review/validate/refuse pages, any backend change.
- Assumptions in force: **A14** — only verified accounts reach `/tournaments/new`; organizers and admins keep the direct-publish path untouched.

## Requirements

- On `/tournaments/new`, a user whose `globalRole` is neither `Organizer` nor `Admin` gets an enabled submit button reading "Soumettre pour validation".
- Clicking it validates the form first; an invalid form shows the existing field errors and opens no dialog.
- The dialog lists every approver returned by `GET /api/tournament-proposals/approvers`, grouped Admins first then Organizers, each with a checkbox.
- The dialog's confirm button is disabled until at least one approver is checked.
- Confirming posts the form payload plus the checked ids to `POST /api/tournament-proposals` and, on success, shows a confirmation panel naming how many approvers were mailed, with a link back to `/calendar`.
- A failure keeps the form filled and shows the server's field errors.
- Every element carries a unique `data-cy`.

## Inputs

- `src/app/features/calendar/organizer-tournament-create.component.ts` — 439 lines. After T15 it holds:
  - `readonly auth = inject(AuthService);` and `readonly canPublishDirectly = computed(() => { const role = this.auth.profile()?.globalRole; return role === 'Organizer' || role === 'Admin'; });`
  - the `@else` branch rendering `[data-cy=tournament-approval-notice]` and the disabled `[data-cy=tournament-submit-pending-approval]` button — **this ticket replaces that disabled button with a working one**.
  - a `FormGroup` `form` with controls `title`, `organizationId`, `summary`, `bodyHtml`, `streetAddress`, `postalCode`, `city`, `country`, `startsAtLocal`, `endsAtLocal`, `timeZoneId`, `capacity`, `formatIds`.
  - `organizations()` and `formats()` signals loaded from the generated `Client`, `formPending()`, `fieldError(name)`, `success()`, and the recovery-error machinery (`RecoveryError { message, action }`).
  - `requestPreview()` builds the payload through `tournamentPayload(...)` from `src/app/features/calendar/organizer-tournament-create.ts`.
- `src/app/features/calendar/organizer-tournament-create.ts` — 64 lines, exports `tournamentPayload(...)`, `browserTimeZoneSuggestion()`, `PreviewPublicationState`. `tournamentPayload` is the single place that maps form values to the publish request; reuse it verbatim for the proposal body.
- `src/app/api/generated/gones-api.ts` — after T16 it exposes a client method for `GET /api/tournament-proposals/approvers` returning `ProposalApproverResponse[]` (`{ id, username, globalRole }`) and one for `POST /api/tournament-proposals` taking `{ tournament, recipientUserIds }` and returning `{ proposalId, status, expiresAt, recipientCount }`. Confirm the generated method names after regeneration.
- `src/app/shared/dialogs.ts` — `ConfirmDialogComponent` only; a checkbox-list dialog does not exist yet.
- Dialog idiom: `firstValueFrom(this.dialog.open(X, { data }).afterClosed())`; see `src/app/app.component.ts:313-324`.
- `src/app/api/api-boundary.ts` — `ApiProblemError` with `status` and the parsed problem body; `src/app/auth/auth-errors.ts` — `fieldErrorsFromProblem(error)`.
- `src/app/i18n/messages.ts` — `const en = {` line 5, `const fr` line 1000; both maps. T15 already added `tournamentCreate.approvalNotice` and `tournamentCreate.submitForApproval`.
- `src/app/shared/data-cy-coverage.test.ts` — T15 already removed `organizer-tournament-create.component.ts` from `PENDING_DATA_CY_RETROFIT`, so every element this ticket adds must carry a `data-cy` or the suite fails.
- **From Depends (T16):** `GET /api/tournament-proposals/approvers` requires a signed-in user and never returns emails; `POST /api/tournament-proposals` returns `403` for organizers/admins and unverified accounts, `400` naming `recipientUserIds` for an empty or invalid recipient list, `201` otherwise.

## TDD

1. **Red** — write `src/app/features/calendar/approver-selection-dialog.component.test.ts` and `src/app/features/calendar/tournament-proposal-submit.test.ts` against modules that do not exist.
2. **Green** — add the dialog, the service wrapper and the submit path.
3. **Refactor** — keep the payload construction in `organizer-tournament-create.ts`; the component must not build a second payload shape.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `groups admins before organizers` | `sortApprovers([{globalRole:'Organizer',username:'b'},{globalRole:'Admin',username:'a'}])` | Admin first, then Organizer, each group sorted by username |
| `confirm is disabled with nothing checked` | freshly opened dialog | `[data-cy=approver-dialog-submit]` disabled |
| `confirm returns the checked ids` | check two, submit | closes with those two ids in order |
| `cancel returns undefined` | click cancel | closes with `undefined` |
| `an invalid form opens no dialog` | empty `title`, click submit | `dialog.open` not called; `[data-cy=tournament-title-error]` present |
| `cancelling posts nothing` | dialog resolving `undefined` | proposal client method not called |
| `confirming posts the payload and recipients` | dialog resolving `['id1']` | client called once with `{ tournament: tournamentPayload(form), recipientUserIds: ['id1'] }` |
| `success shows the confirmation panel` | client resolving `{ recipientCount: 2 }` | `[data-cy=tournament-proposal-sent]` present and names 2 |
| `a server error keeps the form` | client rejecting with a 400 problem | form values unchanged; `[data-cy=tournament-proposal-error]` present |
| `data-cy coverage` | both touched files | suite green |

Run: `npm run test -- approver-selection-dialog tournament-proposal-submit data-cy-coverage`

## Impl steps

- [ ] 1. Create `src/app/features/calendar/tournament-proposal.service.ts` with `@Injectable({ providedIn: 'root' }) export class TournamentProposalService` injecting the generated `Client`, exposing `listApprovers(): Promise<ProposalApproverResponse[]>` and `submit(tournament, recipientUserIds): Promise<TournamentProposalResponse>`, each a `firstValueFrom` around the generated method.
- [ ] 2. Add `export function sortApprovers(approvers: ProposalApproverResponse[]): ProposalApproverResponse[]` to the same file — `Admin` before `Organizer`, then by `username` with `localeCompare`.
- [ ] 3. Create `src/app/features/calendar/approver-selection-dialog.component.ts` exporting `ApproverSelectionDialogComponent` and `export interface ApproverSelectionDialogData { approvers: ProposalApproverResponse[]; }`.
- [ ] 4. Its template: a title, a help paragraph, a `<fieldset>` with one `<label class="check-row">` per approver holding `<input type="checkbox" [attr.data-cy]="'approver-option-' + approver.id" [checked]="isChecked(approver.id)" (change)="toggle(approver.id)">` and the username plus a role chip, then cancel (`data-cy="approver-dialog-cancel"`, closes with `undefined`) and submit (`data-cy="approver-dialog-submit"`, `[disabled]="!selected().length"`, closes with `selected()`).
- [ ] 5. Give every element in that template a unique `data-cy`; import `MatButtonModule`, `MatDialogModule`, `FormsModule`.
- [ ] 6. Create `src/app/features/calendar/approver-selection-dialog.component.test.ts` with Test plan rows 1-4.
- [ ] 7. Add these keys to BOTH maps in `src/app/i18n/messages.ts`:
  - `proposal.dialogTitle` — en `'Choose who reviews this tournament'`, fr `'Choisissez qui valide ce tournoi'`
  - `proposal.dialogHelp` — en `'Every person you check receives an email with the full event and a link to approve or decline it.'`, fr `'Chaque personne cochée reçoit un email avec l’évènement complet et un lien pour le valider ou le refuser.'`
  - `proposal.dialogSubmit` — en `'Send request'`, fr `'Envoyer la demande'`
  - `proposal.sentTitle` — en `'Request sent'`, fr `'Demande envoyée'`
  - `proposal.sentBody` — en `'{count} reviewer(s) received your tournament request by email.'`, fr `'{count} validateur(s) ont reçu votre demande de tournoi par email.'`
  - `proposal.loadApproversFailed` — en `'Reviewers could not be loaded. Retry.'`, fr `'Impossible de charger les validateurs. Réessayez.'`
  - `proposal.submitFailed` — en `'The request could not be sent. Check the form, then retry.'`, fr `'La demande n’a pas pu être envoyée. Vérifiez le formulaire, puis réessayez.'`
- [ ] 8. In `organizer-tournament-create.component.ts`, inject `private readonly proposals = inject(TournamentProposalService);` and `private readonly dialog = inject(MatDialog);` (add `MatDialogModule` to imports if T15 did not).
- [ ] 9. Add signals `readonly proposalPending = signal(false);`, `readonly proposalSentCount = signal<number | null>(null);`, `readonly proposalError = signal('');`.
- [ ] 10. Replace the disabled `[data-cy=tournament-submit-pending-approval]` button with `<button mat-flat-button class="home-primary-action" type="button" data-cy="tournament-submit-for-approval" [disabled]="proposalPending()" (click)="submitForApproval()">{{ i18n.t('tournamentCreate.submitForApproval') }}</button>`.
- [ ] 11. Implement `async submitForApproval(): Promise<void>`:
  - `this.form.markAllAsTouched(); if (this.form.invalid) return;`
  - guard on `proposalPending()`
  - load approvers: `let approvers; try { approvers = sortApprovers(await this.proposals.listApprovers()); } catch { this.proposalError.set(this.i18n.t('proposal.loadApproversFailed')); return; }`
  - open the dialog, `const recipientUserIds = await firstValueFrom(...afterClosed()); if (!recipientUserIds?.length) return;`
  - `this.proposalPending.set(true); this.proposalError.set('');`
  - `try { const response = await this.proposals.submit(tournamentPayload(this.form.getRawValue()), recipientUserIds); this.proposalSentCount.set(response.recipientCount); } catch (error) { this.applyFieldErrors(error); this.proposalError.set(this.i18n.t('proposal.submitFailed')); } finally { this.proposalPending.set(false); }`
- [ ] 12. Reuse the component's existing field-error application path for `applyFieldErrors`; if none exists, map through `fieldErrorsFromProblem(error)` and push each message onto the matching control with `setErrors({ server: message })`.
- [ ] 13. Render, above the form, `@if (proposalSentCount(); as count) { <section class="panel" role="status" data-cy="tournament-proposal-sent"><h2 data-cy="tournament-proposal-sent-title">{{ i18n.t('proposal.sentTitle') }}</h2><p data-cy="tournament-proposal-sent-body">{{ i18n.t('proposal.sentBody', { count }) }}</p><a mat-stroked-button routerLink="/calendar" data-cy="tournament-proposal-sent-back">{{ i18n.t('nav.returnToMenu') }}</a></section> }` and hide the form while it is set.
- [ ] 14. Render `@if (proposalError()) { <p class="error" role="alert" data-cy="tournament-proposal-error">{{ proposalError() }}</p> }` next to the submit button.
- [ ] 15. Create `src/app/features/calendar/tournament-proposal-submit.test.ts` with Test plan rows 5-9, stubbing `TournamentProposalService`, `MatDialog` and `AuthService`.
- [ ] 16. Add a Cypress case to `cypress/e2e/organizer-tournament-create.cy.js`: sign in as a verified plain user, fill `/tournaments/new`, click `[data-cy=tournament-submit-for-approval]`, check the first `[data-cy^=approver-option-]`, submit, assert `[data-cy=tournament-proposal-sent]`.
- [ ] 17. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 18. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/organizer-tournament-create.cy.js`.

## Outputs

- Files created: `src/app/features/calendar/tournament-proposal.service.ts`, `src/app/features/calendar/approver-selection-dialog.component.ts`, `src/app/features/calendar/approver-selection-dialog.component.test.ts`, `src/app/features/calendar/tournament-proposal-submit.test.ts`.
- Files touched: `src/app/features/calendar/organizer-tournament-create.component.ts`, `src/app/i18n/messages.ts`, `cypress/e2e/organizer-tournament-create.cy.js`.
- Public API / behavior change: verified plain users can now submit tournament proposals from the UI.
- Migrate / config: none.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run cy:run -- --spec cypress/e2e/organizer-tournament-create.cy.js` passes
- [ ] manual check: as a verified plain user, fill the form, submit, check two approvers, send, and find two mails in the local sink each with a distinct token link
- [ ] app functional — organizers still publish directly with no dialog
- [ ] commit msg draft: `feat(tournaments): let verified users request approval from chosen admins and organizers`
