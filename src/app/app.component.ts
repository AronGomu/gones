import { Component, computed } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { AuthService } from './auth/auth.service';
import { SupabaseClientService } from './data/supabase-client.service';

@Component({
  selector: 'gones-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatToolbarModule],
  template: `
    <mat-toolbar class="app-toolbar">
      <a class="brand" routerLink="/leagues" aria-label="Gones home"><img src="assets/gones_logo.png" alt="Gones"></a>
      <nav class="nav-links" aria-label="Primary"><a mat-button routerLink="/leagues">Leagues</a>@if (auth.isAdmin()) { <a mat-button routerLink="/admin/users">Admin Users</a> }</nav>
      <span class="spacer"></span>
      @if (!configured) { <span class="setup-chip">Demo mode: configure Supabase</span> }
      @if (state().email) {
        <button mat-stroked-button [matMenuTriggerFor]="accountMenu">{{ state().email }} · {{ state().role }}</button>
        <mat-menu #accountMenu="matMenu"><button mat-menu-item (click)="signOut()">Sign out</button></mat-menu>
      } @else {
        <button mat-flat-button color="primary" (click)="login()" [disabled]="!configured">Sign in with Google</button>
      }
    </mat-toolbar>
    <main class="app-main"><router-outlet /></main>
  `
})
export class AppComponent {
  readonly state = computed(() => this.auth.state());

  constructor(public readonly auth: AuthService, private readonly supabase: SupabaseClientService) {}

  get configured(): boolean { return this.supabase.configured; }

  login(): void { void this.auth.login(); }
  signOut(): void { void this.auth.signOut(); }
}
