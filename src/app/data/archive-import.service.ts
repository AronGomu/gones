import { Injectable } from '@angular/core';
import type { ArchiveBundle } from '../domain/archive-models';
import {
  ARCHIVE_EXPORT_LIMITS,
  parseArchiveBundle,
  verifyArchiveChecksum
} from '../domain/archive-export-schemas';

export interface ArchiveImportResult {
  bundle: ArchiveBundle;
  leagueCount: number;
  leagueSeasonCount: number;
  tournamentCount: number;
  calendarEventCount: number;
}

/**
 * The v5 import gate. It parses, verifies and validates, and it writes nothing: it injects no
 * store, so it cannot pick a destination. `ArchiveRepository` persists the returned bundle.
 *
 * A v1–v4 Gones Export is refused with `legacyArchiveBundleVersion`. ADR 0022 froze the old wire
 * names to keep that import door open; this closes it on purpose. There is no converter.
 */
@Injectable({ providedIn: 'root' })
export class ArchiveImportService {
  async readBundle(file: File): Promise<ArchiveImportResult> {
    if (file.size > ARCHIVE_EXPORT_LIMITS.maxImportFileBytes) throw new Error('gonesImportFileTooLarge');

    const parsed: unknown = JSON.parse(await file.text());
    // A checksum mismatch rejects the file before any caller can persist it.
    if (!(await verifyArchiveChecksum(parsed))) throw new Error('gonesExportChecksumMismatch');

    const bundle = parseArchiveBundle(parsed);
    return {
      bundle,
      leagueCount: bundle.leagues.length,
      leagueSeasonCount: bundle.leagueSeasons.length,
      tournamentCount: bundle.tournaments.length,
      calendarEventCount: bundle.calendarEvents.length
    };
  }
}
