import { computed, inject, Injectable, signal } from '@angular/core';
import { APP_BACKEND, ApplicationBackend, AuthSession } from '../backend/application-backend';
import { UserRole } from '../domain/models';
import { logBoundaryError } from '../shared/app-logger';

export interface AuthState {
  loading: boolean;
  session: AuthSession | null;
  email: string;
  role: UserRole;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly stateSignal = signal<AuthState>({ loading: true, session: null, email: '', role: 'visitor' });
  readonly state = this.stateSignal.asReadonly();
  readonly canEdit = computed(() => this.state().role === 'organizer' || this.state().role === 'admin');
  readonly isAdmin = computed(() => this.state().role === 'admin');

  private readonly backend: ApplicationBackend = inject(APP_BACKEND);

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const session = await this.backend.getSession();
      this.applySession(session);
    } catch (error) {
      logBoundaryError('auth.refresh', error);
      this.stateSignal.set({ loading: false, session: null, email: '', role: 'visitor' });
    }
  }

  async login(_returnUrl = location.pathname + location.search, email = 'admin@example.com'): Promise<void> {
    const session = await this.backend.signIn(email);
    this.applySession(session);
  }

  async signOut(): Promise<void> {
    await this.backend.signOut();
    this.stateSignal.set({ loading: false, session: null, email: '', role: 'visitor' });
  }

  private applySession(session: AuthSession | null): void {
    this.stateSignal.set({ loading: false, session, email: session?.email ?? '', role: session?.role ?? 'visitor' });
  }
}
