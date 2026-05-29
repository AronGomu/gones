import { Injectable } from '@angular/core';
import { LeagueRepository } from './league-repository.service';
import { normalizeExportFile, restoreFullData, restoreLeague } from '../domain/export-restore';
import { defaultIdFactory } from '../domain/models';
import { AuthService } from '../auth/auth.service';
import { logBoundaryError } from '../shared/app-logger';

export interface LeagueImportResult {
  kind: 'league' | 'fullData';
  importedLeagueIds: string[];
}

const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FULL_DATA_LEAGUES = 100;

@Injectable({ providedIn: 'root' })
export class LeagueImportService {
  constructor(private readonly repo: LeagueRepository, private readonly auth: AuthService) {}

  async importFile(file: File): Promise<LeagueImportResult> {
    if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('gonesImportFileTooLarge');

    const parsed = JSON.parse(await file.text());
    const exportFile = normalizeExportFile(parsed);

    if (exportFile.kind === 'fullData') {
      if (!this.auth.isAdmin()) throw new Error('adminOnlyFullDataRestore');
      if (exportFile.leagues.length > MAX_FULL_DATA_LEAGUES) throw new Error('gonesImportTooManyLeagues');
      const existingLeagues = await this.repo.listLeagues();
      const restoredLeagues = restoreFullData(parsed, { idFactory: defaultIdFactory, existingLeagues: [...existingLeagues] });
      const importedLeagueIds: string[] = [];
      try {
        for (const restored of restoredLeagues) {
          const persisted = await this.repo.insertLeague(restored);
          importedLeagueIds.push(persisted.id);
        }
      } catch (error) {
        await this.rollbackImportedLeagues(importedLeagueIds);
        throw error;
      }
      return { kind: 'fullData', importedLeagueIds };
    }

    const existingLeagues = await this.repo.listLeagues();
    const restored = restoreLeague(parsed, { idFactory: defaultIdFactory, existingLeagues });
    const persisted = await this.repo.insertLeague(restored);
    return { kind: 'league', importedLeagueIds: [persisted.id] };
  }

  private async rollbackImportedLeagues(importedLeagueIds: string[]): Promise<void> {
    const results = await Promise.allSettled(importedLeagueIds.map((id) => this.repo.deleteLeague(id)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') logBoundaryError('league-import.rollback', result.reason, { leagueId: importedLeagueIds[index] });
    });
  }
}
