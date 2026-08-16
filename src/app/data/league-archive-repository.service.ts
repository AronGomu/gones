import { inject, Injectable, signal } from '@angular/core';
import { ArchiveTournamentEditBatchCommand, ArchiveTournamentEditBatchResult, LEAGUE_ARCHIVE_BACKEND, LeagueArchiveBackendPort, FullLeagueRestoreCommand, LeagueRestoreCommand } from '../backend/application-backend';
import { LocalLeagueArchiveBackend } from '../backend/local-league-archive-backend.service';
import { ServerReadCacheService } from '../backend/server-read-cache.service';
import { AuthService } from '../auth/auth.service';
import { getDefaultTournamentName, isUnassignedLeagueName, LeagueStatus, PersistedLeague, PLACEHOLDER_LEAGUE_ID, RoundEntry, TournamentDocument } from '../domain/models';
import { createLeagueTarget } from './league-archive-command-ux';
import { isAnyPlaceholderLeagueId, isLocalLeagueId, LOCAL_PLACEHOLDER_LEAGUE_ID } from './league-archive-origin';
import { PowerUserSettingsService } from '../shared/power-user-settings.service';

/**
 * The dual-source League Archive (ADR 0028). Two stores, one list: `listLeagues()` merges them and
 * every other call routes on `isLocalLeagueId(id)`. This is deliberately *not* ADR 0021's
 * one-adapter-by-role shape — a signed-in Organizer still needs a handle on the browser store so a
 * full export can carry the leagues created while signed out.
 *
 * A league belongs to exactly one store for its whole life and never moves. There is no sync, no
 * conflict resolution and no second source of truth about where a league lives.
 */
@Injectable({ providedIn: 'root' })
export class LeagueArchiveRepository {
  private readonly server: LeagueArchiveBackendPort = inject(LEAGUE_ARCHIVE_BACKEND);
  private readonly local = inject(LocalLeagueArchiveBackend);
  private readonly auth = inject(AuthService);
  private readonly cache = inject(ServerReadCacheService);
  private readonly power = inject(PowerUserSettingsService);

  /** The last `listLeagues()` could not read the server — anonymous, offline, 401, 403 or cached. */
  readonly serverUnavailable = signal(false);
  /** Last server League detail came from this user's offline cache, not from server. */
  readonly detailStale = signal(false);

  /**
   * The union of both stores. A rejected server read degrades to the local list alone and raises the
   * flag the list page renders; only both stores failing propagates.
   *
   * Only the server half goes through the offline read cache (ADR 0031): the browser store is already
   * offline, and mirroring it would create two answers for one document. A cached answer still raises
   * `serverUnavailable` — it means exactly what the banner says, that the server was not reached.
   */
  listServerLeagues(): Promise<PersistedLeague[]> {
    return this.server.listLeagueArchives();
  }

  listLocalLeagues(): Promise<PersistedLeague[]> {
    return this.local.listLeagueArchives();
  }

  async listLeagues(): Promise<PersistedLeague[]> {
    const serverRead = this.cache.read('leagues', () => this.server.listLeagueArchives());
    const [server, local] = await Promise.allSettled([serverRead, this.local.listLeagueArchives()]);
    this.serverUnavailable.set(server.status === 'rejected' || (server.status === 'fulfilled' && server.value.stale));
    if (server.status === 'rejected' && local.status === 'rejected') throw server.reason;
    return [
      ...(server.status === 'fulfilled' ? server.value.value : []),
      ...(local.status === 'fulfilled' ? local.value : [])
    ];
  }

  async getLeague(id: string): Promise<PersistedLeague | null> {
    if (isLocalLeagueId(id)) {
      this.detailStale.set(false);
      return this.local.getLeagueArchive(id);
    }
    this.detailStale.set(false);
    const result = await this.cache.read(`league:${id}`, () => this.server.getLeagueArchive(id));
    this.detailStale.set(result.stale);
    return result.value;
  }

  createLeague(name: string, idempotencyKey?: string): Promise<PersistedLeague> {
    return this.freshMutation(async () => {
      if (isUnassignedLeagueName(name)) return this.ensurePlaceholderLeague();
      return this.writePort().createLeagueArchive(name, idempotencyKey);
    });
  }

  renameLeague(league: PersistedLeague, name: string): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).renameLeagueArchive(league.id, league.documentVersion, name));
  }

  changeLeagueStatus(league: PersistedLeague, status: LeagueStatus): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).changeLeagueArchiveStatus(league.id, league.documentVersion, status));
  }

  deleteLeague(id: string): Promise<void> {
    return this.freshMutation(async () => {
      // Both stores seed their own placeholder row; neither one can be deleted (ADR 0028).
      if (isAnyPlaceholderLeagueId(id)) throw new Error('placeholderLeagueCannotBeDeleted');
      const port = this.port(id);
      const league = await port.getLeagueArchive(id);
      if (!league) throw new Error('leagueNotFound');
      await port.deleteLeagueArchive(id, league.documentVersion);
    });
  }

  /**
   * Each store seeds its own placeholder League and neither one can create the other's: the server
   * placeholder answers a caller who writes the server, the browser placeholder answers everyone
   * else.
   */
  async ensurePlaceholderLeague(): Promise<PersistedLeague> {
    const local = createLeagueTarget(this.auth.profile()?.globalRole) === 'local';
    const id = local ? LOCAL_PLACEHOLDER_LEAGUE_ID : PLACEHOLDER_LEAGUE_ID;
    const existing = await (local ? this.local : this.server).getLeagueArchive(id);
    if (!existing) throw new Error('placeholderLeagueMissing');
    return existing;
  }

  createResultTournament(league: PersistedLeague, name = getDefaultTournamentName(), tournamentDate = ''): Promise<{ league: PersistedLeague; tournament: TournamentDocument }> {
    return this.freshMutation(async () => {
      const updated = await this.port(league.id).createArchiveTournament(league.id, league.documentVersion, name, tournamentDate);
      const previousIds = new Set(league.tournaments.map(tournament => tournament.id));
      const tournament = updated.tournaments.find(item => !previousIds.has(item.id));
      if (!tournament) throw new Error('createdTournamentMissing');
      return { league: updated, tournament };
    });
  }

  editResultTournament(league: PersistedLeague, tournamentId: string, name: string, tournamentDate: string): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).editArchiveTournament(league.id, tournamentId, league.documentVersion, name, tournamentDate));
  }

  deleteResultTournament(league: PersistedLeague, tournamentId: string): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).deleteArchiveTournament(league.id, tournamentId, league.documentVersion));
  }

  addResultRound(league: PersistedLeague, tournamentId: string): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).addArchiveRound(league.id, tournamentId, league.documentVersion));
  }

  deleteResultRound(league: PersistedLeague, tournamentId: string, roundId: string): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).deleteArchiveRound(league.id, tournamentId, roundId, league.documentVersion));
  }

  importResultRound(league: PersistedLeague, tournamentId: string, roundId: string, text: string): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).importArchiveRound(league.id, tournamentId, roundId, league.documentVersion, text));
  }

  replaceResultRound(league: PersistedLeague, tournamentId: string, roundId: string, entries: RoundEntry[]): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).replaceArchiveRound(league.id, tournamentId, roundId, league.documentVersion, entries));
  }

  addResultEntry(league: PersistedLeague, tournamentId: string, roundId: string, entry: RoundEntry): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).addArchiveEntry(league.id, tournamentId, roundId, league.documentVersion, entry));
  }

  editResultEntry(league: PersistedLeague, tournamentId: string, roundId: string, entryId: string, entry: RoundEntry): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).editArchiveEntry(league.id, tournamentId, roundId, entryId, league.documentVersion, entry));
  }

  deleteResultEntry(league: PersistedLeague, tournamentId: string, roundId: string, entryId: string): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).deleteArchiveEntry(league.id, tournamentId, roundId, entryId, league.documentVersion));
  }

  updateResultPlayerArchetype(league: PersistedLeague, tournamentId: string, playerName: string, archetype: string): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).updateArchivePlayerArchetype(league.id, tournamentId, playerName, league.documentVersion, archetype));
  }

  renameLeaguePlayerName(league: PersistedLeague, fromName: string, toName: string): Promise<PersistedLeague> {
    return this.freshMutation(() => this.port(league.id).renameLeagueArchivePlayerName(league.id, league.documentVersion, fromName, toName));
  }

  /**
   * An imported bundle carries no authority of its own: it lands in the store the caller may write,
   * exactly like a brand-new league, and the target store rewrites the incoming ids into its own
   * namespace so nothing can collide (ADR 0028).
   */
  restoreLeague(command: LeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague> {
    return this.freshMutation(() => this.writePort().restoreLeagueArchive(command, idempotencyKey));
  }

  restoreFullLeagueData(command: FullLeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague[]> {
    return this.freshMutation(() => this.writePort().restoreFullLeagueArchiveData(command, idempotencyKey));
  }

  saveTournamentEdits(
    sourceLeague: PersistedLeague,
    tournamentId: string,
    targetLeague: PersistedLeague | null,
    command: ArchiveTournamentEditBatchCommand
  ): Promise<ArchiveTournamentEditBatchResult> {
    return this.freshMutation(() => {
      if (targetLeague && isLocalLeagueId(sourceLeague.id) !== isLocalLeagueId(targetLeague.id)) throw new Error('crossAuthorityMoveNotSupported');
      const target = targetLeague && targetLeague.id !== sourceLeague.id
        ? { leagueId: targetLeague.id, expectedVersion: targetLeague.documentVersion }
        : undefined;
      return this.port(sourceLeague.id).applyArchiveTournamentEditBatch(
        sourceLeague.id,
        tournamentId,
        sourceLeague.documentVersion,
        command,
        target
      );
    });
  }

  /**
   * A tournament never crosses the boundary between the two authorities: emulating it would be a
   * sync path wearing a different hat. Export and re-import is the only bridge, and it is
   * user-driven. The refusal happens before either store is read, so neither can be corrupted.
   */
  moveTournament(tournamentId: string, fromLeagueId: string, toLeagueId: string): Promise<{ fromLeague: PersistedLeague; toLeague: PersistedLeague }> {
    return this.freshMutation(async () => {
      const targetLeagueId = toLeagueId || PLACEHOLDER_LEAGUE_ID;
      if (isLocalLeagueId(fromLeagueId) !== isLocalLeagueId(targetLeagueId)) throw new Error('crossAuthorityMoveNotSupported');
      const port = this.port(fromLeagueId);
      const fromLeague = await port.getLeagueArchive(fromLeagueId);
      const toLeague = await port.getLeagueArchive(targetLeagueId);
      if (!fromLeague || !toLeague) throw new Error('leagueNotFound');
      const result = await port.applyArchiveTournamentEditBatch(
        fromLeagueId,
        tournamentId,
        fromLeague.documentVersion,
        { addRounds: [], deleteRoundIds: [], replaceRounds: [], updateArchetypes: [] },
        { leagueId: targetLeagueId, expectedVersion: toLeague.documentVersion }
      );
      return { fromLeague: result.sourceLeague, toLeague: result.destinationLeague! };
    });
  }

  private async freshMutation<T>(action: () => Promise<T>): Promise<T> {
    this.power.requireEnabled();
    const result = await action();
    this.detailStale.set(false);
    return result;
  }

  /** The whole routing rule: origin is encoded in the id, and nothing else decides the store. */
  private port(id: string): LeagueArchiveBackendPort {
    return isLocalLeagueId(id) ? this.local : this.server;
  }

  /** The one write with no id to route on: the role decides where a brand-new league is born. */
  private writePort(): LeagueArchiveBackendPort {
    return createLeagueTarget(this.auth.profile()?.globalRole) === 'local' ? this.local : this.server;
  }
}
