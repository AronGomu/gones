import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const EXEMPT_TAGS = [
  'ng-container',
  'ng-template',
  'ng-content',
  'svg',
  'path',
  'defs',
  'g',
  'use',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'br',
  'hr'
];

const repoRoot = join(__dirname, '..', '..', '..');
const appRoot = join(repoRoot, 'src', 'app');

function templateBlocks(source: string): string[] {
  const blocks: string[] = [];
  const pattern = /template:\s*`([\s\S]*?)`\s*\n\s*\}\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

// Fixtures used directly against these helpers (see Test plan) are raw HTML
// fragments with no `template:` wrapper. Fall back to treating the whole
// input as a single block when no wrapper is found, so both a full
// component source file and a bare HTML fragment work as input.
function blocksOf(source: string): string[] {
  const blocks = templateBlocks(source);
  return blocks.length > 0 ? blocks : [source];
}

export function findMissingDataCy(source: string): string[] {
  const missing: string[] = [];
  for (const block of blocksOf(source)) {
    const tagPattern = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(block)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (EXEMPT_TAGS.includes(tag)) {
        continue;
      }
      if (!/\sdata-cy\s*=/.test(attrs) && !/\[attr\.data-cy\]\s*=/.test(attrs)) {
        missing.push(tag);
      }
    }
  }
  return missing;
}

export function findDuplicateDataCy(source: string): string[] {
  const seen = new Map<string, number>();
  for (const block of blocksOf(source)) {
    const pattern = /\sdata-cy="([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(block)) !== null) {
      const value = match[1];
      seen.set(value, (seen.get(value) ?? 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function componentSourceFiles(): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) {
        continue;
      }
      const source = readFileSync(full, 'utf8');
      if (/template:\s*`/.test(source)) {
        files.push(full);
      }
    }
  }

  walk(appRoot);
  return files;
}

function toRepoRelative(path: string): string {
  return path.slice(repoRoot.length + 1).split('\\').join('/');
}

export const PENDING_DATA_CY_RETROFIT: string[] = [
  'src/app/features/admin/admin-audit.component.ts',
  'src/app/features/admin/admin-home.component.ts',
  'src/app/features/admin/admin-notification-delivery.component.ts',
  'src/app/features/admin/admin-organizations.component.ts',
  'src/app/features/admin/admin-users.component.ts',
  'src/app/features/admin/organization-detail.component.ts',
  'src/app/features/admin/organization-list.component.ts',
  'src/app/features/admin/organizer-organizations.component.ts',
  'src/app/features/calendar/admin-deleted-tournaments.component.ts',
  'src/app/features/calendar/my-registrations.component.ts',
  'src/app/features/calendar/organizer-participants.component.ts',
  'src/app/features/calendar/organizer-tournament-create.component.ts',
  'src/app/features/calendar/organizer-tournament-list.component.ts',
  'src/app/features/calendar/public-calendar.component.ts',
  'src/app/features/calendar/public-tournament-detail.component.ts',
  'src/app/features/calendar/server-sanitized-html.component.ts',
  'src/app/features/calendar/tournament-detail-view.component.ts',
  'src/app/features/leagues/league-detail.component.ts',
  'src/app/features/leagues/league-list.component.ts',
  'src/app/features/live-tournaments/live-tournament-list.component.ts',
  'src/app/features/live-tournaments/live-tournament-runner.component.ts',
  'src/app/features/menu/about.component.ts',
  'src/app/features/players/player-detail.component.ts',
  'src/app/features/tournaments/tournament-detail.component.ts',
  'src/app/features/tournaments/tournament-result.component.ts',
  'src/app/shared/back-button.component.ts',
  'src/app/shared/deck-archetype-input.component.ts',
  'src/app/shared/dialogs.ts',
  'src/app/shared/not-found.component.ts',
  'src/app/shared/ranking-table.component.ts',
  'src/app/shared/route-error-boundary.ts'
];

describe('data-cy coverage helpers', () => {
  it('rejects an element without data-cy', () => {
    expect(findMissingDataCy('<div><button>x</button></div>')).toEqual(['div', 'button']);
  });

  it('accepts data-cy and [attr.data-cy]', () => {
    expect(
      findMissingDataCy('<div data-cy="a"><button [attr.data-cy]="b">x</button></div>')
    ).toEqual([]);
  });

  it('ignores structural and svg tags', () => {
    expect(
      findMissingDataCy('<ng-container><ng-template><svg><path d="M0"/></svg></ng-template></ng-container>')
    ).toEqual([]);
  });

  it('rejects duplicate static data-cy in one file', () => {
    expect(findDuplicateDataCy('<a data-cy="x"></a><b data-cy="x"></b>')).toEqual(['x']);
  });
});

describe('data-cy coverage gate', () => {
  it('every non-allowlisted template tags every element with data-cy', () => {
    const violations: string[] = [];

    for (const file of componentSourceFiles()) {
      const relative = toRepoRelative(file);
      if (PENDING_DATA_CY_RETROFIT.includes(relative)) {
        continue;
      }
      const source = readFileSync(file, 'utf8');
      const missing = findMissingDataCy(source);
      const duplicates = findDuplicateDataCy(source);
      if (missing.length > 0) {
        violations.push(`${relative}: missing data-cy on <${missing.join('>, <')}>`);
      }
      if (duplicates.length > 0) {
        violations.push(`${relative}: duplicate data-cy values ${duplicates.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('allowlist holds only files that still exist', () => {
    for (const entry of PENDING_DATA_CY_RETROFIT) {
      expect(existsSync(join(repoRoot, entry))).toBe(true);
    }
  });
});
