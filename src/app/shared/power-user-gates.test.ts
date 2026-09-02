import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('Power User mutation perimeter', () => {
  it('blocks Event publish/edit plus cancel/delete handlers before mutation work', () => {
    const editor = read('features/events/organizer-event-create.component.ts');
    const list = read('features/events/organizer-event-list.component.ts');

    expect(editor).toMatch(/async publish\(\)[\s\S]*?if \(!this\.canMutateEvent\(\)\) return;/);
    expect(editor).toMatch(/async saveEdit\(\)[\s\S]*?if \(!this\.canMutateEvent\(\)\) return;/);
    expect(list).toMatch(/async cancel\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
    expect(list).toMatch(/async delete\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
  });

  it('blocks shell imports and destructive Archive handlers before dialogs or adapters', () => {
    const shell = read('app.component.ts');

    expect(shell).toMatch(/openImportPicker\(\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
    expect(shell).toMatch(/async importLeague\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
    // T19 retired the shell's two destructive handlers with the legacy pages: the three-tier archive
    // exposes no delete, so the gates that used to guard them have nothing left to guard.
    expect(shell).not.toContain('async deleteLeague(');
    expect(shell).not.toContain('async deleteTournament(');
  });

  it('keeps Archive reads and exports outside Power gates', () => {
    const repository = read('data/archive-repository.service.ts');
    const shell = read('app.component.ts');

    // Both writes carry the gate; every catalog read is ungated so an anonymous visitor can browse.
    expect(repository.match(/power\.requireEnabled\(\)/g)).toHaveLength(2);
    expect(repository).toMatch(/saveTournamentEdits[\s\S]*?this\.power\.requireEnabled\(\)/);
    expect(repository).toMatch(/restoreBundle[\s\S]*?this\.power\.requireEnabled\(\)/);
    expect(repository).not.toMatch(/listLeagues\([^)]*\)[\s\S]{0,120}requireEnabled/);
    expect(repository).not.toMatch(/async getTournament\([^)]*\)[\s\S]{0,120}requireEnabled/);
    expect(repository).not.toMatch(/async exportBundle\(\)[\s\S]{0,120}requireEnabled/);
    expect(shell).not.toMatch(/downloadFullExport\(\)[\s\S]{0,120}power\.enabled/);
  });

  it('keeps Calendar registration handlers independent from Power mode', () => {
    const calendar = read('features/events/public-event-list.component.ts');
    const registrationSlice = calendar.slice(calendar.indexOf('async registerFromCard'), calendar.indexOf('async refreshVisibleCapabilities'));

    expect(registrationSlice).not.toContain('power');
  });

  it('blocks Settings player rename handlers while preserving Settings access', () => {
    const settings = read('features/settings/settings.component.ts');

    expect(settings).toMatch(/async saveServerPlayerEdit\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
    expect(settings).toMatch(/async saveLocalPlayerEdit\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
    expect(settings).toContain('@if (!power.forced())');
    expect(settings).toContain('data-cy="settings-power-user-card"');
  });
});
