# Staging access policy

Staging restricts accounts and outbound email on the server. Public anonymous pages remain public. Production/local signup and email behavior remain unchanged. This is an eligibility policy, not invitation CRUD. [Owner setup](OWNER_SETUP.md) separately provides emailed password setup and private one-shot promotion under the same policy; there is no public administration endpoint, fixture import, or password generation.

## Private configuration

| ID | Setting | Contract |
| --- | --- | --- |
| C1 | `GONES_DEPLOYMENT_ENVIRONMENT` | Exact `staging` activates restrictions even with host environment `Production`. Accepted non-staging values: `production`, `local`, `testing`. Unknown/empty values fail startup. |
| C2 | ASP.NET/.NET host environment `Staging` | Independently activates restrictions. Explicit non-staging deployment marker conflicts and fails startup. Omitting deployment marker cannot disable this host setting. |
| C3 | `GONES_STAGING_POLICY_FILE` | Required absolute path for staging API and Worker. Read once at startup; maximum 65,536 bytes, depth four. Non-staging processes reject a configured policy path rather than ignore it. |
| C4 | `GONES_BOOTSTRAP_ADMIN_EMAIL` / `GONES_BOOTSTRAP_ADMIN_EMAIL_FILE` | Existing private owner setting, now also supporting an exclusive absolute file path. File maximum 1,024 bytes; UTF-8, optional terminal CR/LF. Missing/invalid owner or missing allowlist membership fails staging startup. |

Mount both private files read-only with least-privilege permissions. API and Worker must load the same immutable policy revision. Never put real addresses or policy contents in repository files, frontend runtime config, command-line arguments, logs, or deployment artifacts. Existing owner promotion consumes the same owner configuration; configuring eligibility does not create or promote an account.

Policy JSON shape below uses synthetic, non-deliverable examples. Substitute privately; do not deploy examples as owner configuration.

```json
{
  "revision": "policy-001",
  "validAfterUtc": "2026-01-01T00:00:00Z",
  "invitedEmails": ["owner@example.invalid", "tester@example.invalid"],
  "recipientEmails": ["owner@example.invalid", "tester@example.invalid"]
}
```

Validation is strict. Unknown, duplicate, missing, null, wrong-type properties, comments, trailing commas/content, oversized files, malformed mailbox entries, duplicate normalized entries, and empty lists fail startup with `staging_policy_invalid`. Exception chains omit file contents and private paths. Revision is 1–64 ASCII letters/digits/hyphens/underscores. `validAfterUtc` is an exact whole-second UTC timestamp (`yyyy-MM-ddTHH:mm:ssZ`), not in the future at startup.

Addresses are ASCII mailboxes, compared exactly after trimming exterior ASCII spaces and invariant uppercasing. Controls/non-ASCII are rejected before trimming. No display names, multiple recipients, wildcards, plus-alias stripping, dot stripping, subdomain matching, or Unicode compatibility expansion. Owner must occur explicitly in both lists; every invited address must also be a recipient. Additional exact mail-only recipients are permitted. Removing only invitation eligibility does not revoke independent mail permission.

## Apply or revoke a revision

This operation invalidates **every previous staging session and user action link**, including credentials belonging to testers who remain invited. Plan a staging maintenance window. Do not use an overlapping rolling deployment.

1. A1. Close staging ingress for maintenance. Drain and stop every old staging API and Worker instance. Confirm old instances are gone and no old provider request remains in flight. Do not stop production or the shared edge.
2. A2. Remove the revoked tester from **both** lists. Retain the configured owner's explicit membership. Choose a new revision and a cutoff at the next whole UTC second strictly after the final old issuance/drain instant and strictly after the previous cutoff. Wait until that instant before starting replacement processes.
3. A3. Store the new immutable private files. Start staging API and Worker with the same deployment marker, revision, cutoff, owner setting, and policy bytes. Deployment tooling must verify this identity privately before reopening ingress. A startup failure leaves staging closed; do not bypass policy to recover availability.
4. A4. Verify a removed tester cannot log in, refresh, use an old access token, finish OAuth/linking, reset/verify/change email, or use an old proposal review/image/decision link. Verify an eligible tester can sign in freshly. Verify a blocked historical outbox send becomes `DeadLetter` with `staging_recipient_blocked`, no `Sent`/history, no provider call. Then reopen staging ingress.

**Effective revocation point:** every old process has drained/stopped, no outstanding old provider call remains, and every replacement uses the new policy. Merely editing a file changes nothing in a running process. Old requests may complete before this point. Provider-accepted mail cannot be recalled, including mail whose response was lost. Forced termination does not prove non-acceptance.

Re-inviting a tester requires another strictly newer revision/cutoff. Old credentials remain invalid because their immutable issuance timestamps predate the cutoff. This is not persisted session deletion: historical users, links, refresh rows, audit records, data, and queued messages remain. The runtime does not remember previously applied revisions, detect rollback to an older file, or provide hot reload. Operators must enforce monotonic cutoffs/revisions, synchronized trustworthy clocks, quiescence, and matching policy identity across all replicas. Restoring old policy or rolling clocks back can defeat timestamp-based revocation.

## Credential boundaries

| ID | Credential/path | Server enforcement |
| --- | --- | --- |
| E1 | Local registration/login | Registration checks requested email before account writes; denied registration/resend/forgot-password retain generic responses. Login checks stored account email before password-counter/session mutation. Session creation checks again centrally. |
| E2 | JWT / refresh | JWT validation reuses current DB account lookup and checks stored email plus exactly one canonical numeric signed `iat`. Cutoff has no expiry-clock-skew allowance. Refresh checks immutable family `RefreshSession.CreatedAt`, never replacement token time, retaining token/session locks and replay revocation. |
| E3 | OAuth | Callback/completion/verification check original `OAuthAttempt.CreatedAt`; callback checks before provider exchange. Existing identity/link uses current stored account email, never provider alias. New known email/proposed email must be invited before account/link creation or verification mail. Missing-email flow may issue opaque completion state but cannot create an uninvited account. Provider exchange is needed to discover a previously unknown identity. |
| E4 | Account actions | Verification/reset/change require current stored email, fresh token `CreatedAt`, eligible change target. A pre-cutoff pending email-change ticket no longer suppresses verification resend; a current valid change still does. Allowed-to-allowed email change preserves existing session semantics absent a separate cutoff/stamp change. |
| E5 | Anonymous proposal links | Review, private image, approve, reject require recipient's current stored account email and immutable `EventProposalRecipient.SentAt`. Both initial lookup and locked decision lookup enforce policy; rejected image requests never read object storage. All denials retain generic 404; expiry/role/membership/closure and decision locks remain. |

All issuance timestamps are accepted at equality (`>= validAfterUtc`), rejected below it. Advancing a token's expiry or rotating its token does not renew its original family/attempt/proposal authority. Existing JWT library normalization does not soften this rule: signed raw payload is also checked for duplicate, fractional, exponent, string, malformed, or out-of-range `iat`.

## Mail boundary and business transactions

Enqueue behavior is unchanged. Business writes and outbox rows still commit atomically; a blocked email does not turn an otherwise-valid mutation into a new 500. Concrete `BrevoEmailTransport` and `FileEmailTransport` enforce the current process policy at send time, including historical queued messages and existing File dedupe outputs. Brevo checks before circuit/semaphore admission and again after admission, before HTTP. Blocked sends never call the provider, including with a full semaphore or open circuit.

Attempted blocked sends raise permanent `EmailTransportException("staging_recipient_blocked", false)`. Existing processor semantics deadletter and scrub payload without retry or success history. Existing reconciliation holds remain intact: expired provider-idempotency-window recovery can be held before the transport is called, and uncertain delivery is never blindly resent or marked Sent. Do not replay held/deadletter mail to bypass recipient policy.

Allowed mail receives exactly one leading `[STAGING] ` prefix (repeated exact leading prefixes collapse). Body, outbox ID, dedupe key, provider idempotency/correlation metadata remain unchanged. Historical allowed mail can still contain now-invalid action links; request a fresh link. The private Worker `--wake` command only sends a wake hint and does not execute mail; the receiving Worker must already have validated policy.

## Executable evidence

```bash
dotnet test backend/Gones.sln --no-restore --filter 'FullyQualifiedName~Staging|FullyQualifiedName~OAuthApiTests|FullyQualifiedName~LocalIdentityApiTests|FullyQualifiedName~EventProposalDecisionTests|FullyQualifiedName~NotificationOutboxTests|FullyQualifiedName~BrevoDeliveryTests'
```

`StagingPolicyTests` covers strict config, private-file safety, exact addresses, cutoff equality, immutable reload semantics. `StagingMailTests` exercises real File/Brevo implementations with fake HTTP. `StagingAccessTests` uses isolated migrated PostgreSQL and fake OAuth; checks account mutation, applied revocation/re-invite, signed JWTs, refresh ancestry, account actions and OAuth. Proposal/outbox integration suites cover anonymous credentials, object access denial, historical mail, business commit, permanent failures and uncertainty holds. `StagingStartupTests` exercises API startup without DB configuration.

Hosted marker/mount/revision verification, actual operator allowlists, live provider delivery, actual owner login/Admin validation, and deployment readiness remain separate integration/release gates. Passing isolated tests does not attest a running staging environment.
