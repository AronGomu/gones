# T19: `/tournament-requests/:token` pages

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T17, T19b
**Commit outcome:** The link in the approver's email opens a page showing the whole proposed event with Validate and Refuse actions; refusing opens a reason page whose "Envoyer Email Raisons Annulation" button mails the submitter.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is the last part of Tournament Event Creation §2: the dedicated page with the event description, a Validate button that publishes it, and a Cancel path leading to a reason textarea and a send button.
- This slice: two routes, one component with two states, no auth.
- Out of scope here: the submit side (T18), the backend (T16/T17).
- Assumptions in force: **A8** — the token in the URL is the credential; the page is anonymous and must never require a login. It must therefore render correctly with `auth.profile()` null.

## Requirements

- Route `tournament-requests/:token` is anonymous and registered unconditionally, so the link works even in a build with `authV1` off.
- The page loads the proposal by token and renders every submitted field plus the description body, using the same presentation component the public tournament detail uses.
- Two actions: `Valider` (publishes, then shows a success panel linking to the published tournament) and `Refuser` (switches the page to the reason state).
- The reason state shows a `<textarea>` and a button labelled `Envoyer Email Raisons Annulation`, disabled while the textarea is empty; sending posts the reason and shows a confirmation.
- An unknown or expired token renders a clear "link expired" panel; an already-decided proposal renders an "already handled" panel. Neither leaks the payload.
- The page renders and is readable while signed out and while signed in.
- Every element carries a unique `data-cy`.

## Inputs

- `src/app/app.routes.ts:53-77` — `buildRoutes(features)` returns the unconditional routes (`''`, `about`, calendar routes, `leagues`, `live-tournaments`, `settings`, …) then spreads `authRoutes`, `registrationAndOrganizerRoutes` and `adminRoutes` behind the capability flags, then `app-error` and `**`. Register the new route in the **unconditional** section, before `app-error`.
- `src/app/features/calendar/tournament-detail-view.component.ts` — **do NOT reuse it here.** Its `@Input` is typed
  `PublicTournamentDetailResponse | TournamentPreviewRenderResponse` and its template unguardedly reads
  `organization.name`, `formats[].name`, `status`, `venue` as a nested object, and `venueStartDate`/`venueStartTime`/
  `startsAtUtc`. The proposal payload is `TournamentPayloadRequest` — flat `streetAddress`/`postalCode`/`city`/
  `country`, `startsAtLocal`/`endsAtLocal`, no `status`, no nested objects — so feeding it in would need a fabricated
  mapping. Render this page's own `<dl>` instead, straight from the review response. (An earlier draft of this ticket
  said to reuse the component; that was a defect, caught before implementation.)
- **From Depends (T19b):** `TournamentProposalReviewResponse` now also carries `organizationName: string` and
  `formatNames: string[]`, resolved server-side, so the page shows real names rather than GUIDs. `organizationName`
  is `''` when the organization was deleted after submission — render a dash in that case rather than an empty row.
- `src/app/features/calendar/server-sanitized-html.component.ts` — 67 lines, renders server-sanitized description HTML. The proposal's `bodyHtml` has **not** been through the server sanitizer, so render it through the same preview path `organizer-tournament-create.component.ts` uses (`POST /api/tournaments/preview`) or, if that requires an organizer, render the body as plain text. **Choose plain text**: the review page is anonymous and must not call an organizer-only endpoint.
- `src/app/api/generated/gones-api.ts` — already regenerated; exact names and shapes, verified in the file:
  - `byToken(token: string): Observable<TournamentProposalReviewResponse>` (`:419`)
  - `approve(token: string): Observable<TournamentProposalDecisionResponse>` (`:423`)
  - `reject(token: string, body: TournamentProposalRejectRequest): Observable<void>` (`:427`)
  - `TournamentProposalReviewResponse` (`:10979`) = `{ id, tournament: TournamentPayloadRequest, status, submittedByUsername, approverUsername, expiresAt }`
  - `TournamentProposalDecisionResponse` (`:10949`) = `{ proposalId, status, slug: string | undefined }` — note `slug` is optional, so the approved panel must tolerate its absence rather than assume a link target.
  - The rejection reason is capped at **500** characters, not 2000 — T17 bound the annotation to the domain constant. Set `maxlength="500"` on the textarea in step 8, not `2000`.
- **Test harness — there is no Angular `TestBed` and no zone.js in this repo**, and `@angular/common/http/testing` is
  not installed. Build the component with a bare `Injector` + `runInInjectionContext`, stubbing `effect()` to a no-op;
  copy `src/app/features/settings/account-settings.component.test.ts` or the calendar component test. Assert on
  component state and spy calls, never rendered DOM.
- `src/app/api/api-boundary.ts` — `ApiProblemError` with `status`; a `404` means unknown/expired, a `409` means already decided.
- `src/app/shared/back-button.component.ts` — `<gones-back-button [link]="['/']" [label]="…" position="top|bottom" />`, the standard top/bottom return control.
- `src/app/app.component.ts:225-265` — `buildBreadcrumbs(path)`; add a branch for `tournament-requests`.
- `src/app/i18n/messages.ts` — `const en = {` line 5, `const fr` line 1000; both maps.
- `src/app/shared/data-cy-coverage.test.ts` — new component files are not in `PENDING_DATA_CY_RETROFIT`, so every element must carry a `data-cy` from the first commit.
- **From Depends (T17):** the three token endpoints exist, are anonymous, IP rate-limited, and return `404` for unknown/expired and `409` for already-decided proposals. Approve publishes with the submitter as the acting user and returns the public slug. Reject requires a reason of 1..2000 characters and mails the submitter.

## TDD

1. **Red** — write `src/app/features/calendar/tournament-request.component.test.ts` and add the routing assertions to `src/app/data-mode-routes.test.ts`; both fail.
2. **Green** — add the component, the route and the breadcrumb branch.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `route exists without auth capability` | `buildRoutes({authV1:false, adminV1:false}).map(r => r.path)` | contains `'tournament-requests/:token'` |
| `route has no guard` | that route object | `canActivate` is undefined |
| `renders the proposal` | service resolving a payload with `organizationName: 'Gones'` and `formatNames: ['Legacy','Modern']` | `[data-cy=tournament-request-title]` shows the title; the facts list shows the venue line, both local dates, `Gones`, and both format names |
| `renders a dash for a deleted organization` | same with `organizationName: ''` | the organization row renders `—`, not an empty cell |
| `expired token shows the expired panel` | service rejecting with `404` | `[data-cy=tournament-request-expired]` present, no payload rendered |
| `decided proposal shows the handled panel` | reject with `409` | `[data-cy=tournament-request-handled]` present |
| `validate publishes and links to the tournament` | approve resolving `{ slug: 'x' }` | `[data-cy=tournament-request-approved]` present with a link to `/calendar/tournaments/x` |
| `refuse opens the reason state` | click `[data-cy=tournament-request-refuse]` | `[data-cy=tournament-request-reason]` textarea present; no request sent yet |
| `send is disabled without a reason` | reason state, empty textarea | `[data-cy=tournament-request-send-reason]` disabled |
| `send posts the reason` | type a reason, click send | reject client method called once with that reason |
| `send shows the confirmation` | reject resolving | `[data-cy=tournament-request-refused]` present |
| `renders while signed out` | `auth.profile()` null | no redirect, page renders |
| `data-cy coverage` | new files | suite green |

Run: `npm run test -- tournament-request data-mode-routes data-cy-coverage`

## Impl steps

- [x] 1. Extend `src/app/features/calendar/tournament-proposal.service.ts` (created in T18; create it here if T18 has not landed) with `reviewByToken(token: string)`, `approveByToken(token: string)` and `rejectByToken(token: string, reason: string)`, each a `firstValueFrom` around the generated client method.
- [x] 2. Create `src/app/features/calendar/tournament-request.component.ts` exporting `TournamentRequestComponent`, standalone, importing `RouterLink`, `FormsModule`, `MatButtonModule` and `BackButtonComponent`. **Not** `TournamentDetailViewComponent` — see Inputs.
- [x] 3. Read the token with `private readonly token = this.route.snapshot.paramMap.get('token') ?? '';`.
- [x] 4. Define the page state as `readonly state = signal<'loading' | 'review' | 'reason' | 'approved' | 'refused' | 'expired' | 'handled' | 'error'>('loading');` plus `readonly proposal = signal<TournamentProposalReviewResponse | null>(null)`, `readonly slug = signal('')`, `readonly reason = signal('')`, `readonly pending = signal(false)`.
- [x] 5. In the constructor, `void this.load();` — `load()` calls `reviewByToken(this.token)`, sets `proposal` and `state='review'`; on `ApiProblemError` with `status === 404` set `'expired'`, with `409` set `'handled'`, otherwise `'error'`.
- [x] 6. Template skeleton, each branch with its own `data-cy`:
  ```
  <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="tournament-request-back-top" />
  <section class="info-page" data-cy="tournament-request-page" aria-labelledby="tournament-request-title">
    @switch (state()) {
      @case ('loading') { <p role="status" data-cy="tournament-request-loading">…</p> }
      @case ('expired') { <section class="panel" data-cy="tournament-request-expired">…</section> }
      @case ('handled') { <section class="panel" data-cy="tournament-request-handled">…</section> }
      @case ('error')   { <section class="panel" role="alert" data-cy="tournament-request-error">… + retry button …</section> }
      @case ('review')  { …header + detail view + actions… }
      @case ('reason')  { …textarea + send button… }
      @case ('approved'){ <section class="panel" role="status" data-cy="tournament-request-approved">… link to /calendar/tournaments/{{ slug() }} …</section> }
      @case ('refused') { <section class="panel" role="status" data-cy="tournament-request-refused">…</section> }
    }
  </section>
  <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" data-cy="tournament-request-back-bottom" />
  ```
- [x] 7. In the `review` branch, render `<h1 id="tournament-request-title" data-cy="tournament-request-title">{{ proposal()!.tournament.title }}</h1>`, a paragraph naming the submitter, then a `<dl class="tournament-request-facts" data-cy="tournament-request-facts">` built directly from the review response — one `<dt>`/`<dd>` pair, each with its own `data-cy`, for: organization (`organizationName`, or `—` when empty), formats (`formatNames.join(', ')`), venue (`streetAddress`, `postalCode`, `city`, `country` joined into one line), start (`startsAtLocal`), end (`endsAtLocal`), time zone (`timeZoneId`), capacity, and summary. Then the description rendered as **plain text** inside `<pre class="tournament-request-body" data-cy="tournament-request-body">`, then two buttons: `[data-cy=tournament-request-validate]` (`class="home-primary-action"`, `(click)="approve()"`) and `[data-cy=tournament-request-refuse]` (`class="danger-ghost-action"`, `(click)="state.set('reason')"`).
- [x] 8. In the `reason` branch, render a label, `<textarea data-cy="tournament-request-reason" maxlength="2000" [ngModel]="reason()" (ngModelChange)="reason.set($event)">`, a cancel button returning to `review`, and `<button data-cy="tournament-request-send-reason" [disabled]="!reason().trim() || pending()" (click)="sendReason()">{{ i18n.t('proposal.sendCancellationReasons') }}</button>`.
- [x] 9. Implement `approve()` — guard `pending()`, call `approveByToken`, set `slug` and `state='approved'`; on `409` set `'handled'`, on `404` set `'expired'`.
- [x] 10. Implement `sendReason()` — guard `pending()`, call `rejectByToken(this.token, this.reason().trim())`, set `state='refused'`; map `404`/`409` the same way.
- [x] 11. Add these keys to BOTH maps in `src/app/i18n/messages.ts`:
  - `proposal.reviewTitle` — en `'Tournament request'`, fr `'Demande de tournoi'`
  - `proposal.submittedBy` — en `'Submitted by {username}'`, fr `'Proposé par {username}'`
  - `proposal.validate` — en `'Approve'`, fr `'Valider'`
  - `proposal.refuse` — en `'Decline'`, fr `'Refuser'`
  - `proposal.reasonLabel` — en `'Why are you declining?'`, fr `'Pourquoi refusez-vous ?'`
  - `proposal.sendCancellationReasons` — en `'Send cancellation reasons email'`, fr `'Envoyer Email Raisons Annulation'`
  - `proposal.approvedTitle` / `proposal.approvedBody` — en `'Tournament published'` / `'The tournament is now on the public calendar.'`, fr `'Tournoi publié'` / `'Le tournoi est désormais sur le calendrier public.'`
  - `proposal.refusedTitle` / `proposal.refusedBody` — en `'Request declined'` / `'The submitter received your reasons by email.'`, fr `'Demande refusée'` / `'Le proposant a reçu vos raisons par email.'`
  - `proposal.expiredTitle` / `proposal.expiredBody` — en `'Link expired'` / `'This review link is no longer valid.'`, fr `'Lien expiré'` / `'Ce lien de validation n’est plus valide.'`
  - `proposal.handledTitle` / `proposal.handledBody` — en `'Already handled'` / `'Another reviewer already decided on this request.'`, fr `'Déjà traitée'` / `'Un autre validateur a déjà décidé pour cette demande.'`
  - `crumb.tournamentRequest` — en `'Tournament request'`, fr `'Demande de tournoi'`
- [x] 12. Register the route in the unconditional block of `buildRoutes` in `src/app/app.routes.ts`, immediately after the calendar routes:
  ```
  { path: 'tournament-requests/:token', loadComponent: () => import('./features/calendar/tournament-request.component').then((m) => m.TournamentRequestComponent) },
  ```
- [x] 13. Add the two routing assertions to `src/app/data-mode-routes.test.ts`.
- [x] 14. Add a breadcrumb branch in `src/app/app.component.ts`'s `buildBreadcrumbs`: `if (segments[0] === 'tournament-requests') return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.tournamentRequest') }];`
- [x] 15. Add `.tournament-request-body { white-space: pre-wrap; word-break: break-word; padding: 1rem; border: 1px solid var(--steel); background: var(--black-metal); }` and `.tournament-request-facts { display: grid; grid-template-columns: minmax(8rem, auto) 1fr; gap: .35rem .75rem; margin: 0 0 1rem; } .tournament-request-facts dt { font-weight: 700; color: var(--dim-ash); } .tournament-request-facts dd { margin: 0; }` to `src/styles.css`.
- [x] 16. Create `src/app/features/calendar/tournament-request.component.test.ts` with Test plan rows 3-11, stubbing `TournamentProposalService`, `ActivatedRoute` and `AuthService`.
- [x] 17. Create `cypress/e2e/tournament-proposal.cy.js` — **intercept-based, signed out, no real login.** The original wording ("submit a proposal as a verified plain user, read the token from the mail sink") is not runnable here for two independent reasons, both verified: (a) a real sign-in costs one of only 5 auth permits per 15 minutes per IP on this host, a budget shared with every other ticket; and (b) the proposal tables have no grants for the local `gones_app` role yet — the compose `permissions` service granted privileges before those tables existed — so the deployed API on 5080 cannot read them regardless. Instead: `cy.intercept` `GET **/api/tournament-proposals/by-token/*` to return a `TournamentProposalReviewResponse` fixture, `POST **/api/tournament-proposals/by-token/*/approve` to return `{ proposalId, status: 'Approved', slug: 'x' }`, and `POST **/api/tournament-proposals/by-token/*/reject` to return 204. Then `cy.visit('/tournament-requests/faketoken')` **with no session at all** and drive: review renders → validate → `[data-cy=tournament-request-approved]`; and a second case refuse → reason → send → `[data-cy=tournament-request-refused]`. Also add a case stubbing `404` and asserting `[data-cy=tournament-request-expired]`. — validate: the spec passes and performs zero `/api/auth/*` calls.
  The genuine end-to-end (real submit → real mail sink → real token → real approve) is **deferred to T25**, which owns the acceptance matrix and can fix the grants first with `docker compose up -d permissions` or an explicit `GRANT` on the two proposal tables. Say so in the commit body.
- [x] 18. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [x] 19. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/tournament-proposal.cy.js,cypress/e2e/accessibility.cy.js`. (Host recipe used per parent brief: `dev:serve` + the Nix `LD_LIBRARY_PATH` + direct `cypress run` invocation — 14/14 passing.)
- [x] 20. Add the Cypress spec to the proposal row of `ops/acceptance-matrix.json` created in T17, then run `npm run acceptance:matrix`. (Also had to wire the new spec into `scripts/full-stack-ci.mjs`'s Cypress run list — the matrix gate requires every referenced spec to be reachable from there; not spelled out as a separate step in this ticket but required for step 20's own command to pass.)

## Outputs

- Files created: `src/app/features/calendar/tournament-request.component.ts`, `src/app/features/calendar/tournament-request.component.test.ts`, `cypress/e2e/tournament-proposal.cy.js`.
- Files touched: `src/app/features/calendar/tournament-proposal.service.ts`, `src/app/app.routes.ts`, `src/app/app.component.ts`, `src/app/data-mode-routes.test.ts`, `src/app/i18n/messages.ts`, `src/styles.css`, `ops/acceptance-matrix.json`.
- Public API / behavior change: new anonymous route `/tournament-requests/:token`.
- Migrate / config: none.

## Validation

- [x] `npm run test` passes (460/460, includes `tournament-request.component.test.ts`, the 2 new `data-mode-routes.test.ts` assertions and `data-cy-coverage.test.ts`)
- [x] `npm run lint && npm run typecheck && npm run build` pass
- [x] `npm run cy:run -- --spec cypress/e2e/tournament-proposal.cy.js,cypress/e2e/accessibility.cy.js` passes (run via the host recipe: `dev:serve` + Nix `LD_LIBRARY_PATH` + direct `cypress run`; 14/14 passing)
- [x] `npm run acceptance:matrix` passes (90/90 non-deferred rows proved, 3 deferred, 24/24 checklist rows)
- [x] manual check (**deferred to T25**, blocked on the missing `gones_app` grants for the proposal tables and on the shared auth-permit budget — recorded as deferred rather than faked): open a real token link in a private window, approve it, see the tournament on `/calendar`; refuse a second one and find the reason mail in the sink; replay a used token and see the "already handled" panel. The intercepted Cypress cases in step 17 cover the same UI states.
- [x] app functional — the page renders signed out with no redirect (component test "renders while signed out" + Cypress specs run with no session at all)
- [x] commit msg draft: `feat(tournaments): review, approve or decline a tournament request from its mail link`
