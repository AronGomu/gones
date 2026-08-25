import type { ArchiveRoundIntent, ArchiveTournamentEditBatch } from '../backend/local-archive-backend.service';
import type { ArchiveTournamentDocument } from './archive-models';

/** What the final Save dialog reports once, per ADR 0037. */
export interface ArchiveStagedDeletionSummary {
  rounds: number;
  entries: number;
}

/** How the Season selector encodes "no Season". A `<mat-select>` cannot carry `null` as an option
 *  value without also meaning "nothing selected", so standalone gets its own sentinel string. */
export const ARCHIVE_STANDALONE_SEASON_VALUE = '__standalone__';

/**
 * Diff two Tournament documents into ADR 0037's fixed explicit-intent batch.
 *
 * `moveToSeasonId` is emitted **only** when `draftSeasonId` differs from `source.seasonId`, because
 * the key's mere presence is the move discriminator on both authorities: absent means "do not move",
 * present-and-null means "detach to standalone".
 *
 * `status` is emitted only when it changed. Round comparison is by `id`: a round present in the
 * draft and absent from the source is an add, absent from the draft and present in the source is a
 * delete, and present in both with different entries is a replace. Entries are compared with
 * `JSON.stringify`, which is order-sensitive on purpose — reordering entries is an edit.
 * `updateArchetypes` carries every player whose archetype changed, missing counted as `''`, sorted
 * by `playerName` with `localeCompare` so one draft always produces one byte-identical batch.
 */
export function buildArchiveStagedEditBatch(
  source: ArchiveTournamentDocument,
  draft: ArchiveTournamentDocument,
  draftSeasonId: string | null
): ArchiveTournamentEditBatch {
  const sourceRounds = new Map(source.rounds.map((round) => [round.id, round]));
  const draftRounds = new Map(draft.rounds.map((round) => [round.id, round]));
  const sourceArchetypes = new Map(source.playerArchetypes.map((row) => [row.playerName, row.archetype]));
  const draftArchetypes = new Map(draft.playerArchetypes.map((row) => [row.playerName, row.archetype]));
  const playerNames = [...new Set([...sourceArchetypes.keys(), ...draftArchetypes.keys()])]
    .sort((left, right) => left.localeCompare(right));

  return {
    ...(source.name !== draft.name || source.tournamentDate !== draft.tournamentDate
      ? { editTournament: { name: draft.name, tournamentDate: draft.tournamentDate } }
      : {}),
    ...(source.status !== draft.status ? { status: draft.status } : {}),
    ...(source.seasonId !== draftSeasonId ? { moveToSeasonId: draftSeasonId } : {}),
    addRounds: draft.rounds
      .filter((round) => !sourceRounds.has(round.id))
      .map((round): ArchiveRoundIntent => ({ roundId: round.id, entries: structuredClone(round.entries) })),
    deleteRoundIds: source.rounds.filter((round) => !draftRounds.has(round.id)).map((round) => round.id),
    replaceRounds: draft.rounds
      .filter((round) => sourceRounds.has(round.id) && !sameJson(sourceRounds.get(round.id)!.entries, round.entries))
      .map((round): ArchiveRoundIntent => ({ roundId: round.id, entries: structuredClone(round.entries) })),
    updateArchetypes: playerNames
      .filter((playerName) => (sourceArchetypes.get(playerName) ?? '') !== (draftArchetypes.get(playerName) ?? ''))
      .map((playerName) => ({ playerName, archetype: draftArchetypes.get(playerName) ?? '' }))
  };
}

/** Rounds deleted outright, and entries deleted from a round that survived. */
export function archiveStagedDeletionSummary(
  source: ArchiveTournamentDocument,
  draft: ArchiveTournamentDocument
): ArchiveStagedDeletionSummary {
  const draftRounds = new Map(draft.rounds.map((round) => [round.id, round]));
  let entries = 0;
  for (const sourceRound of source.rounds) {
    const draftRound = draftRounds.get(sourceRound.id);
    if (!draftRound) continue;
    const draftEntryIds = new Set(draftRound.entries.map((entry) => entry.id));
    entries += sourceRound.entries.filter((entry) => !draftEntryIds.has(entry.id)).length;
  }
  return { rounds: source.rounds.filter((round) => !draftRounds.has(round.id)).length, entries };
}

/**
 * True when the batch would be refused as empty by both authorities — `400 validation_failed` on the
 * server, `Error('emptyArchiveTournamentEditBatch')` in the browser. `moveToSeasonId` counts by
 * **key presence**, not by value, so a detach-to-standalone is never mistaken for an empty batch.
 */
export function archiveStagedEditBatchIsEmpty(batch: ArchiveTournamentEditBatch): boolean {
  return !batch.editTournament
    && batch.status === undefined
    && !Object.hasOwn(batch, 'moveToSeasonId')
    && batch.addRounds.length === 0
    && batch.deleteRoundIds.length === 0
    && batch.replaceRounds.length === 0
    && batch.updateArchetypes.length === 0;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
