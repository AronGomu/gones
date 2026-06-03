import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { BackButtonComponent } from './back-button.component';

@Component({
  standalone: true,
  imports: [MatCardModule, BackButtonComponent],
  template: `
    <gones-back-button label="Back to previous page" position="top" />
    <mat-card class="panel">
      <mat-card-title>Not Found</mat-card-title>
      <mat-card-content><p>The requested Gones page does not exist or the League/Tournament was deleted.</p></mat-card-content>
    </mat-card>
    <gones-back-button label="Back to previous page" position="bottom" />
  `
})
export class NotFoundComponent {}
