# Tournament Proposals with Signed-Token Approval

## Status

Accepted. Amended by T26 (see *Who may propose, who may approve* below), which narrowed who can
approve a proposal without narrowing who can submit one. Extends Calendar V1's publication path;
does not change organizer or admin publishing.

Amended by [ADR 0053](0053-markdown-is-event-description-source.md): proposal review renders
server-derived sanitized Markdown HTML instead of plain text; it still does not call a privileged
preview endpoint.

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

## Who may propose, who may approve (T26)

The original decision left one question unanswered, and answering it in either direction alone
produced a defect. **The submitter must not need a membership** — otherwise the flow is unusable by
the account it exists for, since a newly verified user belongs to nothing. **The approver must have
one** — otherwise any global Organizer could publish a live public tournament under an organization
neither party belongs to, carrying that organization's name, website and contact email, with
registrations opening under it. The two halves are settled separately:

- **Submitting stays open.** The creation form's picker reads the anonymous `GET /api/organizations`,
  so every organization is proposable by any verified account, and `requireMembership: false` on the
  approval publish path stays. That flag is what this ADR always meant: the *acting user* recorded as
  the owner is the submitter, who is a stranger to the organization by construction. It is not, and
  never was, a statement that nobody had to consent.

- **Approving is scoped.** `GET /api/tournament-proposals/approvers` takes the target organization
  and offers only Organizers and Admins holding an `organization_members` row for it, **plus every
  global Admin**. Submission refuses any recipient outside that set, so a client cannot name someone
  the picker would not have shown. The global-Admin fallback is unconditional and deliberate: without
  it, an organization whose members are all plain accounts would have nobody able to decide, and
  every proposal naming it would expire unread.

- **Authority is re-read when the token is used, not when it was mailed.** A link lives seven days.
  An approver demoted to `User`, whose profile is closed, or who has lost the membership that made
  them an approver, resolves to the same `404` as an unknown token. Checking only at submission meant
  a stale mail outlived the standing that justified it.

- **The proposal's row lock is taken before anything is published**, and publishing joins that
  transaction instead of opening its own. The original order published first, which meant an approve
  racing a reject left a live, registerable tournament attached to a `Rejected` proposal — submitter
  mailed a refusal, approver shown a `409`, and nothing anywhere to take the tournament down. The
  idempotency key stays derived from the proposal, so a retry re-enters the same key rather than
  creating a second tournament.

- **`recipientUserIds` is capped at 10.** It had a floor of one and no ceiling, which made a single
  submission an arbitrarily large mail fan-out.

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
