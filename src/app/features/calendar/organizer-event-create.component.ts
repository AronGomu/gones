import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import { Client, PublicFormatResponse, EventManagementResponse, EventPreviewRenderResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { AuthService } from '../../auth/auth.service';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { EventDetailViewComponent } from './event-detail-view.component';
import { ApproverSelectionDialogComponent } from './approver-selection-dialog.component';
import { PreviewPublicationState, browserTimeZoneSuggestion, eventPayload } from './organizer-event-create';
import { EventProposalService, sortApprovers } from './event-proposal.service';
import { changedEventFields, majorEventChanges, managementToDetail, managementToDraft, eventUpdatePayload } from './event-management';

type RecoveryAction = 'reload' | 'login' | 'review-calendar' | 'refresh-preview' | 'retry';
interface RecoveryError { message: string; action: RecoveryAction; }

/**
 * The picker needs an id and a label and nothing else, which lets the two lists behind it — the
 * caller's own memberships and the anonymous public catalogue — feed the same `<select>`.
 */
export interface EventOrganizationOption { id: string; name: string; }

/**
 * Neither the public catalogue nor the admin catalogue is paginated in the picker, so both are
 * pulled page by page at the endpoint's cap, under the same ceiling.
 */
const PublicOrganizationPageSize = 100;
const MaximumPublicOrganizationPages = 20;

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatDialogModule, EventDetailViewComponent],
  template: `
    <section class="organizer-tournament-create stack" [attr.data-cy]="editMode ? 'organizer-event-edit' : 'organizer-event-create'" aria-labelledby="organizer-event-title">
      <header class="page-heading" data-cy="event-create-header">
        <div data-cy="event-create-heading-group"><h1 id="organizer-event-title" data-cy="event-create-title">{{ editMode ? i18n.t('tournamentManage.editTitle') : editing() ? i18n.t('tournamentCreate.title') : i18n.t('tournamentCreate.previewTitle') }}</h1></div>
        @if (editMode) { <a mat-stroked-button routerLink="/organizer/tournaments" data-cy="event-create-back-to-list">{{ i18n.t('tournamentManage.backToList') }}</a> }
      </header>

      @if (loadingReferences()) { <p role="status" data-cy="event-loading-references">{{ i18n.t('tournamentCreate.loadingReferences') }}</p> }
      @if (referenceError()) {
        <div class="error stack" role="alert" data-cy="event-reference-error"><span data-cy="event-reference-error-message">{{ referenceError() }}</span><button mat-stroked-button type="button" data-cy="event-reference-retry" (click)="loadReferences()">{{ i18n.t('common.retry') }}</button></div>
      }

      @if (proposalSentCount(); as count) {
        <section class="panel" role="status" data-cy="event-proposal-sent">
          <h2 data-cy="event-proposal-sent-title">{{ i18n.t('proposal.sentTitle') }}</h2>
          <p data-cy="event-proposal-sent-body">{{ i18n.t('proposal.sentBody', { count }) }}</p>
          <a mat-stroked-button routerLink="/calendar" data-cy="event-proposal-sent-back">{{ i18n.t('nav.returnToMenu') }}</a>
        </section>
      } @else if (editing()) {
        <form class="panel tournament-create-form" data-cy="event-create-form" [formGroup]="form" (ngSubmit)="editMode ? saveEdit() : requestPreview()" novalidate [attr.aria-busy]="formPending()">
          <p class="muted tournament-create-help" data-cy="event-create-zone-note">{{ i18n.t('tournamentCreate.zoneHelp') }}</p>
          <fieldset class="tournament-form-lock" data-cy="event-fieldset" [disabled]="formPending()">
          <div class="tournament-create-grid" data-cy="event-create-grid">
            <div class="tournament-create-field tournament-create-wide" data-cy="event-field-title">
              <label for="event-title-input" data-cy="event-label-title">{{ i18n.t('tournamentCreate.name') }}</label>
              <input #titleInput id="event-title-input" data-cy="event-title" formControlName="title" autocomplete="off" [attr.aria-invalid]="fieldError('title') ? 'true' : null" [attr.aria-describedby]="fieldError('title') ? 'event-title-error' : null" />
              @if (fieldError('title'); as message) { <p id="event-title-error" class="field-error" data-cy="event-title-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-organization">
              <label for="event-organization" data-cy="event-label-organization">{{ i18n.t('tournamentCreate.organization') }}</label>
              <select id="event-organization" data-cy="event-organization" formControlName="organizationId" [attr.aria-invalid]="fieldError('organizationId') ? 'true' : null" [attr.aria-describedby]="fieldError('organizationId') ? 'event-organization-error' : null">
                @for (organization of organizations(); track organization.id) { <option [value]="organization.id" [attr.data-cy]="'event-organization-option-' + organization.id">{{ organization.name }}</option> }
              </select>
              @if (fieldError('organizationId'); as message) { <p id="event-organization-error" class="field-error" data-cy="event-organization-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-double" data-cy="event-field-summary">
              <label for="event-summary" data-cy="event-label-summary">{{ i18n.t('tournamentCreate.summary') }}</label>
              <input id="event-summary" data-cy="event-summary" formControlName="summary" maxlength="50" [attr.aria-invalid]="fieldError('summary') ? 'true' : null" [attr.aria-describedby]="fieldError('summary') ? 'event-summary-error' : null" />
              @if (fieldError('summary'); as message) { <p id="event-summary-error" class="field-error" data-cy="event-summary-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-wide" data-cy="event-field-body">
              <label for="event-body" data-cy="event-label-body">{{ i18n.t('tournamentCreate.body') }}</label>
              <textarea id="event-body" data-cy="event-body" formControlName="bodyHtml" rows="7" [attr.aria-invalid]="fieldError('bodyHtml') ? 'true' : null" [attr.aria-describedby]="fieldError('bodyHtml') ? 'event-body-error event-body-help' : 'event-body-help'"></textarea>
              <p id="event-body-help" class="muted" data-cy="event-body-help">{{ i18n.t('tournamentCreate.bodyHelp') }}</p>
              @if (fieldError('bodyHtml'); as message) { <p id="event-body-error" class="field-error" data-cy="event-body-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-double" data-cy="event-field-street">
              <label for="event-street" data-cy="event-label-street">{{ i18n.t('tournamentCreate.street') }}</label>
              <input #streetInput id="event-street" data-cy="event-street" formControlName="streetAddress" autocomplete="street-address" [attr.aria-invalid]="fieldError('streetAddress') ? 'true' : null" [attr.aria-describedby]="fieldError('streetAddress') ? 'event-street-error' : null" />
              @if (fieldError('streetAddress'); as message) { <p id="event-street-error" class="field-error" data-cy="event-street-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-postal-code">
              <label for="event-postal-code" data-cy="event-label-postal-code">{{ i18n.t('tournamentCreate.postalCode') }}</label>
              <input id="event-postal-code" data-cy="event-postal-code" formControlName="postalCode" autocomplete="postal-code" />
            </div>
            <div class="tournament-create-field" data-cy="event-field-city">
              <label for="event-city" data-cy="event-label-city">{{ i18n.t('calendar.city') }}</label>
              <input id="event-city" data-cy="event-city" formControlName="city" autocomplete="address-level2" [attr.aria-invalid]="fieldError('city') ? 'true' : null" [attr.aria-describedby]="fieldError('city') ? 'event-city-error' : null" />
              @if (fieldError('city'); as message) { <p id="event-city-error" class="field-error" data-cy="event-city-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-country">
              <label for="event-country" data-cy="event-label-country">{{ i18n.t('tournamentCreate.country') }}</label>
              <input id="event-country" data-cy="event-country" formControlName="country" autocomplete="country-name" [attr.aria-invalid]="fieldError('country') ? 'true' : null" [attr.aria-describedby]="fieldError('country') ? 'event-country-error' : null" />
              @if (fieldError('country'); as message) { <p id="event-country-error" class="field-error" data-cy="event-country-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-start">
              <label for="event-start" data-cy="event-label-start">{{ i18n.t('tournamentCreate.start') }}</label>
              <input id="event-start" data-cy="event-start" type="datetime-local" formControlName="startsAtLocal" [attr.aria-invalid]="fieldError('startsAtLocal') ? 'true' : null" [attr.aria-describedby]="fieldError('startsAtLocal') ? 'event-start-error' : null" />
              @if (fieldError('startsAtLocal'); as message) { <p id="event-start-error" class="field-error" data-cy="event-start-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-end">
              <label for="event-end" data-cy="event-label-end">{{ i18n.t('tournamentCreate.end') }}</label>
              <input id="event-end" data-cy="event-end" type="datetime-local" formControlName="endsAtLocal" [attr.aria-invalid]="fieldError('endsAtLocal') ? 'true' : null" [attr.aria-describedby]="fieldError('endsAtLocal') ? 'event-end-error' : null" />
              @if (fieldError('endsAtLocal'); as message) { <p id="event-end-error" class="field-error" data-cy="event-end-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-zone">
              <label for="event-zone" data-cy="event-label-zone">{{ i18n.t('tournamentCreate.zone') }}</label>
              <input id="event-zone" data-cy="event-zone" formControlName="timeZoneId" autocomplete="off" [attr.aria-invalid]="fieldError('timeZoneId') ? 'true' : null" [attr.aria-describedby]="fieldError('timeZoneId') ? 'event-zone-error event-zone-help' : 'event-zone-help'" />
              <p id="event-zone-help" class="muted" data-cy="event-zone-help">{{ i18n.t('tournamentCreate.zoneSuggestion') }}</p>
              @if (fieldError('timeZoneId'); as message) { <p id="event-zone-error" class="field-error" data-cy="event-zone-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field" data-cy="event-field-capacity">
              <label for="event-capacity" data-cy="event-label-capacity">{{ i18n.t('calendar.capacity') }}</label>
              <input id="event-capacity" data-cy="event-capacity" type="number" min="1" step="1" formControlName="capacity" [attr.aria-invalid]="fieldError('capacity') ? 'true' : null" [attr.aria-describedby]="fieldError('capacity') ? 'event-capacity-error' : null" />
              @if (fieldError('capacity'); as message) { <p id="event-capacity-error" class="field-error" data-cy="event-capacity-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-double" data-cy="event-field-formats">
              <label for="event-formats" data-cy="event-label-formats">{{ i18n.t('tournamentCreate.formats') }}</label>
              <select id="event-formats" data-cy="event-formats" formControlName="formatIds" multiple [attr.aria-invalid]="fieldError('formatIds') ? 'true' : null" [attr.aria-describedby]="fieldError('formatIds') ? 'event-formats-error event-formats-help' : 'event-formats-help'">
                @for (format of formats(); track format.id) { <option [value]="format.id" [attr.data-cy]="'event-format-option-' + format.id">{{ format.name }}</option> }
              </select>
              <p id="event-formats-help" class="muted" data-cy="event-formats-help">{{ i18n.t('tournamentCreate.formatsHelp') }}</p>
              @if (fieldError('formatIds'); as message) { <p id="event-formats-error" class="field-error" data-cy="event-formats-error">{{ message }}</p> }
            </div>
          </div>
          </fieldset>
          @if (staleEvent(); as latest) {
            <div class="warning stack" role="alert" data-cy="event-stale">
              <strong data-cy="event-stale-title">{{ i18n.t('tournamentManage.staleTitle') }}</strong>
              <p data-cy="event-stale-body">{{ i18n.t('tournamentManage.staleBody', { title: latest.title }) }}</p>
              @if (staleChanges().length) { <ul data-cy="event-stale-changes">@for (change of staleChanges(); track change) { <li [attr.data-cy]="'event-stale-change-' + $index">{{ change }}</li> }</ul> }
              <p data-cy="event-stale-preserved">{{ i18n.t('tournamentManage.draftPreserved') }}</p>
              <button mat-stroked-button type="button" data-cy="event-reload-latest" (click)="reloadLatest()">{{ i18n.t('tournamentManage.reloadLatest') }}</button>
            </div>
          }
          @if (success()) { <p role="status" class="success" data-cy="event-edit-success">{{ success() }}</p> }
          @if (submitError(); as error) {
            <div class="error tournament-create-recovery" role="alert" data-cy="event-submit-error">
              <span data-cy="event-submit-error-message">{{ error.message }}</span>
              @if (error.action === 'reload') { <button mat-stroked-button type="button" data-cy="reload-organizations" (click)="loadReferences()">{{ i18n.t('tournamentCreate.reloadOrganizations') }}</button> }
              @if (error.action === 'login') { <a mat-stroked-button [routerLink]="['/login']" [queryParams]="{ returnUrl: '/organizer/tournaments/new' }" target="_blank" rel="noopener noreferrer" data-cy="event-submit-error-login">{{ i18n.t('tournamentCreate.signInAgain') }}</a> }
              @if (error.action === 'retry') { <button mat-stroked-button type="submit" data-cy="event-submit-error-retry">{{ i18n.t('common.retry') }}</button> }
            </div>
          }
          <div class="actions" data-cy="event-create-actions">
            @if (canPublishDirectly()) {
              <button #saveButton mat-flat-button class="home-primary-action" type="submit" [attr.data-cy]="editMode ? 'event-save' : 'event-preview-submit'" [disabled]="formPending() || loadingReferences() || !organizations().length">{{ editMode ? (saving() ? i18n.t('tournamentManage.saving') : i18n.t('common.save')) : (previewing() ? i18n.t('tournamentCreate.previewing') : i18n.t('tournamentCreate.preview')) }}</button>
            } @else {
              <p class="warning" role="status" data-cy="event-approval-notice">{{ i18n.t('tournamentCreate.approvalNotice') }}</p>
              <button mat-flat-button class="home-primary-action" type="button" data-cy="event-submit-for-approval" [disabled]="proposalPending() || loadingReferences() || !organizationSelected()" (click)="submitForApproval()">{{ i18n.t('tournamentCreate.submitForApproval') }}</button>
              @if (proposalError()) { <p class="error" role="alert" data-cy="event-proposal-error">{{ proposalError() }}</p> }
            }
          </div>
        </form>
        @if (editMode && currentRender(); as rendered) {
          <section class="stack" aria-labelledby="current-event-title" data-cy="event-current-details"><h2 id="current-event-title" data-cy="event-current-details-title">{{ i18n.t('tournamentManage.currentPublicDetails') }}</h2><gones-event-detail-view [event]="rendered" data-cy="event-current-detail-view" /></section>
        }
      } @else if (preview(); as currentPreview) {
        <p class="warning" role="status" data-cy="event-preview-notice">{{ i18n.t('tournamentCreate.previewNotice') }}</p>
        <gones-event-detail-view [event]="currentPreview" data-cy="event-preview-detail-view" />
        @if (publishError(); as error) {
          <div class="error tournament-create-recovery" role="alert" data-cy="event-publish-error">
            <span data-cy="event-publish-error-message">{{ error.message }}</span>
            @if (error.action === 'login') { <a mat-stroked-button [routerLink]="['/login']" [queryParams]="{ returnUrl: '/organizer/tournaments/new' }" target="_blank" rel="noopener noreferrer" data-cy="event-publish-error-login">{{ i18n.t('tournamentCreate.signInAgain') }}</a> }
            @if (error.action === 'reload') { <button mat-stroked-button type="button" data-cy="event-publish-error-reload" (click)="reloadOrganizationAccess()">{{ i18n.t('tournamentCreate.reloadOrganizations') }}</button> }
            @if (error.action === 'review-calendar') { <a mat-stroked-button routerLink="/calendar" data-cy="event-review-calendar">{{ i18n.t('tournamentCreate.reviewCalendar') }}</a> }
            @if (error.action === 'refresh-preview') { <button mat-stroked-button type="button" data-cy="event-refresh-preview" (click)="refreshPreview()">{{ i18n.t('tournamentCreate.refreshPreview') }}</button> }
          </div>
        }
        <div class="actions tournament-preview-actions" data-cy="event-preview-actions">
          <button mat-stroked-button type="button" data-cy="event-back-edit" [disabled]="publishing()" (click)="backToEdit()">{{ i18n.t('tournamentCreate.backEdit') }}</button>
          <button mat-flat-button class="home-primary-action" type="button" data-cy="event-publish" [disabled]="publishing()" (click)="publish()">{{ publishing() ? i18n.t('tournamentCreate.publishing') : i18n.t('tournamentCreate.publish') }}</button>
        </div>
      }
    </section>
  `
})
export class OrganizerEventCreateComponent implements OnInit, AfterViewInit {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);
  private readonly proposals = inject(EventProposalService);
  private readonly state = new PreviewPublicationState();
  private readonly eventId = this.route.snapshot.paramMap.get('id');
  readonly editMode = Boolean(this.eventId);
  @ViewChild('titleInput') private titleInput?: ElementRef<HTMLInputElement>;
  @ViewChild('streetInput') private streetInput?: ElementRef<HTMLInputElement>;
  @ViewChild('saveButton') private saveButton?: ElementRef<HTMLButtonElement>;

  readonly organizations = signal<EventOrganizationOption[]>([]);
  readonly formats = signal<PublicFormatResponse[]>([]);
  readonly loadingReferences = signal(true);
  readonly referenceError = signal('');
  readonly editing = signal(true);
  readonly preview = signal<EventPreviewRenderResponse | null>(null);
  readonly previewing = signal(false);
  readonly publishing = signal(false);
  readonly saving = signal(false);
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly submitError = signal<RecoveryError | null>(null);
  readonly publishError = signal<RecoveryError | null>(null);
  readonly baseEvent = signal<EventManagementResponse | null>(null);
  readonly staleEvent = signal<EventManagementResponse | null>(null);
  readonly staleChanges = signal<string[]>([]);
  readonly currentRender = signal<EventPreviewRenderResponse | null>(null);
  readonly success = signal('');
  readonly formPending = computed(() => this.previewing() || this.saving());
  readonly canPublishDirectly = computed(() => {
    const role = this.auth.profile()?.globalRole;
    return role === 'Organizer' || role === 'Admin';
  });
  private readonly isAdmin = computed(() => this.auth.profile()?.globalRole === 'Admin');
  readonly proposalPending = signal(false);
  readonly proposalSentCount = signal<number | null>(null);
  readonly proposalError = signal('');
  /** Mirrors the form control so the template can react to it; a `FormControl` value is not a signal. */
  readonly selectedOrganizationId = signal('');
  /**
   * T26: the approval button used to stay clickable with an empty picker, so it ran, found the form
   * invalid and returned in silence. Nothing can be proposed without an organization to propose it
   * for, so say so in the control rather than in a dead click.
   */
  readonly organizationSelected = computed(() =>
    this.organizations().some(option => option.id === this.selectedOrganizationId()));

  readonly form = new FormGroup({
    organizationId: new FormControl('', { nonNullable: true, validators: Validators.required }),
    title: new FormControl('', { nonNullable: true, validators: Validators.required }),
    summary: new FormControl('', { nonNullable: true, validators: Validators.maxLength(50) }),
    bodyHtml: new FormControl('', { nonNullable: true }),
    streetAddress: new FormControl('', { nonNullable: true, validators: Validators.required }),
    postalCode: new FormControl('', { nonNullable: true }),
    city: new FormControl('', { nonNullable: true, validators: Validators.required }),
    country: new FormControl('', { nonNullable: true, validators: Validators.required }),
    timeZoneId: new FormControl(browserTimeZoneSuggestion(), { nonNullable: true, validators: Validators.required }),
    startsAtLocal: new FormControl('', { nonNullable: true, validators: Validators.required }),
    endsAtLocal: new FormControl('', { nonNullable: true }),
    capacity: new FormControl<number | null>(null, [Validators.min(1), Validators.pattern(/^\d+$/)]),
    formatIds: new FormControl<string[]>([], { nonNullable: true, validators: Validators.required })
  });

  ngOnInit(): void {
    this.form.valueChanges.subscribe(() => {
      this.syncSelectedOrganization();
      this.fieldErrors.set({});
      this.submitError.set(null);
      this.success.set('');
      if (this.state.preview) {
        this.state.invalidate();
        this.preview.set(null);
        this.publishError.set(null);
      }
    });
    void this.loadReferences();
  }

  ngAfterViewInit(): void { queueMicrotask(() => this.titleInput?.nativeElement.focus()); }

  async loadReferences(): Promise<void> {
    this.loadingReferences.set(true);
    this.referenceError.set('');
    this.submitError.set(null);
    try {
      const formats = await firstValueFrom(this.client.formatsAll());
      this.formats.set(formats);
      if (this.editMode) {
        const event = await this.findEvent(this.eventId!);
        this.organizations.set([{ id: event.organizationId, name: event.organizationName }]);
        this.form.controls.organizationId.disable({ emitEvent: false });
        this.applyCanonical(event);
      } else {
        const organizations = await this.loadOrganizationOptions();
        this.organizations.set(organizations);
        if (!organizations.some(item => item.id === this.form.controls.organizationId.value)) {
          this.form.controls.organizationId.setValue(organizations[0]?.id ?? '');
        }
        if (!organizations.length) this.referenceError.set(this.i18n.t('tournamentCreate.noOrganizations'));
      }
      this.syncSelectedOrganization();
    } catch {
      this.organizations.set([]);
      this.formats.set([]);
      this.syncSelectedOrganization();
      this.referenceError.set(this.editMode ? this.i18n.t('tournamentManage.loadFailed') : this.i18n.t('tournamentCreate.referencesFailed'));
    } finally {
      this.loadingReferences.set(false);
    }
  }

  /**
   * The picked organization drives both the submit button's disabled state and the approver
   * request, so it is mirrored into a signal wherever the control can move: user edits, and the
   * default selection loading the references applies.
   */
  private syncSelectedOrganization(): void {
    this.selectedOrganizationId.set(this.form.getRawValue().organizationId);
  }

  /**
   * T26. Two different questions, two different lists. Publishing directly is gated on the caller's
   * own membership, so an organizer is only offered organizations they belong to — anything else
   * would only earn a refusal at publish time. Proposing is the opposite case: the submitter is by
   * definition not a member of the organization they are proposing for, so the picker reads the
   * anonymous public catalogue. Offering it costs nothing, because the approver on the other end
   * must represent that organization before anything is published.
   *
   * T14 adds the third question. The server treats an admin as a member of every organization, so
   * an admin's own memberships — usually none — are the wrong list: they read the admin catalogue
   * instead. When that admin-only call is what failed, the picker falls back to the organizer path
   * rather than showing an admin nothing at all.
   */
  private async loadOrganizationOptions(): Promise<EventOrganizationOption[]> {
    if (this.isAdmin()) {
      try {
        return await this.loadAdminOrganizations();
      } catch {
        // Fall through to the membership list below.
      }
    }
    if (this.canPublishDirectly()) {
      return (await firstValueFrom(this.client.organizationsAll())).map(item => ({ id: item.id, name: item.name }));
    }
    return this.loadPublicOrganizations();
  }

  /**
   * The admin catalogue lists every organization, including the two kinds publishing still refuses:
   * a soft-deleted one, and a Draft — an organization nobody staffs yet, which answers
   * `organization_is_draft` (T11). Offering either would only produce a refusal at publish time, so
   * they are left out here. Pages are counted by rows read, not rows kept, so filtering cannot make
   * the loop believe the list is unfinished.
   */
  private async loadAdminOrganizations(): Promise<EventOrganizationOption[]> {
    const options: EventOrganizationOption[] = [];
    let read = 0;
    for (let page = 1; page <= MaximumPublicOrganizationPages; page++) {
      const response = await firstValueFrom(this.client.organizationsGET3(undefined, false, page, PublicOrganizationPageSize));
      const items = response.items ?? [];
      read += items.length;
      options.push(...items
        .filter(item => item.isDraft !== true && item.deletedAt == null)
        .map(item => ({ id: item.id, name: item.name })));
      if (!items.length || read >= response.totalCount) break;
    }
    return options.sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Pages are pulled at the endpoint's maximum size until the reported total is covered, so an
   * organization never becomes unproposable just because its name sorts past the first page. The
   * page ceiling is a stop, not a limit: it bounds a loop against a server that keeps claiming a
   * total it never delivers.
   */
  private async loadPublicOrganizations(): Promise<EventOrganizationOption[]> {
    const options: EventOrganizationOption[] = [];
    for (let page = 1; page <= MaximumPublicOrganizationPages; page++) {
      const response = await firstValueFrom(this.client.organizationsGET(undefined, page, PublicOrganizationPageSize));
      options.push(...response.items.map(item => ({ id: item.id, name: item.name })));
      if (!response.items.length || options.length >= response.totalCount) break;
    }
    return options;
  }

  async requestPreview(): Promise<void> {
    this.form.markAllAsTouched();
    this.fieldErrors.set({});
    this.submitError.set(null);
    if (this.form.invalid || this.previewing()) return;
    this.previewing.set(true);
    try {
      const response = await firstValueFrom(this.client.preview(eventPayload(this.form.getRawValue())));
      this.state.accept(response);
      this.preview.set(response.render);
      this.editing.set(false);
      this.publishError.set(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      this.applyFieldErrors(error);
      this.submitError.set(this.recovery(error, 'preview'));
    } finally {
      this.previewing.set(false);
    }
  }

  async submitForApproval(): Promise<void> {
    this.form.markAllAsTouched();
    this.fieldErrors.set({});
    if (this.form.invalid || this.proposalPending()) return;
    // T26: the chosen organization decides who may review, so it travels with the request that
    // fills the dialog. The dialog then only ever shows people who represent it.
    const organizationId = this.form.getRawValue().organizationId;
    let approvers;
    try {
      approvers = sortApprovers(await this.proposals.listApprovers(organizationId));
    } catch {
      this.proposalError.set(this.i18n.t('proposal.loadApproversFailed'));
      return;
    }
    // Global Admins back every organization, so an empty list means something is wrong rather than
    // that nobody is entitled. An empty checkbox dialog would be a dead end; say it instead.
    if (!approvers.length) {
      this.proposalError.set(this.i18n.t('proposal.noApprovers'));
      return;
    }
    const recipientUserIds = await firstValueFrom(this.dialog.open(ApproverSelectionDialogComponent, {
      data: { approvers }
    }).afterClosed());
    if (!recipientUserIds?.length) return;
    this.proposalPending.set(true);
    this.proposalError.set('');
    try {
      const response = await this.proposals.submit(eventPayload(this.form.getRawValue()), recipientUserIds);
      this.proposalSentCount.set(response.recipientCount);
    } catch (error) {
      this.applyFieldErrors(error);
      this.proposalError.set(this.i18n.t('proposal.submitFailed'));
    } finally {
      this.proposalPending.set(false);
    }
  }

  backToEdit(): void {
    this.editing.set(true);
    queueMicrotask(() => this.titleInput?.nativeElement.focus());
  }

  refreshPreview(): void {
    this.state.invalidate();
    this.preview.set(null);
    this.publishError.set(null);
    this.editing.set(true);
    queueMicrotask(() => this.titleInput?.nativeElement.focus());
  }

  reloadOrganizationAccess(): void {
    this.refreshPreview();
    void this.loadReferences();
  }

  async publish(): Promise<void> {
    if (!this.state.preview || this.publishing()) return;
    this.publishing.set(true);
    this.publishError.set(null);
    const key = this.state.idempotencyKey(() => globalThis.crypto.randomUUID());
    try {
      const response = await firstValueFrom(this.client.eventsPOST(key, {
        previewTicket: this.state.preview.previewTicket,
        payload: eventPayload(this.form.getRawValue())
      }));
      await this.router.navigate(['/calendar/tournaments', response.slug]);
    } catch (error) {
      this.publishError.set(this.recovery(error, 'publish'));
    } finally {
      this.publishing.set(false);
    }
  }

  async saveEdit(): Promise<void> {
    this.form.markAllAsTouched();
    this.fieldErrors.set({});
    this.submitError.set(null);
    this.success.set('');
    const base = this.baseEvent();
    if (!this.eventId || !base || this.form.invalid || this.saving()) return;
    const draft = this.form.getRawValue();
    const major = majorEventChanges(base, draft, field => this.i18n.t(`tournamentManage.major.${field}`));
    if (major.length) {
      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: this.i18n.t('tournamentManage.majorTitle'),
          message: this.i18n.t('tournamentManage.majorBody') + '\n\n' + major.map(change => `• ${change}`).join('\n'),
          confirmLabel: this.i18n.t('tournamentManage.saveChanges')
        }
      }).afterClosed());
      if (!confirmed) return;
    }

    this.saving.set(true);
    try {
      const response = await firstValueFrom(this.client.updateEventDetails(
        this.eventId,
        base.eTag,
        eventUpdatePayload(draft)
      ));
      this.applyCanonical(response);
      this.staleEvent.set(null);
      this.staleChanges.set([]);
      this.success.set(this.i18n.t('tournamentManage.saved'));
      queueMicrotask(() => this.saveButton?.nativeElement.focus());
    } catch (error) {
      this.applyFieldErrors(error);
      if (error instanceof ApiProblemError && error.status === 412) {
        await this.loadStaleEvent(base);
      } else {
        this.submitError.set({ message: this.managementError(error), action: 'retry' });
      }
    } finally {
      this.saving.set(false);
    }
  }

  reloadLatest(): void {
    const latest = this.staleEvent();
    if (!latest) return;
    this.applyCanonical(latest);
    this.staleEvent.set(null);
    this.staleChanges.set([]);
    this.submitError.set(null);
    this.success.set(this.i18n.t('tournamentManage.reloaded'));
    queueMicrotask(() => this.streetInput?.nativeElement.focus());
  }

  fieldError(name: keyof typeof this.form.controls): string {
    const serverError = this.fieldErrors()[name];
    if (serverError) return serverError;
    const control = this.form.controls[name];
    if (!control.touched || !control.errors) return '';
    if (control.errors['required']) return this.i18n.t('tournamentCreate.required');
    if (control.errors['maxlength']) return this.i18n.t('tournamentCreate.summaryTooLong');
    return this.i18n.t('tournamentCreate.invalid');
  }

  private async findEvent(id: string): Promise<EventManagementResponse> {
    let page = 1;
    while (true) {
      const response = await firstValueFrom(this.client.listOrganizerEvents(page, 100));
      const found = response.items.find(item => item.id === id);
      if (found) return found;
      if (page * response.pageSize >= response.totalCount) throw new Error('Event not found.');
      page += 1;
    }
  }

  private applyCanonical(event: EventManagementResponse): void {
    this.baseEvent.set(event);
    this.form.patchValue(managementToDraft(event), { emitEvent: false });
    this.currentRender.set(managementToDetail(event, this.formats()));
  }

  private async loadStaleEvent(base: EventManagementResponse): Promise<void> {
    try {
      const latest = await this.findEvent(base.id);
      this.staleEvent.set(latest);
      this.staleChanges.set(changedEventFields(base, latest, field => this.i18n.t('tournamentManage.serverChanged', { field: this.i18n.t(`tournamentManage.field.${field}`) })));
    } catch {
      this.submitError.set({ message: this.i18n.t('tournamentManage.latestLoadFailed'), action: 'retry' });
    }
  }

  private managementError(error: unknown): string {
    if (error instanceof ApiProblemError) {
      if (error.status === 401) return this.i18n.t('tournamentCreate.unauthorized');
      if (error.status === 403 || error.status === 404) return this.i18n.t('tournamentManage.forbidden');
      if (error.status === 409) return this.i18n.t('tournamentManage.cutoffRejected');
      if (error.problem.errors) return this.i18n.t('tournamentCreate.validationFailed');
    }
    return this.i18n.t('tournamentManage.actionFailed');
  }

  private applyFieldErrors(error: unknown): void {
    if (!(error instanceof ApiProblemError) || !error.problem.errors) return;
    const mapped: Record<string, string> = {};
    const names: Record<string, keyof typeof this.form.controls> = {
      organizationid: 'organizationId', title: 'title', summary: 'summary', bodyhtml: 'bodyHtml', streetaddress: 'streetAddress',
      postalcode: 'postalCode', city: 'city', country: 'country', timezoneid: 'timeZoneId', startsatlocal: 'startsAtLocal',
      endsatlocal: 'endsAtLocal', capacity: 'capacity', formatids: 'formatIds', payload: 'title'
    };
    for (const [field, messages] of Object.entries(error.problem.errors)) {
      const name = names[field.replace(/[^a-z]/gi, '').toLowerCase()];
      if (name && messages[0]) mapped[name] = messages[0];
    }
    this.fieldErrors.set(mapped);
  }

  private recovery(error: unknown, phase: 'preview' | 'publish'): RecoveryError {
    if (error instanceof ApiProblemError) {
      if (error.status === 401) return { message: this.i18n.t('tournamentCreate.unauthorized'), action: 'login' };
      if (error.status === 403 || error.status === 404) return { message: this.i18n.t('tournamentCreate.forbidden'), action: 'reload' };
      if (error.status === 409) return { message: this.i18n.t('tournamentCreate.conflict'), action: 'review-calendar' };
      if (error.problem.code === 'invalid_preview_ticket') return { message: this.i18n.t('tournamentCreate.expiredPreview'), action: 'refresh-preview' };
      if (error.problem.errors) return { message: this.i18n.t('tournamentCreate.validationFailed'), action: 'retry' };
    }
    return { message: phase === 'publish' ? this.i18n.t('tournamentCreate.publishNetwork') : this.i18n.t('tournamentCreate.previewNetwork'), action: 'retry' };
  }
}
