import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AuthService } from '../auth/auth.service';
import { AuthorizedUser, AuthorizedUsersService } from './authorized-users.service';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <section class="page-heading"><div><p class="kicker">Admin</p><h1>Authorized Users</h1><p class="muted">Admin Users inherit Organizer permissions. The database also enforces last-admin/self-protection.</p></div></section>
    @if (message()) { <p class="warning">{{ message() }}</p> }
    <mat-card class="panel"><mat-card-title>Add or update User</mat-card-title><mat-card-content class="user-form"><mat-form-field appearance="outline"><mat-label>Email</mat-label><input matInput type="email" [(ngModel)]="email"></mat-form-field><mat-form-field appearance="outline"><mat-label>Role</mat-label><mat-select [(ngModel)]="role"><mat-option value="organizer">Organizer</mat-option><mat-option value="admin">Admin</mat-option></mat-select></mat-form-field></mat-card-content><mat-card-actions align="end"><button mat-flat-button color="primary" (click)="save()">Save User</button></mat-card-actions></mat-card>
    <div class="stack">
      @for (user of users(); track user.email) {
        <mat-card class="user-card"><mat-card-title>{{ user.email }}</mat-card-title><mat-card-content>{{ user.role }}</mat-card-content><mat-card-actions align="end"><button mat-button (click)="promote(user, user.role === 'admin' ? 'organizer' : 'admin')" [disabled]="isSelfAdminDowngrade(user)">{{ user.role === 'admin' ? 'Make Organizer' : 'Make Admin' }}</button><button mat-button color="warn" (click)="remove(user)" [disabled]="isSelfAdminDowngrade(user) || isLastAdmin(user)">Remove</button></mat-card-actions></mat-card>
      }
    </div>
  `
})
export class AdminUsersComponent {
  readonly users = signal<AuthorizedUser[]>([]);
  readonly message = signal('');
  email = '';
  role: 'organizer' | 'admin' = 'organizer';
  readonly adminCount = computed(() => this.users().filter((user) => user.role === 'admin').length);

  constructor(private readonly service: AuthorizedUsersService, private readonly auth: AuthService) { void this.load(); }
  async load(): Promise<void> { this.users.set(await this.service.list()); }
  async save(): Promise<void> { await this.service.upsert(this.email, this.role); this.email = ''; await this.load(); }
  async promote(user: AuthorizedUser, role: 'organizer' | 'admin'): Promise<void> { await this.service.upsert(user.email, role); await this.load(); }
  async remove(user: AuthorizedUser): Promise<void> { if (confirm(`Remove ${user.email}?`)) { await this.service.remove(user.email); await this.load(); } }
  isSelfAdminDowngrade(user: AuthorizedUser): boolean { return user.role === 'admin' && user.email === this.auth.state().email; }
  isLastAdmin(user: AuthorizedUser): boolean { return user.role === 'admin' && this.adminCount() <= 1; }
}
