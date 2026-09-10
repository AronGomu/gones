import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error JavaScript operations module has no declaration file.
import { assertStagingProject, MAX_WINDOW_MINUTES, parseMinutes, projectMonthlyBudget, STAGING_PROJECT } from '../scripts/staging-operations.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'scripts/staging-operations.mjs'), 'utf8');
const operations = readFileSync(join(root, 'docs/STAGING_OPERATIONS.md'), 'utf8');

describe('bounded staging operations', () => {
  it('accepts only bounded whole-minute windows', () => {
    expect(parseMinutes('1')).toBe(1);
    expect(parseMinutes(String(MAX_WINDOW_MINUTES))).toBe(MAX_WINDOW_MINUTES);
    expect(() => parseMinutes('0')).toThrow();
    expect(() => parseMinutes(String(MAX_WINDOW_MINUTES + 1))).toThrow();
    expect(() => parseMinutes('1.5')).toThrow();
  });

  it('refuses any Compose project except staging', () => {
    expect(assertStagingProject(STAGING_PROJECT)).toBe(STAGING_PROJECT);
    expect(() => assertStagingProject('gones-prod')).toThrow('refusing non-staging Compose project');
  });

  it('calculates combined fixed, usage and overage cost with reserve gate', () => {
    const result = projectMonthlyBudget({
      fixedEur: 8,
      objectEur: 0,
      telemetryEur: 0,
      emailEur: 0,
      networkEur: 0,
      dbPriceEurPerCuHour: 0.10,
      freeDbCuHours: 100,
      stagingDbCuHours: 80,
      productionDbCuHours: 100,
      ceilingEur: 50
    });
    expect(result.totalEur).toBe(8);
    expect(result.stagingWithinActiveBudget).toBe(true);
    expect(result.withinBudget).toBe(true);

    const over = projectMonthlyBudget({
      fixedEur: 8,
      objectEur: 0,
      telemetryEur: 0,
      emailEur: 0,
      networkEur: 0,
      dbPriceEurPerCuHour: 1,
      freeDbCuHours: 100,
      stagingDbCuHours: 81,
      productionDbCuHours: 160,
      ceilingEur: 50
    });
    expect(over.withinBudget).toBe(false);
    expect(over.stagingWithinActiveBudget).toBe(false);
    expect(over.alertLevel).toBe('critical');
  });

  it('keeps stop staging-only, bounded and volume-preserving', () => {
    expect(source).toContain("const services = ['frontend', 'api', 'worker'];");
    expect(source).toContain("else if (command === 'expire') expire();");
    expect(source).toContain("['stop', '--timeout', '30', service]");
    expect(source).toContain('persistent DB/object volumes preserved');
    expect(source).not.toContain("'down'");
    expect(source).not.toContain("'--volumes'");
    const stopSource = source.slice(source.indexOf('function stop()'), source.indexOf('function status()'));
    expect(stopSource).not.toContain("composeCommand(['down'");
    expect(stopSource).not.toContain("composeCommand(['--volumes'");
  });

  it('documents isolated per-environment backup and restore commands', () => {
    for (const phrase of [
      'gones-staging',
      'gones-prod',
      'GONES_RESTORE_ISOLATED=true',
      'GONES_RESTORE_TARGET_DSN_FILE',
      'GONES_BACKUP_KEY_FILE',
      'Never use `down --volumes`',
      'maintenance mode'
    ]) expect(operations).toContain(phrase);
  });
});
