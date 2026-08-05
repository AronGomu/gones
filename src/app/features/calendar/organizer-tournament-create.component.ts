import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import { Client, MyOrganizationResponse, PublicFormatResponse, TournamentManagementResponse, TournamentPreviewRenderResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { TournamentDetailViewComponent } from './tournament-detail-view.component';
import { PreviewPublicationState, browserTimeZoneSuggestion, tournamentPayload } from './organizer-tournament-create';
import { changedTournamentFields, majorTournamentChanges, managementToDetail, managementToDraft, tournamentUpdatePayload } from './tournament-management';

type RecoveryAction = 'reload' | 'login' | 'review-calendar' | 'refresh-preview' | 'retry';
interface RecoveryError { message: string; action: RecoveryAction; }

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatDialogModule, TournamentDetailViewComponent],
  template: `
    <section class="organizer-tournament-create stack" [attr.data-cy]="editMode ? 'organizer-tournament-edit' : 'organizer-tournament-create'" aria-labelledby="organizer-tournament-title">
      <header class="page-heading">
        <div><p class="kicker">{{ i18n.t('tournamentCreate.kicker') }}</p><h1 id="organizer-tournament-title">{{ editMode ? i18n.t('tournamentManage.editTitle') : editing() ? i18n.t('tournamentCreate.title') : i18n.t('tournamentCreate.previewTitle') }}</h1></div>
        @if (editMode) { <a mat-stroked-button routerLink="/organizer/tournaments">{{ i18n.t('tournamentManage.backToList') }}</a> }
      </header>

      @if (loadingReferences()) { <p role="status">{{ i18n.t('tournamentCreate.loadingReferences') }}</p> }
      @if (referenceError()) {
        <div class="error stack" role="alert" data-cy="tournament-reference-error"><span>{{ referenceError() }}</span><button mat-stroked-button type="button" (click)="loadReferences()">{{ i18n.t('common.retry') }}</button></div>
      }

      @if (editing()) {
        <form class="panel tournament-create-form" [formGroup]="form" (ngSubmit)="editMode ? saveEdit() : requestPreview()" novalidate [attr.aria-busy]="formPending()">
          <p class="muted tournament-create-help">{{ i18n.t('tournamentCreate.zoneHelp') }}</p>
          <fieldset class="tournament-form-lock" [disabled]="formPending()">
          <div class="tournament-create-grid">
            <div class="tournament-create-field tournament-create-wide">
              <label for="tournament-title-input">{{ i18n.t('tournamentCreate.name') }}</label>
              <input #titleInput id="tournament-title-input" data-cy="tournament-title" formControlName="title" autocomplete="off" [attr.aria-invalid]="fieldError('title') ? 'true' : null" [attr.aria-describedby]="fieldError('title') ? 'tournament-title-error' : null" />
              @if (fieldError('title'); as message) { <p id="tournament-title-error" class="field-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field">
              <label for="tournament-organization">{{ i18n.t('tournamentCreate.organization') }}</label>
              <select id="tournament-organization" data-cy="tournament-organization" formControlName="organizationId" [attr.aria-invalid]="fieldError('organizationId') ? 'true' : null" [attr.aria-describedby]="fieldError('organizationId') ? 'tournament-organization-error' : null">
                @for (organization of organizations(); track organization.id) { <option [value]="organization.id">{{ organization.name }}</option> }
              </select>
              @if (fieldError('organizationId'); as message) { <p id="tournament-organization-error" class="field-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-double">
              <label for="tournament-summary">{{ i18n.t('tournamentCreate.summary') }}</label>
              <input id="tournament-summary" data-cy="tournament-summary" formControlName="summary" maxlength="50" [attr.aria-invalid]="fieldError('summary') ? 'true' : null" [attr.aria-describedby]="fieldError('summary') ? 'tournament-summary-error' : null" />
              @if (fieldError('summary'); as message) { <p id="tournament-summary-error" class="field-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-wide">
              <label for="tournament-body">{{ i18n.t('tournamentCreate.body') }}</label>
              <textarea id="tournament-body" data-cy="tournament-body" formControlName="bodyHtml" rows="7" [attr.aria-invalid]="fieldError('bodyHtml') ? 'true' : null" [attr.aria-describedby]="fieldError('bodyHtml') ? 'tournament-body-error tournament-body-help' : 'tournament-body-help'"></textarea>
              <p id="tournament-body-help" class="muted">{{ i18n.t('tournamentCreate.bodyHelp') }}</p>
              @if (fieldError('bodyHtml'); as message) { <p id="tournament-body-error" class="field-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-double">
              <label for="tournament-street">{{ i18n.t('tournamentCreate.street') }}</label>
              <input #streetInput id="tournament-street" data-cy="tournament-street" formControlName="streetAddress" autocomplete="street-address" [attr.aria-invalid]="fieldError('streetAddress') ? 'true' : null" [attr.aria-describedby]="fieldError('streetAddress') ? 'tournament-street-error' : null" />
              @if (fieldError('streetAddress'); as message) { <p id="tournament-street-error" class="field-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field">
              <label for="tournament-postal-code">{{ i18n.t('tournamentCreate.postalCode') }}</label>
              <input id="tournament-postal-code" data-cy="tournament-postal-code" formControlName="postalCode" autocomplete="postal-code" />
            </div>
            <div class="tournament-create-field">
              <label for="tournament-city">{{ i18n.t('calendar.city') }}</label>
              <input id="tournament-city" data-cy="tournament-city" formControlName="city" autocomplete="address-level2" [attr.aria-invalid]="fieldError('city') ? 'true' : null" [attr.aria-describedby]="fieldError('city') ? 'tournament-city-error' : null" />
              @if (fieldError('city'); as message) { <p id="tournament-city-error" class="field-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field">
              <label for="tournament-country">{{ i18n.t('tournamentCreate.country') }}</label>
              <input id="tournament-country" data-cy="tournament-country" formControlName="country" autocomplete="country-name" [attr.aria-invalid]="fieldError('country') ? 'true' : null" [attr.aria-describedby]="fieldError('country') ? 'tournament-country-error' : null" />
              @if (fieldError('country'); as message) { <p id="tournament-country-error" class="field-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field">
              <label for="tournament-start">{{ i18n.t('tournamentCreate.start') }}</label>
              <input id="tournament-start" data-cy="tournament-start" type="datetime-local" formControlName="startsAtLocal" [attr.aria-invalid]="fieldError('startsAtLocal') ? 'true' : null" [attr.aria-describedby]="fieldError('startsAtLocal') ? 'tournament-start-error' : null" />
              @if (fieldError('startsAtLocal'); as message) { <p id="tournament-start-error" class="field-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field">
              <label for="tournament-end">{{ i18n.t('tournamentCreate.end') }}</label>
              <input id="tournament-end" data-cy="tournament-end" type="datetime-local" formControlName="endsAtLocal" [attr.aria-invalid]="fieldError('endsAtLocal') ? 'true' : null" [attr.aria-describedby]="fieldError('endsAtLocal') ? 'tournament-end-error' : null" />
              @if (fieldError('endsAtLocal'); as message) { <p id="tournament-end-error" class="field-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field">
              <label for="tournament-zone">{{ i18n.t('tournamentCreate.zone') }}</label>
              <input id="tournament-zone" data-cy="tournament-zone" formControlName="timeZoneId" autocomplete="off" [attr.aria-invalid]="fieldError('timeZoneId') ? 'true' : null" [attr.aria-describedby]="fieldError('timeZoneId') ? 'tournament-zone-error tournament-zone-help' : 'tournament-zone-help'" />
              <p id="tournament-zone-help" class="muted">{{ i18n.t('tournamentCreate.zoneSuggestion') }}</p>
              @if (fieldError('timeZoneId'); as message) { <p id="tournament-zone-error" class="field-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field">
              <label for="tournament-capacity">{{ i18n.t('calendar.capacity') }}</label>
              <input id="tournament-capacity" data-cy="tournament-capacity" type="number" min="1" step="1" formControlName="capacity" [attr.aria-invalid]="fieldError('capacity') ? 'true' : null" [attr.aria-describedby]="fieldError('capacity') ? 'tournament-capacity-error' : null" />
              @if (fieldError('capacity'); as message) { <p id="tournament-capacity-error" class="field-error">{{ message }}</p> }
            </div>
            <div class="tournament-create-field tournament-create-double">
              <label for="tournament-formats">{{ i18n.t('tournamentCreate.formats') }}</label>
              <select id="tournament-formats" data-cy="tournament-formats" formControlName="formatIds" multiple [attr.aria-invalid]="fieldError('formatIds') ? 'true' : null" [attr.aria-describedby]="fieldError('formatIds') ? 'tournament-formats-error tournament-formats-help' : 'tournament-formats-help'">
                @for (format of formats(); track format.id) { <option [value]="format.id">{{ format.name }}</option> }
              </select>
              <p id="tournament-formats-help" class="muted">{{ i18n.t('tournamentCreate.formatsHelp') }}</p>
              @if (fieldError('formatIds'); as message) { <p id="tournament-formats-error" class="field-error">{{ message }}</p> }
            </div>
          </div>
          </fieldset>
          @if (staleTournament(); as latest) {
            <div class="warning stack" role="alert" data-cy="tournament-stale">
              <strong>{{ i18n.t('tournamentManage.staleTitle') }}</strong>
              <p>{{ i18n.t('tournamentManage.staleBody', { title: latest.title }) }}</p>
              @if (staleChanges().length) { <ul>@for (change of staleChanges(); track change) { <li>{{ change }}</li> }</ul> }
              <p>{{ i18n.t('tournamentManage.draftPreserved') }}</p>
              <button mat-stroked-button type="button" data-cy="tournament-reload-latest" (click)="reloadLatest()">{{ i18n.t('tournamentManage.reloadLatest') }}</button>
            </div>
          }
          @if (success()) { <p role="status" class="success" data-cy="tournament-edit-success">{{ success() }}</p> }
          @if (submitError(); as error) {
            <div class="error tournament-create-recovery" role="alert" data-cy="tournament-submit-error">
              <span>{{ error.message }}</span>
              @if (error.action === 'reload') { <button mat-stroked-button type="button" data-cy="reload-organizations" (click)="loadReferences()">{{ i18n.t('tournamentCreate.reloadOrganizations') }}</button> }
              @if (error.action === 'login') { <a mat-stroked-button [routerLink]="['/login']" [queryParams]="{ returnUrl: '/organizer/tournaments/new' }" target="_blank" rel="noopener noreferrer">{{ i18n.t('tournamentCreate.signInAgain') }}</a> }
              @if (error.action === 'retry') { <button mat-stroked-button type="submit">{{ i18n.t('common.retry') }}</button> }
            </div>
          }
          <div class="actions"><button #saveButton mat-flat-button class="home-primary-action" type="submit" [attr.data-cy]="editMode ? 'tournament-save' : 'tournament-preview-submit'" [disabled]="formPending() || loadingReferences() || !organizations().length">{{ editMode ? (saving() ? i18n.t('tournamentManage.saving') : i18n.t('common.save')) : (previewing() ? i18n.t('tournamentCreate.previewing') : i18n.t('tournamentCreate.preview')) }}</button></div>
        </form>
        @if (editMode && currentRender(); as rendered) {
          <section class="stack" aria-labelledby="current-tournament-title"><h2 id="current-tournament-title">{{ i18n.t('tournamentManage.currentPublicDetails') }}</h2><gones-tournament-detail-view [tournament]="rendered" /></section>
        }
      } @else if (preview(); as currentPreview) {
        <p class="warning" role="status">{{ i18n.t('tournamentCreate.previewNotice') }}</p>
        <gones-tournament-detail-view [tournament]="currentPreview" />
        @if (publishError(); as error) {
          <div class="error tournament-create-recovery" role="alert" data-cy="tournament-publish-error">
            <span>{{ error.message }}</span>
            @if (error.action === 'login') { <a mat-stroked-button [routerLink]="['/login']" [queryParams]="{ returnUrl: '/organizer/tournaments/new' }" target="_blank" rel="noopener noreferrer">{{ i18n.t('tournamentCreate.signInAgain') }}</a> }
            @if (error.action === 'reload') { <button mat-stroked-button type="button" data-cy="reload-organizations" (click)="reloadOrganizationAccess()">{{ i18n.t('tournamentCreate.reloadOrganizations') }}</button> }
            @if (error.action === 'review-calendar') { <a mat-stroked-button routerLink="/calendar" data-cy="tournament-review-calendar">{{ i18n.t('tournamentCreate.reviewCalendar') }}</a> }
            @if (error.action === 'refresh-preview') { <button mat-stroked-button type="button" data-cy="tournament-refresh-preview" (click)="refreshPreview()">{{ i18n.t('tournamentCreate.refreshPreview') }}</button> }
          </div>
        }
        <div class="actions tournament-preview-actions">
          <button mat-stroked-button type="button" data-cy="tournament-back-edit" [disabled]="publishing()" (click)="backToEdit()">{{ i18n.t('tournamentCreate.backEdit') }}</button>
          <button mat-flat-button class="home-primary-action" type="button" data-cy="tournament-publish" [disabled]="publishing()" (click)="publish()">{{ publishing() ? i18n.t('tournamentCreate.publishing') : i18n.t('tournamentCreate.publish') }}</button>
        </div>
      }
    </section>
  `
})
export class OrganizerTournamentCreateComponent implements OnInit, AfterViewInit {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly state = new PreviewPublicationState();
  private readonly tournamentId = this.route.snapshot.paramMap.get('id');
  readonly editMode = Boolean(this.tournamentId);
  @ViewChild('titleInput') private titleInput?: ElementRef<HTMLInputElement>;
  @ViewChild('streetInput') private streetInput?: ElementRef<HTMLInputElement>;
  @ViewChild('saveButton') private saveButton?: ElementRef<HTMLButtonElement>;

  readonly organizations = signal<MyOrganizationResponse[]>([]);
  readonly formats = signal<PublicFormatResponse[]>([]);
  readonly loadingReferences = signal(true);
  readonly referenceError = signal('');
  readonly editing = signal(true);
  readonly preview = signal<TournamentPreviewRenderResponse | null>(null);
  readonly previewing = signal(false);
  readonly publishing = signal(false);
  readonly saving = signal(false);
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly submitError = signal<RecoveryError | null>(null);
  readonly publishError = signal<RecoveryError | null>(null);
  readonly baseTournament = signal<TournamentManagementResponse | null>(null);
  readonly staleTournament = signal<TournamentManagementResponse | null>(null);
  readonly staleChanges = signal<string[]>([]);
  readonly currentRender = signal<TournamentPreviewRenderResponse | null>(null);
  readonly success = signal('');
  readonly formPending = computed(() => this.previewing() || this.saving());

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
        const tournament = await this.findTournament(this.tournamentId!);
        this.organizations.set([{
          id: tournament.organizationId,
          name: tournament.organizationName,
          description: undefined,
          website: undefined,
          contactEmail: undefined,
          role: 'Organizer',
          createdAt: tournament.startsAtUtc
        }]);
        this.form.controls.organizationId.disable({ emitEvent: false });
        this.applyCanonical(tournament);
      } else {
        const organizations = await firstValueFrom(this.client.organizationsAll());
        this.organizations.set(organizations);
        if (!organizations.some(item => item.id === this.form.controls.organizationId.value)) {
          this.form.controls.organizationId.setValue(organizations[0]?.id ?? '');
        }
        if (!organizations.length) this.referenceError.set(this.i18n.t('tournamentCreate.noOrganizations'));
      }
    } catch {
      this.organizations.set([]);
      this.formats.set([]);
      this.referenceError.set(this.editMode ? this.i18n.t('tournamentManage.loadFailed') : this.i18n.t('tournamentCreate.referencesFailed'));
    } finally {
      this.loadingReferences.set(false);
    }
  }

  async requestPreview(): Promise<void> {
    this.form.markAllAsTouched();
    this.fieldErrors.set({});
    this.submitError.set(null);
    if (this.form.invalid || this.previewing()) return;
    this.previewing.set(true);
    try {
      const response = await firstValueFrom(this.client.preview(tournamentPayload(this.form.getRawValue())));
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
      const response = await firstValueFrom(this.client.tournamentsPOST(key, {
        previewTicket: this.state.preview.previewTicket,
        payload: tournamentPayload(this.form.getRawValue())
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
    const base = this.baseTournament();
    if (!this.tournamentId || !base || this.form.invalid || this.saving()) return;
    const draft = this.form.getRawValue();
    const major = majorTournamentChanges(base, draft, field => this.i18n.t(`tournamentManage.major.${field}`));
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
      const response = await firstValueFrom(this.client.updateTournamentDetails(
        this.tournamentId,
        base.eTag,
        tournamentUpdatePayload(draft)
      ));
      this.applyCanonical(response);
      this.staleTournament.set(null);
      this.staleChanges.set([]);
      this.success.set(this.i18n.t('tournamentManage.saved'));
      queueMicrotask(() => this.saveButton?.nativeElement.focus());
    } catch (error) {
      this.applyFieldErrors(error);
      if (error instanceof ApiProblemError && error.status === 412) {
        await this.loadStaleTournament(base);
      } else {
        this.submitError.set({ message: this.managementError(error), action: 'retry' });
      }
    } finally {
      this.saving.set(false);
    }
  }

  reloadLatest(): void {
    const latest = this.staleTournament();
    if (!latest) return;
    this.applyCanonical(latest);
    this.staleTournament.set(null);
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

  private async findTournament(id: string): Promise<TournamentManagementResponse> {
    let page = 1;
    while (true) {
      const response = await firstValueFrom(this.client.listOrganizerTournaments(page, 100));
      const found = response.items.find(item => item.id === id);
      if (found) return found;
      if (page * response.pageSize >= response.totalCount) throw new Error('Tournament not found.');
      page += 1;
    }
  }

  private applyCanonical(tournament: TournamentManagementResponse): void {
    this.baseTournament.set(tournament);
    this.form.patchValue(managementToDraft(tournament), { emitEvent: false });
    this.currentRender.set(managementToDetail(tournament, this.formats()));
  }

  private async loadStaleTournament(base: TournamentManagementResponse): Promise<void> {
    try {
      const latest = await this.findTournament(base.id);
      this.staleTournament.set(latest);
      this.staleChanges.set(changedTournamentFields(base, latest, field => this.i18n.t('tournamentManage.serverChanged', { field: this.i18n.t(`tournamentManage.field.${field}`) })));
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
