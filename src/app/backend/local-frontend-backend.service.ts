import { Injectable } from '@angular/core';
import { createLeague, LeagueDocument, normalizeLeague, PersistedLeague } from '../domain/models';
import { logBoundaryError } from '../shared/app-logger';
import type { ApplicationBackend, AuthSession, AuthorizedUser } from './application-backend';

interface StoredLeague extends PersistedLeague {
  updatedAt: string;
}

interface FrontendStore {
  version: 1;
  leagues: StoredLeague[];
  authorizedUsers: AuthorizedUser[];
  session: AuthSession | null;
}

const STORE_KEY = 'gones.frontend.backend.v1';
const CORRUPT_BACKUP_PREFIX = `${STORE_KEY}.corrupt`;
const BOOTSTRAP_ADMIN = 'admin@example.com';
const DEMO_LEAGUES: StoredLeague[] = [
  { ...createLeague({ id: 'demo-league', name: 'Demo League', status: 'active', tournaments: [] }), documentVersion: 1, updatedAt: new Date(0).toISOString() }
];

@Injectable({ providedIn: 'root' })
export class LocalFrontendBackend implements ApplicationBackend {
  readonly mode = 'frontend-local' as const;
  readonly configured = true;

  async listLeagues(): Promise<PersistedLeague[]> {
    return this.clone(this.read().leagues).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  async getLeague(id: string): Promise<PersistedLeague | null> {
    return this.clone(this.read().leagues.find((league) => league.id === id) ?? null);
  }

  async createLeague(name: string, actorEmail: string): Promise<PersistedLeague> {
    return this.insertLeague(createLeague({ name }), actorEmail);
  }

  async insertLeague(league: LeagueDocument, _actorEmail: string): Promise<PersistedLeague> {
    const persisted = this.toStoredLeague(league, 1);
    this.mutate((store) => {
      if (store.leagues.some((item) => item.id === persisted.id)) throw new Error('leagueAlreadyExists');
      return { ...store, leagues: [persisted, ...store.leagues] };
    });
    return this.clone(persisted);
  }

  async saveLeague(league: LeagueDocument, expectedVersion: number, _actorEmail: string): Promise<PersistedLeague> {
    const normalized = normalizeLeague(league);
    let saved: StoredLeague | null = null;
    this.mutate((store) => {
      const index = store.leagues.findIndex((item) => item.id === normalized.id);
      if (index === -1 || store.leagues[index].documentVersion !== expectedVersion) throw new Error('staleLeagueDocument');
      saved = this.toStoredLeague(normalized, expectedVersion + 1);
      const leagues = [...store.leagues];
      leagues[index] = saved;
      return { ...store, leagues };
    });
    if (!saved) throw new Error('leagueSaveFailed');
    return this.clone(saved);
  }

  async deleteLeague(id: string): Promise<void> {
    this.mutate((store) => ({ ...store, leagues: store.leagues.filter((league) => league.id !== id) }));
  }

  async getSession(): Promise<AuthSession | null> {
    const store = this.read();
    if (!store.session) return null;
    const role = this.lookupRoleInStore(store, store.session.email);
    return this.clone({ ...store.session, role });
  }

  async signIn(email: string): Promise<AuthSession> {
    const normalized = normalizeEmail(email) || BOOTSTRAP_ADMIN;
    const store = this.read();
    const session: AuthSession = { email: normalized, role: this.lookupRoleInStore(store, normalized), provider: 'local' };
    this.mutate((current) => ({ ...current, session }));
    return this.clone(session);
  }

  async signOut(): Promise<void> {
    this.mutate((store) => ({ ...store, session: null }));
  }

  async lookupRole(email: string): Promise<AuthSession['role']> {
    return this.lookupRoleInStore(this.read(), email);
  }

  async listAuthorizedUsers(): Promise<AuthorizedUser[]> {
    return this.clone(this.read().authorizedUsers).sort((a, b) => a.email.localeCompare(b.email));
  }

  async upsertAuthorizedUser(email: string, role: 'organizer' | 'admin', actorEmail: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const actor = normalizeEmail(actorEmail);
    if (!normalized) throw new Error('authorizedUserEmailRequired');
    this.mutate((store) => {
      const existing = store.authorizedUsers.find((user) => user.email === normalized);
      const downgradingAdmin = existing?.role === 'admin' && role !== 'admin';
      if (downgradingAdmin && actor === normalized) throw new Error('cannotDowngradeSelfAdmin');
      if (downgradingAdmin && adminCount(store.authorizedUsers) <= 1) throw new Error('cannotRemoveLastAdmin');

      const now = new Date().toISOString();
      const nextUser: AuthorizedUser = { email: normalized, role, createdAt: existing?.createdAt ?? now, updatedAt: now };
      const authorizedUsers = normalizeAuthorizedUsers([...store.authorizedUsers.filter((user) => user.email !== normalized), nextUser]);
      return { ...store, authorizedUsers, session: this.refreshStoredSessionRole(store.session, authorizedUsers) };
    });
  }

  async removeAuthorizedUser(email: string, actorEmail: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const actor = normalizeEmail(actorEmail);
    this.mutate((store) => {
      const existing = store.authorizedUsers.find((user) => user.email === normalized);
      if (existing?.role === 'admin' && actor === normalized) throw new Error('cannotRemoveSelfAdmin');
      if (existing?.role === 'admin' && adminCount(store.authorizedUsers) <= 1) throw new Error('cannotRemoveLastAdmin');
      const authorizedUsers = normalizeAuthorizedUsers(store.authorizedUsers.filter((user) => user.email !== normalized));
      return { ...store, authorizedUsers, session: this.refreshStoredSessionRole(store.session, authorizedUsers) };
    });
  }

  private lookupRoleInStore(store: FrontendStore, email: string): AuthSession['role'] {
    const normalized = normalizeEmail(email);
    const user = store.authorizedUsers.find((item) => item.email === normalized);
    return user?.role ?? 'visitor';
  }

  private refreshStoredSessionRole(session: AuthSession | null, authorizedUsers: AuthorizedUser[]): AuthSession | null {
    if (!session) return null;
    const role = authorizedUsers.find((user) => user.email === session.email)?.role ?? 'visitor';
    return { ...session, role };
  }

  private toStoredLeague(league: LeagueDocument, documentVersion: number): StoredLeague {
    return { ...normalizeLeague(league), documentVersion, updatedAt: new Date().toISOString() };
  }

  private read(): FrontendStore {
    const raw = localStorage.getItem(STORE_KEY);
    try {
      const parsed = JSON.parse(raw ?? 'null') as Partial<FrontendStore> | null;
      return this.normalizeStore(parsed, raw);
    } catch (error) {
      logBoundaryError('local-frontend-backend.read', error, { hasRaw: Boolean(raw) });
      this.backupRawStore(raw);
      return this.defaultStore();
    }
  }

  private mutate(update: (store: FrontendStore) => FrontendStore): void {
    localStorage.setItem(STORE_KEY, JSON.stringify(update(this.read())));
  }

  private normalizeStore(store: Partial<FrontendStore> | null, raw: string | null): FrontendStore {
    if (!store) return this.defaultStore();
    if (!Array.isArray(store.leagues)) {
      this.backupRawStore(raw);
      return this.defaultStore();
    }
    const authorizedUsers = normalizeAuthorizedUsers(store.authorizedUsers);
    return {
      version: 1,
      leagues: store.leagues.map((league) => this.normalizeStoredLeague(league)),
      authorizedUsers,
      session: store.session?.email ? this.refreshStoredSessionRole({ email: normalizeEmail(store.session.email), role: 'visitor', provider: 'local' }, authorizedUsers) : null
    };
  }

  private normalizeStoredLeague(league: Partial<StoredLeague>): StoredLeague {
    const normalized = normalizeLeague(league);
    return { ...normalized, documentVersion: league.documentVersion || 1, updatedAt: league.updatedAt ?? new Date().toISOString() };
  }

  private backupRawStore(raw: string | null): void {
    if (!raw) return;
    localStorage.setItem(`${CORRUPT_BACKUP_PREFIX}.${new Date().toISOString()}`, raw);
  }

  private defaultStore(): FrontendStore {
    return { version: 1, leagues: this.clone(DEMO_LEAGUES), authorizedUsers: normalizeAuthorizedUsers([]), session: null };
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}

function normalizeAuthorizedUsers(users: unknown): AuthorizedUser[] {
  const normalized = new Map<string, AuthorizedUser>();
  if (Array.isArray(users)) {
    for (const user of users) {
      if (!user || typeof user !== 'object') continue;
      const value = user as Partial<AuthorizedUser>;
      const email = normalizeEmail(value.email ?? '');
      const role = value.role === 'admin' || value.role === 'organizer' ? value.role : null;
      if (!email || !role) continue;
      normalized.set(email, { email, role, createdAt: value.createdAt, updatedAt: value.updatedAt });
    }
  }
  if (!normalized.has(BOOTSTRAP_ADMIN)) {
    const now = new Date(0).toISOString();
    normalized.set(BOOTSTRAP_ADMIN, { email: BOOTSTRAP_ADMIN, role: 'admin', createdAt: now, updatedAt: now });
  }
  return [...normalized.values()];
}

function adminCount(users: AuthorizedUser[]): number {
  return users.filter((user) => user.role === 'admin').length;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
