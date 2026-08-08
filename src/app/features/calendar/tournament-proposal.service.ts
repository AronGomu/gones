import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Client, ProposalApproverResponse, TournamentPayloadRequest, TournamentProposalResponse } from '../../api/generated/gones-api';

export function sortApprovers(approvers: ProposalApproverResponse[]): ProposalApproverResponse[] {
  return [...approvers].sort((a, b) => {
    if (a.globalRole !== b.globalRole) return a.globalRole === 'Admin' ? -1 : b.globalRole === 'Admin' ? 1 : 0;
    return a.username.localeCompare(b.username);
  });
}

@Injectable({ providedIn: 'root' })
export class TournamentProposalService {
  private readonly client = inject(Client);

  listApprovers(): Promise<ProposalApproverResponse[]> {
    return firstValueFrom(this.client.approvers());
  }

  submit(tournament: TournamentPayloadRequest, recipientUserIds: string[]): Promise<TournamentProposalResponse> {
    return firstValueFrom(this.client.tournamentProposals({ tournament, recipientUserIds }));
  }
}
