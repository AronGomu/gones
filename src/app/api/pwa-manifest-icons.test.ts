import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height straight from the PNG IHDR header, in pixels. */
function pngDimensions(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`not a PNG: ${path}`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const manifest = JSON.parse(readFileSync('src/manifest.webmanifest', 'utf8')) as { icons: ManifestIcon[] };
const icons = manifest.icons.map((icon) => ({ icon, real: pngDimensions(`src/${icon.src}`) }));

describe('pwa manifest icons', () => {
  it("every icon's declared sizes match the raster's real dimensions", () => {
    for (const { icon, real } of icons) {
      expect(icon.sizes, icon.src).toBe(`${real.width}x${real.height}`);
    }
  });

  it('non-square icons do not claim the maskable purpose', () => {
    for (const { icon, real } of icons) {
      if (real.width !== real.height) {
        expect(icon.purpose ?? '', icon.src).not.toMatch(/\bmaskable\b/);
      }
    }
  });

  it('icon rasters are valid PNGs', () => {
    for (const { real } of icons) {
      expect(real.width).toBeGreaterThan(0);
      expect(real.height).toBeGreaterThan(0);
    }
  });
});
