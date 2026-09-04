import { describe, expect, it, vi } from 'vitest';
import { eventEditorCanDeactivate } from './event-create-leave.guard';
import { OrganizerEventCreateComponent } from './organizer-event-create.component';

describe('eventEditorCanDeactivate', () => {
  it('delegates every Angular navigation decision to the editor', () => {
    const component = { confirmLeave: vi.fn(() => false) } as unknown as OrganizerEventCreateComponent;

    expect(eventEditorCanDeactivate(component, {} as never, {} as never, {} as never)).toBe(false);
    expect(component.confirmLeave).toHaveBeenCalledTimes(1);
  });
});
