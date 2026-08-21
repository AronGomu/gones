import { globSync } from 'glob';
import { readFileSync } from 'fs';
import { join } from 'path';

const eventsDir = join(import.meta.dirname, '.');
const srcDir = join(import.meta.dirname, '../..');

function readSourceFiles(dir: string, pattern: string): string[] {
  return globSync(pattern, { cwd: dir, absolute: true })
    .filter((f) => !f.endsWith('.test.ts'))
    .map((f) => readFileSync(f, 'utf8'));
}

describe('event identifiers', () => {
  it('no calendar test ids in events feature', () => {
    const contents = readSourceFiles(eventsDir, '**/*.ts');
    for (const content of contents) {
      expect(content).not.toMatch(/data-cy="calendar-/);
    }
  });

  it('no legacy storage keys anywhere in src', () => {
    const contents = readSourceFiles(srcDir, '**/*.ts');
    for (const content of contents) {
      expect(content).not.toMatch(/gones\.calendar-v1/);
    }
  });
});
