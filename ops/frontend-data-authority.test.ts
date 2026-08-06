import { spawnSync } from 'node:child_process';
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
 * The build-time checker (`scripts/check-frontend-data-authority.mjs`), the container-start gate
 * (`deploy/nginx/gones-data-authority.sh`, C44) and the runtime resolver
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

/** The container-start gate, run exactly as `/docker-entrypoint.d/40-gones-runtime.sh` runs it. */
function containerFailureCode(declaration: (typeof declarations)[number]): string | null {
  const result = spawnSync('sh', [join(root, 'deploy/nginx/gones-data-authority.sh')], {
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'],
      GONES_DATA_MODE: declaration.dataMode,
      GONES_API_BASE_URL: declaration.apiBaseUrl,
      GONES_AUTH_V1: String(declaration.features.authV1),
      GONES_ADMIN_V1: String(declaration.features.adminV1)
    }
  });
  if (result.status === 0) return null;
  expect(result.status).toBe(2);
  return result.stdout.trim();
}

describe('build-time and runtime data-authority rules', () => {
  it.each(declarations)('agrees on %j', (declaration) => {
    expect(dataAuthorityFailureCode(declaration)).toBe(runtimeFailureCode(declaration));
  });

  it.each(declarations)('the container-start gate agrees on %j', (declaration) => {
    expect(containerFailureCode(declaration)).toBe(runtimeFailureCode(declaration));
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
    const substitutions = dockerfile.match(/sed -i "s\/dataMode: 'legacy-browser'/g) ?? [];
    const checks = dockerfile.match(/check-frontend-data-authority\.mjs/g) ?? [];

    expect(substitutions.length).toBeGreaterThan(0);
    expect(checks.length).toBe(substitutions.length);
  });
});

/**
 * C44 — the release artifact must not be bound to one origin. The image carries the build values
 * only as defaults; the server block and the declaration the browser reads are rendered at container
 * start into a tmpfs, because the root filesystem is read-only.
 */
describe('runtime configuration injection', () => {
  const dockerfile = (): string => readFileSync(join(root, 'Dockerfile'), 'utf8');

  it('renders the served configuration at container start, not at build time', () => {
    expect(dockerfile()).toContain('COPY --chmod=0755 deploy/nginx/gones-runtime-entrypoint.sh /docker-entrypoint.d/40-gones-runtime.sh');
    expect(dockerfile()).toContain('deploy/nginx/default.conf.template /etc/nginx/gones/default.conf.template');
    // The old build-time substitution of the API origin into the server block must be gone.
    expect(dockerfile()).not.toContain('__GONES_API_ORIGIN__');
  });

  it('turns the build arguments into runtime defaults every host can override', () => {
    for (const variable of ['GONES_DATA_MODE=', 'GONES_API_BASE_URL=', 'GONES_AUTH_V1=', 'GONES_ADMIN_V1=']) {
      expect(dockerfile()).toContain(variable);
    }
  });

  it('writes everything it renders inside a tmpfs, so the root filesystem stays read-only', () => {
    const entrypoint = readFileSync(join(root, 'deploy/nginx/gones-runtime-entrypoint.sh'), 'utf8');
    const written = [...entrypoint.matchAll(/> (\/\S+)/g)].map((match) => match[1]);

    expect(written.length).toBeGreaterThan(0);
    for (const path of written) expect(path.startsWith('/tmp/')).toBe(true);
    expect(entrypoint).toContain('/etc/nginx/gones/gones-data-authority.sh');
  });

  it('serves the declaration the application reads before it bootstraps', () => {
    const template = readFileSync(join(root, 'deploy/nginx/default.conf.template'), 'utf8');
    const main = readFileSync(join(root, 'src/main.ts'), 'utf8');

    expect(template).toContain('location = /runtime-config.json');
    expect(template).toContain('${GONES_API_ORIGIN}');
    expect(main).toContain("new URL('runtime-config.json', document.baseURI)");
  });
});
