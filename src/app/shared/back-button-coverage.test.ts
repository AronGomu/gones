import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');
const routesSource = readFileSync(join(repoRoot, 'src', 'app', 'app.routes.ts'), 'utf-8');

const AUTH_COMPONENT = 'auth/auth-entry.component';
const ABOUT_COMPONENT = 'features/menu/about.component';

/**
 * Pages that *start* their breadcrumb — `buildBreadcrumbs` returns a single item — carry no back
 * button: the breadcrumb offers nothing to go back to (ADR 0044). Kept in sync with
 * `app-breadcrumbs.test.ts`, which pins that these are the only two.
 */
const BREADCRUMB_ROOT_COMPONENTS = [
  'features/menu/home-menu.component',
  'features/admin/admin-home.component'
];

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

  it('breadcrumb-root pages carry no back button', () => {
    for (const path of BREADCRUMB_ROOT_COMPONENTS) {
      const source = readComponentSource(path);
      expect(source, `${path} should not contain gones-back-button`).not.toContain('gones-back-button');
    }
  });

  it('every routed page except About has a top back button', () => {
    const nonRootPaths = routedPaths.filter((p) => !BREADCRUMB_ROOT_COMPONENTS.includes(p) && p !== ABOUT_COMPONENT);
    const missing: string[] = [];
    for (const path of nonRootPaths) {
      const source = readComponentSource(path);
      if (!source.includes('position="top"')) {
        missing.push(path);
      }
    }
    expect(missing, `Missing position="top": ${missing.join(', ')}`).toEqual([]);
  });

  it('every routed page (except auth and breadcrumb roots) has a bottom back button', () => {
    const nonAuthNonRootPaths = routedPaths.filter((p) => p !== AUTH_COMPONENT && !BREADCRUMB_ROOT_COMPONENTS.includes(p));
    const missing: string[] = [];
    for (const path of nonAuthNonRootPaths) {
      const source = readComponentSource(path);
      if (!source.includes('position="bottom"')) {
        missing.push(path);
      }
    }
    expect(missing, `Missing position="bottom": ${missing.join(', ')}`).toEqual([]);
  });

  it('About keeps bottom back navigation only', () => {
    const source = readComponentSource(ABOUT_COMPONENT);
    expect(source).not.toContain('position="top"');
    expect(source).toContain('position="bottom"');
  });

  it('auth pages stay top only', () => {
    const source = readComponentSource(AUTH_COMPONENT);
    expect(source).toContain('position="top"');
    expect(source).not.toContain('position="bottom"');
  });
});
