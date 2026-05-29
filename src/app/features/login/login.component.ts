import { Component, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../auth/auth.service';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule],
  template: `
    <mat-card class="panel narrow">
      <mat-card-title>Sign in</mat-card-title>
      <mat-card-content>
        <p>Gones now runs fully in the browser. Local sign-in unlocks Organizer/Admin editing against your browser storage.</p>
        <p class="muted">Use <strong>admin@example.com</strong> for the bootstrap local Admin User, or add your own email in Admin Users.</p>
        @if (message()) { <p class="warning">{{ message() }}</p> }
        <mat-form-field appearance="outline" class="search"><mat-label>Email</mat-label><input matInput type="email" [(ngModel)]="email"></mat-form-field>
      </mat-card-content>
      <mat-card-actions>
        <button mat-flat-button color="primary" (click)="login()">Sign in locally</button>
        <a mat-button routerLink="/leagues">Continue as Visitor</a>
      </mat-card-actions>
    </mat-card>
  `
})
export class LoginComponent {
  readonly returnUrl = signal('/leagues');
  readonly message = signal('');
  email = 'admin@example.com';

  constructor(private readonly auth: AuthService, private readonly route: ActivatedRoute, private readonly router: Router) {
    this.returnUrl.set(this.route.snapshot.queryParamMap.get('returnUrl') ?? '/leagues');
    effect(() => {
      const state = this.auth.state();
      if (state.loading || !state.session) return;
      if (this.returnUrl().startsWith('/admin') && state.role !== 'admin') {
        this.message.set('That local user is not an Admin User.');
        void this.router.navigate(['/leagues']);
        return;
      }
      void this.router.navigateByUrl(this.returnUrl());
    });
  }

  login(): void { void this.auth.login(this.returnUrl(), this.email); }
}
