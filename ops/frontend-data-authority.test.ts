import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DataAuthorityConfigurationError, resolveDataAuthority } from '../src/app/config/data-authority';
// @ts-expect-error - plain ESM build script consumed by the parity assertions below.
import { dataAuthorityFailureCode, readEnvironmentDeclaration } from '../scripts/check-frontend-data-authority.mjs';

/**
 * C42 parity gate.
 *
 * The build-time checker (`scripts/check-frontend-data-authority.mjs`) and the runtime resolver
 * (`src/app/config/data-authority.ts`) must agree on every declaration, or an image could build
 * clean and then refuse to boot — or worse, boot with an authority nobody declared.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const declarations = [
  { dataMode: 'legacy-browser', apiBaseUrl: '', features: { authV1: false, adminV1: false } },
  { dataMode: 'legacy-browser', apiBaseUrl: 'http://127.0.0.1:5080', features: { authV1: false, adminV1: false } },
  { dataMode: 'legacy-browser', apiBaseUrl: '', features: { authV1: true, adminV1: false } },
  { dataMode: 'legacy-browser', apiBaseUrl: '', features: { authV1: false, adminV1: true } },
  { dataMode: 'server', apiBaseUrl: 'http://127.0.0.1:5080', features: { authV1: true, adminV1: true } },
  { dataMode: 'server', apiBaseUrl: 'https://api.example/', features: { authV1: false, adminV1: false } },
  { dataMode: 'server', apiBaseUrl: '', features: { authV1: true, adminV1: false } },
  { dataMode: 'server', apiBaseUrl: 'https://api.example', features: { authV1: false, adminV1: true } },
  { dataMode: '', apiBaseUrl: '', features: { authV1: false, adminV1: false } },
  { dataMode: 'auto', apiBaseUrl: 'https://api.example', features: { authV1: false, adminV1: false } }
];

function runtimeFailureCode(declaration: (typeof declarations)[number]): string | null {
  try {
    resolveDataAuthority(declaration);
    return null;
  } catch (error) {
    return (error as DataAuthorityConfigurationError).code;
  }
}

describe('build-time and runtime data-authority rules', () => {
  it.each(declarations)('agrees on %j', (declaration) => {
    expect(dataAuthorityFailureCode(declaration)).toBe(runtimeFailureCode(declaration));
  });

  it('covers every failure code the runtime resolver can raise', () => {
    const codes = new Set(declarations.map(runtimeFailureCode));

    for (const code of [
      'dataModeUnknown',
      'serverModeApiBaseUrlMissing',
      'serverModeAdminRequiresAuth',
      'legacyModeApiBaseUrlForbidden',
      'legacyModeCapabilityForbidden'
    ]) {
      expect(codes).toContain(code);
    }
  });
});

describe('checked environment files', () => {
  it.each(['src/environments/environment.ts', 'src/environments/environment.prod.ts'])('parses %s', (file) => {
    const declaration = readEnvironmentDeclaration(readFileSync(join(root, file), 'utf8'));

    expect(declaration).not.toBeNull();
    expect(dataAuthorityFailureCode(declaration)).toBeNull();
    // The repository ships the frozen legacy static build; container builds substitute the values.
    expect(declaration.dataMode).toBe('legacy-browser');
  });

  it('runs the checker in every image build stage that substitutes the environment', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    const substitutions = dockerfile.match(/GONES_FRONTEND_DATA_MODE\}/g) ?? [];
    const checks = dockerfile.match(/check-frontend-data-authority\.mjs/g) ?? [];

    expect(substitutions.length).toBeGreaterThan(0);
    expect(checks.length).toBe(substitutions.length);
  });
});
