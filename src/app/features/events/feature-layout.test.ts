import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = join(__dirname, '..', '..', '..', '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('feature-layout', () => {
  it('has no calendar feature directory', () => {
    expect(existsSync(join(srcRoot, 'app/features/calendar'))).toBe(false);
    expect(existsSync(join(srcRoot, 'app/features/events/public-event-list.component.ts'))).toBe(true);
  });

  it('no source imports the old path', () => {
    const hits = sourceFiles(srcRoot).filter(file =>
      readFileSync(file, 'utf8').includes('features/calendar')
    );
    expect(hits).toEqual([]);
  });
});
