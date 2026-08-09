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

// A template literal ends at its own first unescaped backtick — nothing else. An earlier form of
// this pattern also demanded a `})` right after the closing backtick, which silently matched
// *nothing* in a component that declares `styles:` after `template:` (only
// `player-detail.component.ts` does today). With no block found, `blocksOf` fell back to scanning
// the whole file, so TypeScript generics such as `Map<PersistedLeague>` were reported as untagged
// elements. Terminating on the backtick keeps the scan inside the markup.
function templateBlocks(source: string): string[] {
  const blocks: string[] = [];
  const pattern = /template:\s*`((?:[^`\\]|\\[\s\S])*)`/g;
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

/**
 * Static `data-cy="..."` values must be unique inside a file. Only the *static* form is counted,
 * and that is deliberate: `[attr.data-cy]="'some-id'"` is this repo's documented escape hatch for
 * an identifier that is rendered more than once **on purpose**, and Cypress cannot tell the two
 * forms apart because Angular emits the same attribute either way.
 *
 * The rule was reviewed in T25 and kept as-is rather than teaching this scan about Angular control
 * flow, because branch-awareness would not actually cover the cases that need covering:
 *
 * - Mutually exclusive branches — `auth-entry.component.ts` renders `auth-email` / `auth-password`
 *   / `auth-submit` from either the login or the register arm, `player-detail.component.ts`
 *   renders `stat-nemesis` / `stat-rival` from either a filter button or an "n/a" span, and
 *   `organizer-participants.component.ts` renders `participant-error` from either the load-failure
 *   arm or the action-failure arm of the same page. A branch parser would handle these.
 * - Simultaneously rendered duplicates — `organizer-participants.component.ts` renders the desktop
 *   `<table>` and the mobile card list at the same time and hides one with CSS, so
 *   `participant-remove` / `participant-block` / `participant-remove-block` are genuinely in the
 *   DOM twice. `organizer-participants.cy.js` relies on exactly that and disambiguates with
 *   `:visible`. A branch parser would still flag these, correctly by its own rule and wrongly by
 *   intent.
 *
 * One marker therefore covers both, while a control-flow parser covers only half — and this suite
 * has no Angular compiler to borrow (no `TestBed`, no zone.js); every template claim here is made
 * by reading source text. So: the binding form is the marker. Reach for it only when the repeat is
 * intentional, and leave a reason at the call site.
 *
 * T27 removed the one use that was not intentional: `organizer-tournament-create.component.ts` wore
 * the hatch on a second `reload-organizations` button whose click handler was a *different* method,
 * so the marker was silencing an ambiguity rather than recording a deliberate repeat. That button is
 * now `tournament-publish-error-reload`. Two elements that do different things never share a name.
 */
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

/**
 * Empty since T25: every component template in `src/app/**` tags every element it renders.
 * Re-adding a path here is a regression, not a workflow — fix the template instead.
 */
export const PENDING_DATA_CY_RETROFIT: string[] = [];

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

  it('treats the binding form as the deliberate-duplicate escape hatch', () => {
    expect(findDuplicateDataCy(`<a data-cy="x"></a><b [attr.data-cy]="'x'"></b>`)).toEqual([]);
  });

  it('stops scanning at the end of the template literal, not the end of the file', () => {
    // A component that declares `styles:` after `template:` used to match no template block at
    // all, so the whole source — TypeScript included — was scanned and generics such as
    // `Map<PersistedLeague>` were reported as untagged elements.
    const source = [
      '@Component({',
      '  template: `<div data-cy="a"></div>`,',
      '  styles: [`.x { color: red; }`]',
      '})',
      'export class C { m(): Map<PersistedLeague> { return new Map<PersistedLeague>(); } }'
    ].join('\n');
    expect(findMissingDataCy(source)).toEqual([]);
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
