import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import {
  Client,
  OrganizationMemberResponse,
  OrganizationNotificationSettingsResponse,
  PublicOrganizationResponse
} from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, BackButtonComponent],
  template: `
    <gones-back-button data-cy="organization-detail-back-top" [label]="i18n.t('nav.backToPrevious')" position="top" />

    <section class="admin-page stack" data-cy="organization-detail" aria-labelledby="org-detail-title">
      <a mat-stroked-button routerLink="/organizer/organizations" data-cy="org-detail-back">{{ i18n.t('org.backToList') }}</a>
      @if (loading()) { <p data-cy="org-detail-loading">{{ i18n.t('common.loading') }}</p> }
      @else if (error()) { <div class="stack" data-cy="org-detail-error-panel"><p class="error" role="alert" data-cy="org-detail-error">{{ error() }}</p><button mat-stroked-button type="button" data-cy="org-detail-retry" (click)="reload()">{{ i18n.t('common.retry') }}</button></div> }
      @else if (organization(); as org) {
        <header class="page-heading" data-cy="org-detail-heading"><div data-cy="org-detail-heading-text"><p class="kicker" data-cy="org-detail-kicker">{{ i18n.t('org.kicker') }}</p><h1 id="org-detail-title" data-cy="org-detail-title">{{ org.name }}</h1></div></header>
        <mat-card class="panel" data-cy="org-detail-card"><mat-card-content class="stack" data-cy="org-detail-card-content">
          @if (org.description) { <p data-cy="org-detail-description">{{ org.description }}</p> }
          @if (org.website) { <p data-cy="org-detail-website"><a [href]="org.website" rel="noreferrer" data-cy="org-detail-website-link">{{ org.website }}</a></p> }
          @if (org.contactEmail) { <p class="muted" data-cy="org-detail-contact-email">{{ org.contactEmail }}</p> }
        </mat-card-content></mat-card>

        @if (auth.profile()) {
          <mat-card class="panel" data-cy="org-owner-panel"><mat-card-content class="stack" data-cy="org-owner-panel-content">
            <h2 data-cy="org-owner-tools-title">{{ i18n.t('org.ownerTools') }}</h2>
            @if (manageLoading()) { <p data-cy="org-manage-loading">{{ i18n.t('common.loading') }}</p> }
            @else if (manageError()) { <p class="error" role="alert" data-cy="org-manage-denied">{{ manageError() }}</p> }
            @else {
              <div class="stack" data-cy="org-members">
                <h3 data-cy="org-members-title">{{ i18n.t('org.members') }}</h3>
                @for (member of members(); track member.userId) {
                  <div class="admin-row-grid member-row" [attr.data-cy]="'org-member-' + member.username">
                    <div [attr.data-cy]="'org-member-summary-' + member.userId"><strong [attr.data-cy]="'org-member-username-' + member.userId">{{ member.username }}</strong><p class="muted" [attr.data-cy]="'org-member-id-' + member.userId">{{ member.userId }}</p></div>
                    <span class="muted" [attr.data-cy]="'org-member-role-' + member.userId">{{ member.role }}</span>
                    <button mat-stroked-button type="button" class="danger-ghost-action" [attr.data-cy]="'org-member-remove-' + member.userId" [disabled]="pending()" (click)="remove(member)">{{ i18n.t('common.remove') }}</button>
                  </div>
                }
                <!-- Adding a member grants the global Organizer role, so the server takes it from an
                     admin only; showing the form to a plain member would be a control that always fails. -->
                @if (isAdmin()) {
                  <form class="auth-form admin-inline-form" data-cy="org-add-member-form" (ngSubmit)="addMember()">
                    <label for="org-member-user" data-cy="org-member-user-label">{{ i18n.t('org.addUserId') }}</label>
                    <input id="org-member-user" data-cy="org-member-user" name="newMemberUserId" [(ngModel)]="newMemberUserId" />
                    <button mat-flat-button type="submit" data-cy="org-add-member-submit" [disabled]="pending()">{{ i18n.t('common.add') }}</button>
                  </form>
                } @else { <p class="muted" data-cy="org-add-member-admin-only">{{ i18n.t('org.addMemberAdminOnly') }}</p> }
              </div>
              @if (settings(); as prefs) {
                <form class="auth-form" data-cy="org-notification-settings" (ngSubmit)="saveSettings()">
                  <h3 data-cy="org-notification-settings-title">{{ i18n.t('org.notifications') }}</h3>
                  <label data-cy="org-notify-registration-label"><input type="checkbox" data-cy="org-notify-registration" name="notifyOnRegistration" [(ngModel)]="prefs.notifyOnRegistration" /> {{ i18n.t('org.notifyRegistration') }}</label>
                  <label data-cy="org-notify-unregistration-label"><input type="checkbox" data-cy="org-notify-unregistration" name="notifyOnUnregistration" [(ngModel)]="prefs.notifyOnUnregistration" /> {{ i18n.t('org.notifyUnregistration') }}</label>
                  <button mat-flat-button type="submit" data-cy="org-notification-settings-save" [disabled]="pending()">{{ i18n.t('common.save') }}</button>
                </form>
              }
            }
            @if (status()) { <p role="status" data-cy="org-manage-status">{{ status() }}</p> }
          </mat-card-content></mat-card>
        }
      }
    </section>

    <gones-back-button data-cy="organization-detail-back-bottom" [label]="i18n.t('nav.backToPrevious')" position="bottom" />
  `
})
export class OrganizationDetailComponent {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  readonly organization = signal<PublicOrganizationResponse | null>(null);
  readonly members = signal<OrganizationMemberResponse[]>([]);
  readonly settings = signal<OrganizationNotificationSettingsResponse | null>(null);
  readonly loading = signal(true);
  readonly manageLoading = signal(false);
  readonly pending = signal(false);
  readonly error = signal('');
  readonly manageError = signal('');
  readonly status = signal('');
  /** Membership grants are admin-only server-side: adding a member also grants the global Organizer role. */
  readonly isAdmin = computed(() => this.auth.profile()?.globalRole === 'Admin');
  newMemberUserId = '';
  private organizationId = '';

  constructor() {
    this.route.paramMap.subscribe((params) => {
      this.organizationId = params.get('id') ?? '';
      void this.reload();
    });
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.organization.set(await firstValueFrom(this.client.organizationsGET2(this.organizationId)));
      if (this.auth.profile()) await this.loadManagement();
    } catch {
      this.error.set(this.i18n.t('org.loadFailed'));
      this.organization.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  async loadManagement(): Promise<void> {
    this.manageLoading.set(true);
    this.manageError.set('');
    try {
      const [members, settings] = await Promise.all([
        firstValueFrom(this.client.membersAll(this.organizationId)),
        firstValueFrom(this.client.notificationSettingsGET(this.organizationId))
      ]);
      this.members.set(members);
      this.settings.set(settings);
    } catch {
      this.manageError.set(this.i18n.t('org.manageDenied'));
    } finally {
      this.manageLoading.set(false);
    }
  }

  async addMember(): Promise<void> {
    if (!this.newMemberUserId.trim()) return;
    await this.mutate(async () => {
      await firstValueFrom(this.client.membersPOST(this.organizationId, { userId: this.newMemberUserId.trim(), role: 'Organizer' }));
      this.newMemberUserId = '';
      await this.loadManagement();
    });
  }

  async remove(member: OrganizationMemberResponse): Promise<void> {
    if (!confirm(this.i18n.t('org.confirmRemoveMember', { username: member.username }))) return;
    await this.mutate(async () => {
      await firstValueFrom(this.client.membersDELETE(this.organizationId, member.userId));
      await this.loadManagement();
    });
  }

  async saveSettings(): Promise<void> {
    const prefs = this.settings();
    if (!prefs) return;
    await this.mutate(async () => {
      this.settings.set(await firstValueFrom(this.client.notificationSettingsPUT(this.organizationId, {
        notifyOnRegistration: prefs.notifyOnRegistration,
        notifyOnUnregistration: prefs.notifyOnUnregistration
      })));
    });
  }

  private async mutate(action: () => Promise<void>): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    this.status.set('');
    try {
      await action();
      this.status.set(this.i18n.t('org.saved'));
    } catch {
      this.status.set(this.i18n.t('org.actionFailed'));
    } finally {
      this.pending.set(false);
    }
  }
}
