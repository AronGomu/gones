import { CanDeactivateFn } from '@angular/router';
import type { OrganizerEventCreateComponent } from './organizer-event-create.component';

export const eventEditorCanDeactivate: CanDeactivateFn<OrganizerEventCreateComponent> = component => component.confirmLeave();
