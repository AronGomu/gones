# Tournament Proposals with Signed-Token Approval

## Status

Accepted. Extends Calendar V1's publication path; does not change organizer or admin publishing.

## Context

Publishing a public tournament requires the `Organizer` role. The product owner wants every verified
account to be able to *propose* one, using the same creation page, with an administrator or organizer
deciding. The submitter picks who reviews; the reviewers get the whole event by email and decide from
there.

The design question was how the reviewer authenticates on the review page. Requiring a login means an
organizer who reads mail on a phone has to sign in before they can say yes; that friction is the
difference between a flow that gets used and one that does not. Not authenticating at all means
anyone who guesses a URL can publish.

## Decision

**A proposal is a stored payload; the review link carries a signed single-use token.**

- `TournamentProposal` holds the submitted payload as `jsonb`, its status, its submitter and a 7-day
  expiry. It is **not** a draft `ScheduledTournament` — an unapproved proposal has no path into the
  public calendar, by construction.
- Each selected reviewer gets their own `TournamentProposalRecipient` row holding only the SHA-256
  hash of their token. The plaintext exists in exactly one place: the link in their email.
- `GET|POST /api/tournament-proposals/by-token/{token}[/approve|/reject]` are anonymous and IP
  rate-limited. Token lookup is by hash index, then a constant-time comparison.
- The first decision consumes the whole proposal. Every sibling token then returns `409`. There is no
  double publish and no race that produces two tournaments.
- Approval publishes with the **submitter** as the acting user, so ownership and audit reflect who
  proposed it; the approver is recorded in the audit diff.
- Refusal requires a reason of 1..2000 characters and mails it to the submitter.
- Organizers and Admins are refused (`403`) when they POST a proposal. They publish directly; a
  privileged user routing around their own privilege is a bug, not a feature.

## Consequences

- Two new tables and two new notification templates (`tournament-proposal`,
  `tournament-proposal-rejected`) in both locales.
- The review page renders the proposed description as **plain text**, not sanitized HTML. Server-side
  sanitization sits behind an organizer-only preview endpoint, and an anonymous page must not call
  it. Plain text is the safe rendering, and the reviewer loses only formatting.
- A leaked token is a publish capability for seven days. It is single-use, scoped to one proposal,
  and cannot escalate to anything else. Accepted, and the reason the expiry is short.
- The creation page is now one page for every role, branching only at submit. Any future field added
  to publishing is automatically available to proposals, because both go through the same request
  record and the same validator.
