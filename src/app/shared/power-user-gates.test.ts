import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('Power User mutation perimeter', () => {
  it('blocks Event publish/edit plus cancel/delete handlers before mutation work', () => {
    const editor = read('features/calendar/organizer-event-create.component.ts');
    const list = read('features/calendar/organizer-event-list.component.ts');

    expect(editor).toMatch(/async publish\(\)[\s\S]*?if \(!this\.canMutateEvent\(\)\) return;/);
    expect(editor).toMatch(/async saveEdit\(\)[\s\S]*?if \(!this\.canMutateEvent\(\)\) return;/);
    expect(list).toMatch(/async cancel\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
    expect(list).toMatch(/async delete\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
  });

  it('blocks shell imports and destructive Archive handlers before dialogs or adapters', () => {
    const shell = read('app.component.ts');

    expect(shell).toMatch(/openImportPicker\(\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
    expect(shell).toMatch(/async importLeague\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
    expect(shell).toMatch(/async deleteLeague\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
    expect(shell).toMatch(/async deleteTournament\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
  });

  it('keeps Archive reads and exports outside Power gates', () => {
    const repository = read('data/league-archive-repository.service.ts');
    const shell = read('app.component.ts');

    expect(repository.match(/power\.requireEnabled\(\)/g)).toHaveLength(1);
    expect(repository).toMatch(/private async freshMutation[\s\S]*?this\.power\.requireEnabled\(\)/);
    expect(repository).not.toMatch(/async listLeagues\(\)[\s\S]{0,120}requireEnabled/);
    expect(repository).not.toMatch(/async getLeague\([^)]*\)[\s\S]{0,120}requireEnabled/);
    expect(shell).not.toMatch(/downloadFullExport\(\)[\s\S]{0,120}power\.enabled/);
    expect(shell).not.toMatch(/downloadLeagueExport\([^)]*\)[\s\S]{0,120}power\.enabled/);
  });

  it('keeps Calendar registration handlers independent from Power mode', () => {
    const calendar = read('features/calendar/public-calendar.component.ts');
    const registrationSlice = calendar.slice(calendar.indexOf('async registerFromCard'), calendar.indexOf('async refreshVisibleCapabilities'));

    expect(registrationSlice).not.toContain('power');
  });

  it('blocks Settings player rename handlers while preserving Settings access', () => {
    const settings = read('features/settings/settings.component.ts');

    expect(settings).toMatch(/async saveServerPlayerEdit\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
    expect(settings).toMatch(/async saveLocalPlayerEdit\([^)]*\)[\s\S]*?if \(!this\.power\.enabled\(\)\) return;/);
    expect(settings).toContain('data-cy="settings-power-user-card"');
  });
});
