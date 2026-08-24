import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ArchiveImportService } from './archive-import.service';
import {
  ARCHIVE_EXPORT_LIMITS,
  attachArchiveChecksum,
  buildArchiveBundle,
  parseArchiveBundle
} from '../domain/archive-export-schemas';
import { catalogs } from '../i18n/messages';

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/archive-export/v5');

/** `readBundle` only reads `size` and `text()`; jsdom's `File` is not needed to exercise it. */
function textFile(text: string): File {
  return { size: text.length, text: async () => text } as unknown as File;
}

function fixtureFile(name: string): File {
  return textFile(readFileSync(resolve(fixtureDirectory, name), 'utf8'));
}

function fixtureArtifact(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, 'bundle.json'), 'utf8'));
}

describe('ArchiveImportService v5 gate', () => {
  const service = new ArchiveImportService();

  it('reads the golden v5 fixture and reports its four collection counts', async () => {
    const result = await service.readBundle(fixtureFile('bundle.json'));

    expect(result.leagueCount).toBe(2);
    expect(result.leagueSeasonCount).toBe(3);
    expect(result.tournamentCount).toBe(4);
    expect(result.calendarEventCount).toBe(1);
  });

  it('preserves ids, standalone seasonId null and round contents', async () => {
    const text = readFileSync(resolve(fixtureDirectory, 'bundle.json'), 'utf8');
    const result = await service.readBundle(textFile(text));

    expect(result.bundle).toEqual(parseArchiveBundle(JSON.parse(text)));
    expect(result.bundle.tournaments.map((tournament) => tournament.id)).toEqual(['tournament-1', 'tournament-2', 'tournament-3', 'tournament-4']);
    expect(result.bundle.tournaments[3].seasonId).toBeNull();
    expect(result.bundle.tournaments[0].rounds[0].entries).toHaveLength(2);
  });

  it('round-trips an exported bundle back through the import gate', async () => {
    const exported = buildArchiveBundle({
      leagues: [{ id: 'league-a', name: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z' }],
      leagueSeasons: [{ id: 'season-a', name: 'Alpha 2026', leagueId: 'league-a', status: 'active' }],
      tournaments: [
        { id: 'tour-a', name: 'Alpha Cup', seasonId: 'season-a', tournamentDate: '2026-02-02', status: 'active', rounds: [], playerArchetypes: [] },
        { id: 'tour-b', name: 'Loner Cup', seasonId: null, tournamentDate: '2026-03-03', status: 'completed', rounds: [], playerArchetypes: [] }
      ]
    });
    const artifactJson = JSON.stringify(await attachArchiveChecksum(exported));

    const result = await service.readBundle(textFile(artifactJson));

    expect(result.bundle).toEqual(exported);
    // Byte-level: re-exporting what came back reproduces the artifact exactly, checksum included.
    expect(JSON.stringify(await attachArchiveChecksum(result.bundle))).toBe(artifactJson);
  });

  it('refuses the golden legacy v1 fixture', async () => {
    await expect(service.readBundle(fixtureFile('legacy-v1.json'))).rejects.toThrow('legacyArchiveBundleVersion');
  });

  it('refuses the golden legacy v4 fixture', async () => {
    await expect(service.readBundle(fixtureFile('legacy-v4.json'))).rejects.toThrow('legacyArchiveBundleVersion');
  });

  it('refuses a file over the byte cap before parsing it', async () => {
    const text = vi.fn();
    const file = { size: ARCHIVE_EXPORT_LIMITS.maxImportFileBytes + 1, text } as unknown as File;

    await expect(service.readBundle(file)).rejects.toThrow('gonesImportFileTooLarge');
    expect(text).not.toHaveBeenCalled();
  });

  it('propagates a SyntaxError for a non-JSON file', async () => {
    await expect(service.readBundle(textFile('not json'))).rejects.toBeInstanceOf(SyntaxError);
  });

  it('refuses a tampered checksum', async () => {
    const artifact = fixtureArtifact();
    (artifact['leagues'] as Record<string, unknown>[])[0]['name'] = 'Tampered';

    await expect(service.readBundle(textFile(JSON.stringify(artifact)))).rejects.toThrow('gonesExportChecksumMismatch');
  });

  it('accepts an artifact that carries no checksum', async () => {
    const artifact = fixtureArtifact();
    delete artifact['checksum'];

    expect((await service.readBundle(textFile(JSON.stringify(artifact)))).leagueCount).toBe(2);
  });

  it('carries the legacy refusal message in English and in French', () => {
    const english = catalogs.en['msg.importLegacyBundleUnsupported'];
    const french = catalogs.fr['msg.importLegacyBundleUnsupported'];

    expect(english.length).toBeGreaterThan(0);
    expect(french.length).toBeGreaterThan(0);
    expect(english).not.toBe(french);
    expect(english).toContain('5');
    expect(french).toContain('5');
  });
});
