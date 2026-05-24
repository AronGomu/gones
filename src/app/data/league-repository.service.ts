import { Injectable } from '@angular/core';
import { createLeague, GONES_DATA_VERSION, LeagueDocument, normalizeLeague, PersistedLeague } from '../domain/models';
import { SupabaseClientService } from './supabase-client.service';
import { AuthService } from '../auth/auth.service';

interface LeagueRow {
  id: string;
  name: string;
  status: 'active' | 'completed';
  source_data: LeagueDocument;
  document_version: number;
  updated_at?: string;
}

const DEMO_LEAGUES: PersistedLeague[] = [
  { ...createLeague({ id: 'demo-league', name: 'Demo League', status: 'active', tournaments: [] }), documentVersion: 1 }
];

@Injectable({ providedIn: 'root' })
export class LeagueRepository {
  private demoLeagues = structuredClone(DEMO_LEAGUES);

  constructor(private readonly supabase: SupabaseClientService, private readonly auth: AuthService) {}

  get configured(): boolean { return this.supabase.configured; }

  async listLeagues(): Promise<PersistedLeague[]> {
    if (!this.supabase.client) return structuredClone(this.demoLeagues);
    const { data, error } = await this.supabase.client.from('public_leagues').select('id,name,status,source_data,document_version,updated_at').order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  }

  async getLeague(id: string): Promise<PersistedLeague | null> {
    if (!this.supabase.client) return structuredClone(this.demoLeagues.find((league) => league.id === id) ?? null);
    const { data, error } = await this.supabase.client.from('public_leagues').select('id,name,status,source_data,document_version,updated_at').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as LeagueRow) : null;
  }

  async createLeague(name: string): Promise<PersistedLeague> {
    const league = createLeague({ name });
    if (!this.supabase.client) {
      const persisted = { ...league, documentVersion: 1 };
      this.demoLeagues = [persisted, ...this.demoLeagues];
      return structuredClone(persisted);
    }
    const row = toWriteRow(league, 1, this.auth.state().email);
    const { error } = await this.supabase.client.from('leagues').insert(row);
    if (error) throw error;
    const persisted = await this.getLeague(league.id);
    if (!persisted) throw new Error('leagueInsertNotVisible');
    return persisted;
  }

  async insertLeague(league: LeagueDocument): Promise<PersistedLeague> {
    if (!this.supabase.client) {
      const persisted = { ...normalizeLeague(league), documentVersion: 1 };
      this.demoLeagues = [persisted, ...this.demoLeagues];
      return structuredClone(persisted);
    }
    const { error } = await this.supabase.client.from('leagues').insert(toWriteRow(league, 1, this.auth.state().email));
    if (error) throw error;
    const persisted = await this.getLeague(league.id);
    if (!persisted) throw new Error('leagueInsertNotVisible');
    return persisted;
  }

  async saveLeague(league: LeagueDocument, expectedVersion: number): Promise<PersistedLeague> {
    const normalized = normalizeLeague(league);
    if (!this.supabase.client) {
      const index = this.demoLeagues.findIndex((item) => item.id === league.id);
      if (index === -1 || this.demoLeagues[index].documentVersion !== expectedVersion) throw new Error('staleLeagueDocument');
      const persisted = { ...normalized, documentVersion: expectedVersion + 1 };
      this.demoLeagues[index] = persisted;
      return structuredClone(persisted);
    }
    const { count, error } = await this.supabase.client
      .from('leagues')
      .update(toWriteRow(normalized, expectedVersion + 1, this.auth.state().email), { count: 'exact' })
      .eq('id', normalized.id)
      .eq('document_version', expectedVersion);
    if (error) throw error;
    if (!count) throw new Error('staleLeagueDocument');
    const persisted = await this.getLeague(normalized.id);
    if (!persisted) throw new Error('leagueUpdateNotVisible');
    return persisted;
  }

  async deleteLeague(id: string): Promise<void> {
    if (!this.supabase.client) {
      this.demoLeagues = this.demoLeagues.filter((league) => league.id !== id);
      return;
    }
    const { error } = await this.supabase.client.from('leagues').delete().eq('id', id);
    if (error) throw error;
  }
}

function mapRow(row: LeagueRow): PersistedLeague {
  const source = normalizeLeague({ ...row.source_data, id: row.id, name: row.name, status: row.status });
  return { ...source, documentVersion: row.document_version, updatedAt: row.updated_at };
}

function toWriteRow(league: LeagueDocument, documentVersion: number, email: string) {
  const source_data = { ...normalizeLeague(league), name: league.name, status: league.status, version: GONES_DATA_VERSION };
  return { id: league.id, name: league.name, status: league.status, source_data, document_version: documentVersion, updated_by_email: email || null };
}
