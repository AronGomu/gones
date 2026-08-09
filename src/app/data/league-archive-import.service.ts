import { Injectable } from '@angular/core';
import { LeagueArchiveRepository } from './league-archive-repository.service';
import { normalizeExportFile } from '../domain/export-restore';
import { EXPORT_LIMITS, verifyExportChecksum } from '../domain/export-schemas';
import { logBoundaryError } from '../shared/app-logger';

export interface LeagueImportResult {
  kind: 'league' | 'fullData';
  importedLeagueIds: string[];
}

const MAX_IMPORT_FILE_BYTES = EXPORT_LIMITS.maxImportFileBytes;
const MAX_FULL_DATA_LEAGUES = EXPORT_LIMITS.maxFullDataLeagues;

function importKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `league-import-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

@Injectable({ providedIn: 'root' })
export class LeagueArchiveImportService {
  constructor(private readonly repo: LeagueArchiveRepository) {}

  async importFile(file: File): Promise<LeagueImportResult> {
    if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('gonesImportFileTooLarge');

    const parsed = JSON.parse(await file.text());
    const exportFile = normalizeExportFile(parsed);
    // v4 artifacts carry a checksum; a mismatch rejects the file before any mutation.
    if (!(await verifyExportChecksum(parsed))) throw new Error('gonesExportChecksumMismatch');

    // Legacy CalendarEvent documents in an older bundle are ignored: the server Calendar is owned
    // by Scheduled Tournaments and has no whole-document CalendarEvent path (ADR 0020).
    if (exportFile.kind === 'fullData') {
      if (exportFile.leagues.length > MAX_FULL_DATA_LEAGUES) throw new Error('gonesImportTooManyLeagues');
      const importedLeagueIds: string[] = [];
      try {
        const leagues = await this.repo.restoreFullLeagueData({ kind: 'fullData', gonesDataVersion: exportFile.gonesDataVersion, leagues: exportFile.leagues }, importKey());
        importedLeagueIds.push(...leagues.map(league => league.id));
      } catch (error) {
        await this.rollbackImportedLeagues(importedLeagueIds);
        throw error;
      }
      return { kind: 'fullData', importedLeagueIds };
    }

    const persisted = await this.repo.restoreLeague({ kind: 'league', gonesDataVersion: exportFile.gonesDataVersion, league: exportFile.league }, importKey());
    return { kind: 'league', importedLeagueIds: [persisted.id] };
  }

  private async rollbackImportedLeagues(importedLeagueIds: string[]): Promise<void> {
    const results = await Promise.allSettled(importedLeagueIds.map((id) => this.repo.deleteLeague(id)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') logBoundaryError('league-import.rollback', result.reason, { leagueId: importedLeagueIds[index] });
    });
  }

}
