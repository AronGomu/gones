import { Component, effect, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientService } from '../../data/supabase-client.service';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule],
  template: `
    <mat-card class="panel narrow">
      <mat-card-title>Sign in</mat-card-title>
      <mat-card-content>
        <p>Google sign-in is used for Organizer/Admin access. Unknown signed-in users keep Visitor permissions.</p>
        @if (!configured) { <p class="error">Supabase is not configured for this build.</p> }
      </mat-card-content>
      <mat-card-actions>
        <button mat-flat-button color="primary" (click)="login()" [disabled]="!configured">Sign in with Google</button>
        <a mat-button routerLink="/leagues">Continue as Visitor</a>
      </mat-card-actions>
    </mat-card>
  `
})
export class LoginComponent {
  readonly returnUrl = signal('/leagues');

  constructor(private readonly auth: AuthService, private readonly route: ActivatedRoute, private readonly router: Router, private readonly supabase: SupabaseClientService) {
    this.returnUrl.set(this.route.snapshot.queryParamMap.get('returnUrl') ?? '/leagues');
    effect(() => {
      if (!this.auth.state().loading && this.auth.state().session) void this.router.navigateByUrl(this.returnUrl());
    });
  }

  get configured(): boolean { return this.supabase.configured; }

  login(): void { void this.auth.login(this.returnUrl()); }
}
