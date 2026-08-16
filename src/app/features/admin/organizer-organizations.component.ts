import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { Client, MyOrganizationResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, BackButtonComponent],
  template: `
    <gones-back-button data-cy="organizer-organizations-back-top" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />

    <section class="admin-page stack" data-cy="organizer-organizations" aria-labelledby="organizer-orgs-title">
      <header class="page-heading" data-cy="organizer-orgs-heading"><div data-cy="organizer-orgs-heading-text"><p class="kicker" data-cy="organizer-orgs-kicker">{{ i18n.t('org.ownerKicker') }}</p><h1 id="organizer-orgs-title" data-cy="organizer-orgs-title">{{ i18n.t('org.myOrganizations') }}</h1></div></header>
      @if (loading()) { <p data-cy="my-orgs-loading">{{ i18n.t('common.loading') }}</p> }
      @else if (error()) { <div class="stack" data-cy="organizer-orgs-error-panel"><p class="error" role="alert" data-cy="organizer-orgs-error">{{ error() }}</p><button mat-stroked-button type="button" data-cy="organizer-orgs-retry" (click)="reload()">{{ i18n.t('common.retry') }}</button></div> }
      @else if (!items().length) { <p data-cy="my-orgs-empty">{{ i18n.t('common.empty') }}</p> }
      @else {
        <div class="card-grid" role="list" data-cy="organizer-orgs-list" [attr.aria-label]="i18n.t('org.myOrganizations')">
          @for (org of items(); track org.id) {
            <mat-card class="panel organization-card" role="listitem" [attr.data-cy]="'my-org-card-' + org.name">
              <mat-card-content class="stack" [attr.data-cy]="'organizer-orgs-card-content-' + org.id">
                <div [attr.data-cy]="'organizer-orgs-card-heading-' + org.id"><h2 [attr.data-cy]="'organizer-orgs-card-name-' + org.id">{{ org.name }}</h2><p class="muted" [attr.data-cy]="'organizer-orgs-card-role-' + org.id">{{ org.role }}</p></div>
                @if (org.description) { <p [attr.data-cy]="'organizer-orgs-card-description-' + org.id">{{ org.description }}</p> }
                <a mat-stroked-button [routerLink]="['/organizations', org.id]" data-cy="manage-org-link">{{ i18n.t('org.manage') }}</a>
              </mat-card-content>
            </mat-card>
          }
        </div>
      }
    </section>

    <gones-back-button data-cy="organizer-organizations-back-bottom" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `
})
export class OrganizerOrganizationsComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  readonly items = signal<MyOrganizationResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor() { void this.reload(); }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.items.set(await firstValueFrom(this.client.organizationsAll()));
    } catch {
      this.error.set(this.i18n.t('org.loadFailed'));
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
