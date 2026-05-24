import { Injectable } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientService } from '../data/supabase-client.service';

export interface AuthorizedUser {
  email: string;
  role: 'organizer' | 'admin';
  created_at?: string;
  updated_at?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthorizedUsersService {
  private demoUsers: AuthorizedUser[] = [{ email: 'admin@example.com', role: 'admin' }];

  constructor(private readonly supabase: SupabaseClientService, private readonly auth: AuthService) {}

  async list(): Promise<AuthorizedUser[]> {
    if (!this.supabase.client) return structuredClone(this.demoUsers);
    const { data, error } = await this.supabase.client.from('authorized_users').select('email,role,created_at,updated_at').order('email');
    if (error) throw error;
    return data ?? [];
  }

  async upsert(email: string, role: 'organizer' | 'admin'): Promise<void> {
    const normalized = email.trim().toLowerCase();
    if (!this.supabase.client) {
      this.demoUsers = [...this.demoUsers.filter((user) => user.email !== normalized), { email: normalized, role }];
      return;
    }
    const actor = this.auth.state().email || null;
    const { error } = await this.supabase.client.from('authorized_users').upsert({ email: normalized, role, created_by_email: actor, updated_by_email: actor }, { onConflict: 'email' });
    if (error) throw error;
  }

  async remove(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    if (!this.supabase.client) {
      this.demoUsers = this.demoUsers.filter((user) => user.email !== normalized);
      return;
    }
    const { error } = await this.supabase.client.from('authorized_users').delete().eq('email', normalized);
    if (error) throw error;
  }
}
