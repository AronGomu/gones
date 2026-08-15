import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');
const routesSource = readFileSync(join(repoRoot, 'src', 'app', 'app.routes.ts'), 'utf-8');

const AUTH_COMPONENT = 'auth/auth-entry.component';

function parseRoutedComponents(): string[] {
  const pattern = /loadComponent:\s*\(\)\s*=>\s*import\('\.\/([^']+)'\)/g;
  const paths = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(routesSource)) !== null) {
    paths.add(match[1]);
  }
  return Array.from(paths);
}

function readComponentSource(relativePath: string): string {
  const fullPath = resolve(repoRoot, 'src', 'app', relativePath + '.ts');
  return readFileSync(fullPath, 'utf-8');
}

const routedPaths = parseRoutedComponents();

describe('back-button-coverage', () => {
  it('finds a non-trivial route list', () => {
    expect(routedPaths.length).toBeGreaterThanOrEqual(25);
  });

  it('every routed page has a top back button', () => {
    const missing: string[] = [];
    for (const path of routedPaths) {
      const source = readComponentSource(path);
      if (!source.includes('position="top"')) {
        missing.push(path);
      }
    }
    expect(missing, `Missing position="top": ${missing.join(', ')}`).toEqual([]);
  });

  it('every routed page (except auth) has a bottom back button', () => {
    const nonAuthPaths = routedPaths.filter((p) => p !== AUTH_COMPONENT);
    const missing: string[] = [];
    for (const path of nonAuthPaths) {
      const source = readComponentSource(path);
      if (!source.includes('position="bottom"')) {
        missing.push(path);
      }
    }
    expect(missing, `Missing position="bottom": ${missing.join(', ')}`).toEqual([]);
  });

  it('auth pages stay top only', () => {
    const source = readComponentSource(AUTH_COMPONENT);
    expect(source).toContain('position="top"');
    expect(source).not.toContain('position="bottom"');
  });
});
