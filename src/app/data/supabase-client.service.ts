import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseClientService {
  readonly configured = Boolean(environment.supabaseUrl && environment.supabaseAnonKey);
  readonly client: SupabaseClient | null = this.configured
    ? createClient(environment.supabaseUrl, environment.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;

  requireClient(): SupabaseClient {
    if (!this.client) throw new Error('supabaseNotConfigured');
    return this.client;
  }
}
