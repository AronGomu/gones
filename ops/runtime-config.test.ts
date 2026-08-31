import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

describe('event editor provider runtime contract', () => {
  it('pins renderer and media dependencies exactly', () => {
    const packageJson = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    const packageLock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
    };
    const centralPackages = read('backend/Directory.Packages.props');

    expect(packageJson.dependencies['marked']).toBe('18.0.11');
    expect(packageLock.packages[''].dependencies?.['marked']).toBe('18.0.11');
    expect(packageLock.packages['node_modules/marked'].version).toBe('18.0.11');
    for (const [name, version] of [
      ['Markdig', '1.3.2'],
      ['SixLabors.ImageSharp', '4.1.1'],
      ['AWSSDK.S3', '4.0.102.4']
    ]) {
      expect(centralPackages).toContain(`<PackageVersion Include="${name}" Version="${version}" />`);
    }
  });

  it('documents every provider key and user-owned setup action', () => {
    const example = read('.env.example');
    const guide = read('docs/EVENT_EDITOR_PROVIDERS.md');
    const keys = [
      'GONES_GOOGLE_MAPS_API_KEY',
      'GONES_GOOGLE_MAPS_API_KEY_FILE',
      'GONES_EVENT_IMAGES_S3_ENDPOINT',
      'GONES_EVENT_IMAGES_S3_BUCKET',
      'GONES_EVENT_IMAGES_S3_REGION',
      'GONES_EVENT_IMAGES_S3_ACCESS_KEY_FILE',
      'GONES_EVENT_IMAGES_S3_SECRET_KEY_FILE'
    ];

    for (const key of keys) {
      expect(example).toContain(`${key}=`);
      expect(guide).toContain(key);
    }
    for (const action of [
      'Places API',
      'Place Details API',
      'Time Zone API',
      'billing',
      'server key',
      'deployment egress',
      'private S3'
    ]) {
      expect(guide.toLowerCase()).toContain(action.toLowerCase());
    }
  });
});
