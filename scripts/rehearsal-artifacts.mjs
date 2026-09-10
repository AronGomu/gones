import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_IMAGES } from './release-images.mjs';

/** Read the canonical local candidate image IDs before any rehearsal can mutate Compose state. */
export function readRehearsalArtifactEnvironment(root = process.cwd()) {
  const manifestPath = join(root, 'reports', 'images', 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error(`Release artifact reuse refused: cannot read valid JSON from ${manifestPath}`);
  }
  if (!Array.isArray(manifest?.images)) {
    throw new Error('Release artifact reuse refused: manifest.images must be an array');
  }
  return Object.fromEntries(RELEASE_IMAGES.map(({ name }) => {
    const entries = manifest.images.filter((image) => image?.name === name);
    if (entries.length !== 1 || typeof entries[0].digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(entries[0].digest)) {
      throw new Error(`Release artifact reuse refused: ${name} must have exactly one immutable sha256 digest`);
    }
    return [`GONES_IMAGE_${name.toUpperCase()}`, entries[0].digest];
  }));
}
