import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ADR 0032 gives a viewer with no server-backed catalog the browser-local one instead. These are
 * source assertions — this repo has no TestBed — so each one pins the guard the section lives in
 * and the fact that no local path ever reaches the API client.
 */
const source = readFileSync(join(__dirname, 'settings.component.ts'), 'utf8');

/** The source slice a block owns, from its opening `{` to the `}` that balances it. */
function templateBlock(opening: string): string {
  const start = source.indexOf(opening);
  expect(start, `template block "${opening}"`).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = start + opening.length - 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unbalanced template block "${opening}"`);
}

describe('settings page local sections', () => {
  it('renders both local sections behind their flags', () => {
    expect(templateBlock('@if (capabilities().localCatalog) {')).toContain('data-cy="settings-local-archetype-card"');
    expect(templateBlock('@if (capabilities().localMaintenance) {')).toContain('data-cy="settings-local-players-card"');
  });

  it('never calls the API client from a local path', () => {
    const slices = [
      templateBlock('@if (capabilities().localCatalog) {'),
      templateBlock('@if (capabilities().localMaintenance) {'),
      templateBlock('async addLocalArchetype(): Promise<void> {'),
      templateBlock('async saveLocalArchetypeEdit(archetype: string): Promise<void> {'),
      templateBlock('async removeLocalArchetype(archetype: string): Promise<void> {'),
      templateBlock('async loadLocalPlayers(): Promise<void> {'),
      templateBlock('async saveLocalPlayerEdit(player: LocalPlayerSummary): Promise<void> {')
    ];

    for (const slice of slices) expect(slice).not.toContain('this.client.');
  });
});
