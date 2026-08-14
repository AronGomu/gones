import { ArchiveTournamentEditBatchCommand } from '../backend/application-backend';
import { isLocalLeagueId } from '../data/league-archive-origin';
import { PersistedLeague, TournamentDocument } from './models';

export interface ArchiveTournamentDeletionSummary {
  rounds: number;
  entries: number;
}

export function buildArchiveTournamentEditBatch(source: TournamentDocument, draft: TournamentDocument): ArchiveTournamentEditBatchCommand {
  const sourceRounds = new Map(source.rounds.map(round => [round.id, round]));
  const draftRounds = new Map(draft.rounds.map(round => [round.id, round]));
  const sourceArchetypes = new Map(source.playerArchetypes.map(row => [row.playerName, row.archetype]));
  const draftArchetypes = new Map(draft.playerArchetypes.map(row => [row.playerName, row.archetype]));
  const archetypeNames = [...new Set([...sourceArchetypes.keys(), ...draftArchetypes.keys()])].sort((left, right) => left.localeCompare(right));

  return {
    ...(source.name !== draft.name || source.tournamentDate !== draft.tournamentDate
      ? { editTournament: { name: draft.name, tournamentDate: draft.tournamentDate } }
      : {}),
    addRounds: draft.rounds
      .filter(round => !sourceRounds.has(round.id))
      .map(round => ({ roundId: round.id, entries: structuredClone(round.entries) })),
    deleteRoundIds: source.rounds.filter(round => !draftRounds.has(round.id)).map(round => round.id),
    replaceRounds: draft.rounds
      .filter(round => sourceRounds.has(round.id) && !sameJson(sourceRounds.get(round.id)!.entries, round.entries))
      .map(round => ({ roundId: round.id, entries: structuredClone(round.entries) })),
    updateArchetypes: archetypeNames
      .filter(playerName => (sourceArchetypes.get(playerName) ?? '') !== (draftArchetypes.get(playerName) ?? ''))
      .map(playerName => ({ playerName, archetype: draftArchetypes.get(playerName) ?? '' }))
  };
}

export function archiveTournamentDeletionSummary(source: TournamentDocument, draft: TournamentDocument): ArchiveTournamentDeletionSummary {
  const draftRounds = new Map(draft.rounds.map(round => [round.id, round]));
  let entries = 0;
  for (const sourceRound of source.rounds) {
    const draftRound = draftRounds.get(sourceRound.id);
    if (!draftRound) continue;
    const draftEntryIds = new Set(draftRound.entries.map(entry => entry.id));
    entries += sourceRound.entries.filter(entry => !draftEntryIds.has(entry.id)).length;
  }
  return {
    rounds: source.rounds.filter(round => !draftRounds.has(round.id)).length,
    entries
  };
}

export function sameAuthorityLeagueOptions(source: PersistedLeague, leagues: PersistedLeague[]): PersistedLeague[] {
  const local = isLocalLeagueId(source.id);
  return leagues.filter(league => league.status === 'active' && isLocalLeagueId(league.id) === local);
}

export function archiveTournamentEditBatchIsEmpty(command: ArchiveTournamentEditBatchCommand): boolean {
  return !command.editTournament && command.addRounds.length === 0 && command.deleteRoundIds.length === 0
    && command.replaceRounds.length === 0 && command.updateArchetypes.length === 0;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
