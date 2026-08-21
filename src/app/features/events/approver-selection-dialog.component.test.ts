import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as account-settings.component.test.ts: no TestBed / zone.js in this repo, so
// `effect()` is stubbed to a no-op and the component is built with a bare Injector.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ApproverSelectionDialogComponent, ApproverSelectionDialogData } from './approver-selection-dialog.component';
import { sortApprovers } from './event-proposal.service';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { ProposalApproverResponse } from '../../api/generated/gones-api';

function approver(overrides: Partial<ProposalApproverResponse>): ProposalApproverResponse {
  return { id: 'id', username: 'user', globalRole: 'Organizer', ...overrides } as ProposalApproverResponse;
}

function createComponent(approvers: ProposalApproverResponse[]) {
  const ref = { close: vi.fn() };
  const injector = Injector.create({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { approvers } satisfies ApproverSelectionDialogData },
      { provide: MatDialogRef, useValue: ref },
      DeckArchetypeSettingsService,
      I18nService
    ]
  });
  const component = runInInjectionContext(injector, () => new ApproverSelectionDialogComponent());
  return { component, ref };
}

describe('sortApprovers', () => {
  it('groups admins before organizers', () => {
    const sorted = sortApprovers([
      approver({ globalRole: 'Organizer', username: 'b' }),
      approver({ globalRole: 'Admin', username: 'z' }),
      approver({ globalRole: 'Admin', username: 'a' })
    ]);
    expect(sorted.map(a => a.username)).toEqual(['a', 'z', 'b']);
  });
});

describe('ApproverSelectionDialogComponent', () => {
  it('confirm is disabled with nothing checked', () => {
    const { component } = createComponent([approver({ id: '1' })]);
    expect(component.selected()).toEqual([]);
  });

  it('confirm returns the checked ids in order', () => {
    const { component, ref } = createComponent([approver({ id: '1' }), approver({ id: '2' })]);
    component.toggle('2');
    component.toggle('1');
    expect(component.selected()).toEqual(['2', '1']);
    component.confirm();
    expect(ref.close).toHaveBeenCalledWith(['2', '1']);
  });

  it('cancel returns undefined', () => {
    const { component, ref } = createComponent([approver({ id: '1' })]);
    component.cancel();
    expect(ref.close).toHaveBeenCalledWith(undefined);
  });
});
