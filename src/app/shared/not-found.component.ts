import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule],
  template: `<mat-card class="panel"><mat-card-title>Not Found</mat-card-title><mat-card-content><p>The requested Gones page does not exist or the League/Tournament was deleted.</p></mat-card-content><mat-card-actions><a mat-flat-button color="primary" routerLink="/leagues">Back to Leagues</a></mat-card-actions></mat-card>`
})
export class NotFoundComponent {}
