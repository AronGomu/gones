import { Component, inject, signal } from '@angular/core';
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

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="admin-page stack" data-cy="organization-detail" aria-labelledby="org-detail-title">
      <a mat-stroked-button routerLink="/organizations">{{ i18n.t('org.backToList') }}</a>
      @if (loading()) { <p>{{ i18n.t('common.loading') }}</p> }
      @else if (error()) { <div class="stack"><p class="error" role="alert">{{ error() }}</p><button mat-stroked-button type="button" (click)="reload()">{{ i18n.t('common.retry') }}</button></div> }
      @else if (organization(); as org) {
        <header class="page-heading"><div><p class="kicker">{{ i18n.t('org.kicker') }}</p><h1 id="org-detail-title">{{ org.name }}</h1></div></header>
        <mat-card class="panel"><mat-card-content class="stack">
          @if (org.description) { <p>{{ org.description }}</p> }
          @if (org.website) { <p><a [href]="org.website" rel="noreferrer">{{ org.website }}</a></p> }
          @if (org.contactEmail) { <p class="muted">{{ org.contactEmail }}</p> }
        </mat-card-content></mat-card>

        @if (auth.profile()) {
          <mat-card class="panel" data-cy="org-owner-panel"><mat-card-content class="stack">
            <h2>{{ i18n.t('org.ownerTools') }}</h2>
            @if (manageLoading()) { <p>{{ i18n.t('common.loading') }}</p> }
            @else if (manageError()) { <p class="error" role="alert" data-cy="org-manage-denied">{{ manageError() }}</p> }
            @else {
              <div class="stack" data-cy="org-members">
                <h3>{{ i18n.t('org.members') }}</h3>
                @for (member of members(); track member.userId) {
                  <div class="admin-row-grid member-row" [attr.data-cy]="'org-member-' + member.username">
                    <div><strong>{{ member.username }}</strong><p class="muted">{{ member.userId }}</p></div>
                    <select [ngModel]="member.role" [attr.aria-label]="i18n.t('org.roleFor', { username: member.username })" (ngModelChange)="changeRole(member, $event)">
                      <option value="Owner">Owner</option>
                      <option value="Organizer">Organizer</option>
                    </select>
                    <button mat-stroked-button type="button" class="danger-ghost-action" [disabled]="pending()" (click)="remove(member)">{{ i18n.t('common.remove') }}</button>
                  </div>
                }
                <form class="auth-form admin-inline-form" (ngSubmit)="addMember()">
                  <label for="org-member-user">{{ i18n.t('org.addUserId') }}</label>
                  <input id="org-member-user" data-cy="org-member-user" name="newMemberUserId" [(ngModel)]="newMemberUserId" />
                  <label for="org-member-role">{{ i18n.t('org.role') }}</label>
                  <select id="org-member-role" name="newMemberRole" [(ngModel)]="newMemberRole"><option value="Organizer">Organizer</option><option value="Owner">Owner</option></select>
                  <button mat-flat-button type="submit" [disabled]="pending()">{{ i18n.t('common.add') }}</button>
                </form>
              </div>
              @if (settings(); as prefs) {
                <form class="auth-form" data-cy="org-notification-settings" (ngSubmit)="saveSettings()">
                  <h3>{{ i18n.t('org.notifications') }}</h3>
                  <label><input type="checkbox" name="notifyOnRegistration" [(ngModel)]="prefs.notifyOnRegistration" /> {{ i18n.t('org.notifyRegistration') }}</label>
                  <label><input type="checkbox" name="notifyOnUnregistration" [(ngModel)]="prefs.notifyOnUnregistration" /> {{ i18n.t('org.notifyUnregistration') }}</label>
                  <button mat-flat-button type="submit" [disabled]="pending()">{{ i18n.t('common.save') }}</button>
                </form>
              }
            }
            @if (status()) { <p role="status" data-cy="org-manage-status">{{ status() }}</p> }
          </mat-card-content></mat-card>
        }
      }
    </section>
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
  newMemberUserId = '';
  newMemberRole = 'Organizer';
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
      await firstValueFrom(this.client.membersPOST(this.organizationId, { userId: this.newMemberUserId.trim(), role: this.newMemberRole }));
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

  async changeRole(member: OrganizationMemberResponse, role: string): Promise<void> {
    if (role === member.role) return;
    const action = role === 'Owner' ? this.i18n.t('org.confirmTransferOwner', { username: member.username }) : this.i18n.t('org.confirmRoleChange', { username: member.username, role });
    if (!confirm(action)) { await this.loadManagement(); return; }
    await this.mutate(async () => {
      if (role === 'Owner') await firstValueFrom(this.client.transferOwnership(this.organizationId, { newOwnerUserId: member.userId }));
      else await firstValueFrom(this.client.role(this.organizationId, member.userId, { role }));
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
