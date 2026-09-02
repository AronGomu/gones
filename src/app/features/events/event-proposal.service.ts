import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  Client,
  ProposalApproverResponse,
  EventPayloadRequest,
  EventProposalDecisionResponse,
  EventProposalResponse,
  EventProposalReviewResponse
} from '../../api/generated/gones-api';

export function sortApprovers(approvers: ProposalApproverResponse[]): ProposalApproverResponse[] {
  return [...approvers].sort((a, b) => {
    if (a.globalRole !== b.globalRole) return a.globalRole === 'Admin' ? -1 : b.globalRole === 'Admin' ? 1 : 0;
    return a.username.localeCompare(b.username);
  });
}

@Injectable({ providedIn: 'root' })
export class EventProposalService {
  private readonly client = inject(Client);

  /**
   * T26: scoped to the organization the event would be published under. The candidates are
   * that organization's own Organizers plus the global Admins that back every organization — a
   * global Organizer with no standing over it is not offered, and would be refused on submit.
   */
  listApprovers(organizationId: string): Promise<ProposalApproverResponse[]> {
    return firstValueFrom(this.client.approvers(organizationId));
  }

  submit(event: EventPayloadRequest, recipientUserIds: string[]): Promise<EventProposalResponse> {
    return firstValueFrom(this.client.eventProposals({ event, recipientUserIds }));
  }

  reviewByToken(token: string): Promise<EventProposalReviewResponse> {
    return firstValueFrom(this.client.byToken(token));
  }

  approveByToken(token: string): Promise<EventProposalDecisionResponse> {
    return firstValueFrom(this.client.approve(token));
  }

  rejectByToken(token: string, reason: string): Promise<void> {
    return firstValueFrom(this.client.reject(token, { reason }));
  }
}
