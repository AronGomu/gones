import { inject, Injectable } from '@angular/core';
import { APP_BACKEND, ApplicationBackend, type AuthorizedUser } from '../backend/application-backend';
import { AuthService } from '../auth/auth.service';

export type { AuthorizedUser } from '../backend/application-backend';

@Injectable({ providedIn: 'root' })
export class AuthorizedUsersService {
  private readonly backend: ApplicationBackend = inject(APP_BACKEND);

  constructor(private readonly auth: AuthService) {}

  async list(): Promise<AuthorizedUser[]> {
    return this.backend.listAuthorizedUsers();
  }

  async upsert(email: string, role: 'organizer' | 'admin'): Promise<void> {
    await this.backend.upsertAuthorizedUser(email, role, this.auth.state().email);
  }

  async remove(email: string): Promise<void> {
    await this.backend.removeAuthorizedUser(email, this.auth.state().email);
  }
}
