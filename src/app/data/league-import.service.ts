import { Injectable } from '@angular/core';
import { CalendarEventRepository } from './calendar-event-repository.service';
import { LeagueRepository } from './league-repository.service';
import { normalizeExportFile, restoreFullDataBundle, restoreLeague } from '../domain/export-restore';
import { defaultIdFactory } from '../domain/models';
import { logBoundaryError } from '../shared/app-logger';

export interface LeagueImportResult {
  kind: 'league' | 'fullData';
  importedLeagueIds: string[];
  importedCalendarEventIds: string[];
}

const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FULL_DATA_LEAGUES = 100;

@Injectable({ providedIn: 'root' })
export class LeagueImportService {
  constructor(private readonly repo: LeagueRepository, private readonly calendarRepo: CalendarEventRepository) {}

  async importFile(file: File): Promise<LeagueImportResult> {
    if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('gonesImportFileTooLarge');

    const parsed = JSON.parse(await file.text());
    const exportFile = normalizeExportFile(parsed);

    if (exportFile.kind === 'fullData') {
      if (exportFile.leagues.length > MAX_FULL_DATA_LEAGUES) throw new Error('gonesImportTooManyLeagues');
      const existingLeagues = await this.repo.listLeagues();
      const restored = restoreFullDataBundle(parsed, { idFactory: defaultIdFactory, existingLeagues: [...existingLeagues] });
      const importedLeagueIds: string[] = [];
      const importedCalendarEventIds: string[] = [];
      try {
        for (const restoredLeague of restored.leagues) {
          const persisted = await this.repo.insertLeague(restoredLeague);
          importedLeagueIds.push(persisted.id);
        }
        for (const event of restored.calendarEvents) {
          const persisted = await this.calendarRepo.save(event);
          importedCalendarEventIds.push(persisted.id);
        }
      } catch (error) {
        await this.rollbackImportedLeagues(importedLeagueIds);
        await this.rollbackImportedCalendarEvents(importedCalendarEventIds);
        throw error;
      }
      return { kind: 'fullData', importedLeagueIds, importedCalendarEventIds };
    }

    const existingLeagues = await this.repo.listLeagues();
    const restored = restoreLeague(parsed, { idFactory: defaultIdFactory, existingLeagues });
    const persisted = await this.repo.insertLeague(restored);
    return { kind: 'league', importedLeagueIds: [persisted.id], importedCalendarEventIds: [] };
  }

  private async rollbackImportedLeagues(importedLeagueIds: string[]): Promise<void> {
    const results = await Promise.allSettled(importedLeagueIds.map((id) => this.repo.deleteLeague(id)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') logBoundaryError('league-import.rollback', result.reason, { leagueId: importedLeagueIds[index] });
    });
  }

  private async rollbackImportedCalendarEvents(importedCalendarEventIds: string[]): Promise<void> {
    const results = await Promise.allSettled(importedCalendarEventIds.map((id) => this.calendarRepo.delete(id)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') logBoundaryError('league-import.calendarRollback', result.reason, { calendarEventId: importedCalendarEventIds[index] });
    });
  }
}
