import { computed, Injectable, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';
import { UserRole } from '../domain/models';
import { SupabaseClientService } from '../data/supabase-client.service';
import { logBoundaryError } from '../shared/app-logger';

export interface AuthState {
  loading: boolean;
  session: Session | null;
  email: string;
  role: UserRole;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly stateSignal = signal<AuthState>({ loading: true, session: null, email: '', role: 'visitor' });
  readonly state = this.stateSignal.asReadonly();
  readonly canEdit = computed(() => this.state().role === 'organizer' || this.state().role === 'admin');
  readonly isAdmin = computed(() => this.state().role === 'admin');

  constructor(private readonly supabase: SupabaseClientService) {
    void this.refresh();
    this.supabase.client?.auth.onAuthStateChange((_event, session) => {
      void this.applySession(session);
    });
  }

  async refresh(): Promise<void> {
    if (!this.supabase.client) {
      this.stateSignal.set({ loading: false, session: null, email: '', role: 'visitor' });
      return;
    }
    const { data } = await this.supabase.client.auth.getSession();
    await this.applySession(data.session);
  }

  async login(returnUrl = location.pathname + location.search): Promise<void> {
    const client = this.supabase.requireClient();
    await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/login?returnUrl=${encodeURIComponent(returnUrl)}` }
    });
  }

  async signOut(): Promise<void> {
    await this.supabase.client?.auth.signOut();
    this.stateSignal.set({ loading: false, session: null, email: '', role: 'visitor' });
  }

  private async applySession(session: Session | null): Promise<void> {
    const email = verifiedEmail(session?.user);
    const role = email ? await this.lookupRole(email) : 'visitor';
    this.stateSignal.set({ loading: false, session, email, role });
  }

  private async lookupRole(email: string): Promise<UserRole> {
    const client = this.supabase.client;
    if (!client) return 'visitor';
    const { data, error } = await client.from('authorized_users').select('role').eq('email', email.toLowerCase()).maybeSingle();
    if (error) { logBoundaryError('auth.lookupRole', error, { email }); return 'visitor'; }
    if (!data?.role) return 'visitor';
    return data.role === 'admin' ? 'admin' : data.role === 'organizer' ? 'organizer' : 'visitor';
  }
}

function verifiedEmail(user: User | null | undefined): string {
  const email = user?.email?.toLowerCase() ?? '';
  const verified = user?.email_confirmed_at || user?.user_metadata?.['email_verified'] === true;
  return email && verified ? email : '';
}
