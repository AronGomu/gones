import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liveDeleteOutcome } from '../../data/live-command-ux';

const runnerComponent = readFileSync(join(__dirname, 'live-tournament-runner.component.ts'), 'utf8');

describe('deleting a running live tournament', () => {
  it('a declined confirmation deletes nothing', () => {
    expect(liveDeleteOutcome(false)).toBe('cancelled');
  });

  it('a confirmed delete with no error reports deleted', () => {
    expect(liveDeleteOutcome(true)).toBe('deleted');
  });

  it('a 403 reports forbidden', () => {
    expect(liveDeleteOutcome(true, { status: 403 })).toBe('forbidden');
  });

  it('a 412 reports stale', () => {
    expect(liveDeleteOutcome(true, { status: 412 })).toBe('stale');
  });

  it('a local concurrency error reports stale', () => {
    expect(liveDeleteOutcome(true, new Error('staleLiveTournamentDocument'))).toBe('stale');
  });

  it('anything else reports failed', () => {
    expect(liveDeleteOutcome(true, new Error('boom'))).toBe('failed');
  });

  it('the dialog offers a red ghost delete button', () => {
    const line = runnerComponent.split('\n').find((candidate) => candidate.includes('data-cy="live-advanced-delete"')) ?? '';
    expect(line).toContain('danger-ghost-action');
    expect(line).toContain('mat-stroked-button');
  });

  it('the delete button sits after the apply button', () => {
    expect(runnerComponent.indexOf('live-advanced-delete')).toBeGreaterThan(runnerComponent.indexOf('live-advanced-apply'));
  });

  it('the delete button is hidden for a read-only visitor', () => {
    expect(runnerComponent).toContain('@if (data.canManage) {');
    const guarded = runnerComponent.slice(runnerComponent.indexOf('@if (data.canManage) {'));
    expect(guarded.slice(0, guarded.indexOf('\n    }'))).toContain('data-cy="live-advanced-delete"');
  });

  it('deleting is confirmed before it happens', () => {
    const body = runnerComponent.slice(runnerComponent.indexOf('async deleteTournament('));
    const handler = body.slice(0, body.indexOf('\n  }'));
    expect(handler).toContain('ConfirmDialogComponent');
    expect(handler).toContain('destructive: true');
  });
});
