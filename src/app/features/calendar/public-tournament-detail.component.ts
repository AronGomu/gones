import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import {
  PublicTournamentDetailResponse,
  PublicTournamentParticipantResponse,
  TournamentRegistrationCapabilityResponse
} from '../../api/generated/gones-api';
import { ApiProblemError } from '../../api/api-boundary';
import { AuthService } from '../../auth/auth.service';
import { I18nService } from '../../i18n/i18n.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { OfflineBannerComponent } from '../../shared/offline-banner.component';
import { OnlineStatusService } from '../../shared/online-status.service';
import { PublicTournamentService } from './public-tournament.service';
import {
  RegistrationOfflineError,
  TournamentRegistrationService,
  registrationErrorKey
} from './tournament-registration.service';
import { TournamentDetailViewComponent } from './tournament-detail-view.component';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, BackButtonComponent, OfflineBannerComponent, TournamentDetailViewComponent],
  template: `
    <gones-back-button [link]="['/calendar']" [label]="i18n.t('nav.backToEvents')" position="top" />
    <gones-offline-banner [stale]="stale()" [cachedAt]="cachedAt()" />
    @if (loading()) { <section class="panel event-section calendar-detail-skeleton" aria-busy="true" data-cy="calendar-loading"><div></div><div></div><div></div></section> }
    @else if (error()) { <section class="panel calendar-state" role="alert" data-cy="calendar-error"><h1>{{ i18n.t('calendar.detailLoadFailed') }}</h1><button mat-stroked-button type="button" (click)="load()">{{ i18n.t('common.retry') }}</button></section> }
    @else if (notFound()) { <section class="panel calendar-state" data-cy="calendar-not-found"><h1>{{ i18n.t('event.notFoundTitle') }}</h1><p>{{ i18n.t('event.notFoundBody') }}</p></section> }
    @else if (tournament(); as item) {
      <div class="stack" data-cy="public-tournament-detail">
        <gones-tournament-detail-view [tournament]="item" [icsUrl]="service.icsUrl(item.slug)" />

        @if (auth.enabled) {
        <section class="panel event-section registration-action" aria-labelledby="registration-action-title">
          <h2 id="registration-action-title">{{ i18n.t('registration.title') }}</h2>
          @if (!auth.profile()) {
            <p>{{ i18n.t('registration.loginPrompt') }}</p>
            <a mat-flat-button class="home-primary-action" routerLink="/login" [queryParams]="{ returnUrl: currentPath() }" data-cy="registration-login">{{ i18n.t('auth.signIn') }}</a>
          } @else if (capabilityLoading()) {
            <p aria-busy="true">{{ i18n.t('common.loading') }}</p>
          } @else if (capability(); as state) {
            <p>{{ i18n.t('registration.capacityStatus', { count: state.activeParticipantCount, capacity: state.capacity ?? i18n.t('registration.unlimited') }) }}</p>
            @if (state.canRegister) {
              <button mat-flat-button class="home-primary-action" type="button" [disabled]="mutationPending() || !online()" (click)="register()" data-cy="registration-register">{{ mutationPending() ? i18n.t('registration.pending') : i18n.t('registration.register') }}</button>
            } @else if (state.canUnregister) {
              <button mat-stroked-button class="danger-ghost-action" type="button" [disabled]="mutationPending() || confirmationPending() || !online()" (click)="confirmUnregister()" data-cy="registration-unregister">{{ mutationPending() || confirmationPending() ? i18n.t('registration.pending') : i18n.t('registration.unregister') }}</button>
            } @else {
              <p class="warning" data-cy="registration-reason">{{ reasonMessage(state.reason) }}</p>
            }
            <a mat-stroked-button routerLink="/registrations" data-cy="my-registrations-link">{{ i18n.t('registration.myRegistrations') }}</a>
          } @else if (capabilityError()) {
            <p class="error" role="alert">{{ i18n.t('registration.capabilityLoadFailed') }}</p>
            <button mat-stroked-button type="button" (click)="loadCapability()">{{ i18n.t('common.retry') }}</button>
          }
          @if (!online()) { <p class="warning" data-cy="registration-offline">{{ i18n.t('registration.offline') }}</p> }
          <p #registrationStatus class="registration-live-status" tabindex="-1" role="status" aria-live="polite" data-cy="registration-status">{{ mutationStatus() }}</p>
        </section>
        }

        <section class="panel event-section public-participants" aria-labelledby="participants-title">
          <h2 id="participants-title">{{ i18n.t('registration.participants') }}</h2>
          @if (participantsLoading()) { <p aria-busy="true">{{ i18n.t('common.loading') }}</p> }
          @else if (participantsError()) { <div role="alert"><p>{{ i18n.t('registration.participantsLoadFailed') }}</p><button mat-stroked-button type="button" (click)="loadParticipants()">{{ i18n.t('common.retry') }}</button></div> }
          @else if (!participants().length) { <p>{{ i18n.t('registration.noParticipants') }}</p> }
          @else {
            <ul class="participant-list" data-cy="public-participants">
              @for (participant of participants(); track participant.userId) {
                <li data-cy="public-participant"><strong>{{ participant.username }}</strong>@if (optionalParticipantFields(participant); as fields) { @if (fields) { <span>{{ fields }}</span> } }</li>
              }
            </ul>
          }
        </section>
      </div>
    }
    <gones-back-button [link]="['/calendar']" [label]="i18n.t('nav.backToEvents')" position="bottom" />
  `
})
export class PublicTournamentDetailComponent implements OnInit {
  readonly i18n = inject(I18nService);
  readonly service = inject(PublicTournamentService);
  readonly auth = inject(AuthService);
  private readonly registrations = inject(TournamentRegistrationService);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  @ViewChild('registrationStatus') private registrationStatus?: ElementRef<HTMLElement>;
  readonly tournament = signal<PublicTournamentDetailResponse | null>(null);
  readonly participants = signal<PublicTournamentParticipantResponse[]>([]);
  readonly capability = signal<TournamentRegistrationCapabilityResponse | null>(null);
  readonly loading = signal(true);
  readonly participantsLoading = signal(false);
  readonly capabilityLoading = signal(false);
  readonly stale = signal(false);
  readonly cachedAt = signal<string | undefined>(undefined);
  readonly online = inject(OnlineStatusService).online;
  readonly error = signal(false);
  readonly notFound = signal(false);
  readonly participantsError = signal(false);
  readonly capabilityError = signal(false);
  readonly mutationPending = signal(false);
  readonly confirmationPending = signal(false);
  readonly mutationStatus = signal('');

  ngOnInit(): void { void this.load(); }

  currentPath(): string { return `/calendar/tournaments/${encodeURIComponent(this.route.snapshot.paramMap.get('slug') ?? '')}`; }

  async load(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.loading.set(true);
    this.error.set(false);
    this.notFound.set(false);
    try {
      const result = await this.service.detail(slug);
      this.tournament.set(result.data);
      this.stale.set(result.stale);
      this.cachedAt.set(result.cachedAt);
      await Promise.all([this.loadParticipants(), this.auth.profile() ? this.loadCapability() : Promise.resolve()]);
    } catch (error) {
      this.tournament.set(null);
      this.stale.set(false);
      this.cachedAt.set(undefined);
      if (error instanceof ApiProblemError && error.status === 404) this.notFound.set(true);
      else this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async loadParticipants(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.participantsLoading.set(true);
    this.participantsError.set(false);
    try {
      this.participants.set((await this.registrations.participants(slug)).items);
    } catch {
      this.participantsError.set(true);
    } finally {
      this.participantsLoading.set(false);
    }
  }

  async loadCapability(): Promise<void> {
    const tournament = this.tournament();
    if (!tournament || !this.auth.profile()) return;
    this.capabilityLoading.set(true);
    this.capabilityError.set(false);
    try {
      this.capability.set(await this.registrations.capability(tournament.id));
    } catch {
      this.capability.set(null);
      this.capabilityError.set(true);
    } finally {
      this.capabilityLoading.set(false);
    }
  }

  async register(): Promise<void> {
    const tournament = this.tournament();
    if (!tournament || this.mutationPending()) return;
    await this.mutate(() => this.registrations.register(tournament.id), 'registration.registered');
  }

  async confirmUnregister(): Promise<void> {
    const tournament = this.tournament();
    if (!tournament || this.mutationPending() || this.confirmationPending()) return;
    this.confirmationPending.set(true);
    try {
      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: this.i18n.t('registration.unregisterTitle'),
          message: this.i18n.t('registration.unregisterConfirm', { title: tournament.title }),
          confirmLabel: this.i18n.t('registration.unregister'),
          destructive: true
        }
      }).afterClosed());
      if (confirmed) await this.mutate(() => this.registrations.unregister(tournament.id), 'registration.unregistered');
    } finally {
      this.confirmationPending.set(false);
    }
  }

  reasonMessage(reason: string): string {
    if (reason === 'registered') return this.i18n.t('registration.alreadyActive');
    if (reason === 'available') return '';
    return this.i18n.t(registrationErrorKey(reason));
  }

  optionalParticipantFields(participant: PublicTournamentParticipantResponse): string {
    return [participant.firstName, participant.lastName, participant.location, participant.birthYear, participant.preferredLanguage]
      .filter(value => value !== undefined && value !== null && value !== '')
      .join(' · ');
  }

  private async mutate(action: () => Promise<unknown>, successKey: 'registration.registered' | 'registration.unregistered'): Promise<void> {
    this.mutationPending.set(true);
    this.mutationStatus.set('');
    try {
      await action();
      const [detailRefresh] = await Promise.allSettled([this.refreshTournament(), this.loadParticipants(), this.loadCapability()]);
      this.mutationStatus.set(this.i18n.t(detailRefresh.status === 'fulfilled' ? successKey : 'registration.savedRefreshFailed'));
    } catch (error) {
      const code = error instanceof ApiProblemError ? error.problem.code : undefined;
      const key = error instanceof RegistrationOfflineError || (error instanceof HttpErrorResponse && error.status === 0)
        ? 'registration.offline'
        : registrationErrorKey(code);
      this.mutationStatus.set(this.i18n.t(key));
    } finally {
      this.mutationPending.set(false);
      queueMicrotask(() => this.registrationStatus?.nativeElement.focus());
    }
  }

  private async refreshTournament(): Promise<void> {
    const result = await this.service.detail(this.route.snapshot.paramMap.get('slug') ?? '');
    this.tournament.set(result.data);
    this.stale.set(result.stale);
    this.cachedAt.set(result.cachedAt);
  }
}
