import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  Client,
  ProposalApproverResponse,
  TournamentPayloadRequest,
  TournamentProposalDecisionResponse,
  TournamentProposalResponse,
  TournamentProposalReviewResponse
} from '../../api/generated/gones-api';

export function sortApprovers(approvers: ProposalApproverResponse[]): ProposalApproverResponse[] {
  return [...approvers].sort((a, b) => {
    if (a.globalRole !== b.globalRole) return a.globalRole === 'Admin' ? -1 : b.globalRole === 'Admin' ? 1 : 0;
    return a.username.localeCompare(b.username);
  });
}

@Injectable({ providedIn: 'root' })
export class TournamentProposalService {
  private readonly client = inject(Client);

  /**
   * T26: scoped to the organization the tournament would be published under. The candidates are
   * that organization's own Organizers plus the global Admins that back every organization — a
   * global Organizer with no standing over it is not offered, and would be refused on submit.
   */
  listApprovers(organizationId: string): Promise<ProposalApproverResponse[]> {
    return firstValueFrom(this.client.approvers(organizationId));
  }

  submit(tournament: TournamentPayloadRequest, recipientUserIds: string[]): Promise<TournamentProposalResponse> {
    return firstValueFrom(this.client.tournamentProposals({ tournament, recipientUserIds }));
  }

  reviewByToken(token: string): Promise<TournamentProposalReviewResponse> {
    return firstValueFrom(this.client.byToken(token));
  }

  approveByToken(token: string): Promise<TournamentProposalDecisionResponse> {
    return firstValueFrom(this.client.approve(token));
  }

  rejectByToken(token: string, reason: string): Promise<void> {
    return firstValueFrom(this.client.reject(token, { reason }));
  }
}
