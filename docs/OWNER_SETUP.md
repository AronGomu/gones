# Owner setup

Fresh staging and production databases use independent owner setup. No identity, password, Event, registration, or League fixture is created by issuance. The owner supplies the password and required profile fields. The public confirmation endpoint creates only a verified **User**, never an Admin or a login session.

## Private operator sequence

1. O1. Configure each environment privately: `GONES_BOOTSTRAP_ADMIN_EMAIL` or exclusive absolute `GONES_BOOTSTRAP_ADMIN_EMAIL_FILE`, explicit `GONES_DEPLOYMENT_ENVIRONMENT` (`staging` or `production`), canonical HTTPS `GONES_PUBLIC_APP_ORIGIN`. Mount the owner setting into API and private Migrator. Staging API, Worker and Migrator require the same immutable [staging policy](STAGING_ACCESS.md), with owner explicitly invited and allowed as a mail recipient. Never place real addresses, tokens, passwords, or migration credentials in frontend config, repository files, command arguments, logs, or artifacts.
2. O2. Apply migrations with the environment's private migration role. Run `dotnet Gones.Migrator.dll owner setup` in that same controlled job. It atomically reserves an owner enrollment and queues a setup email. The command awaits a private Worker wake after commit when wake configuration is present. Keep the environment's Worker running to deliver mail; failed wake leaves durable queued work for normal recovery. `owner_setup_pending` is **not** environment readiness.
3. O3. Owner opens the emailed HTTPS link and submits username, first name, last name, chosen password, matching confirmation. Opening the page changes nothing. Submission verifies email possession and creates the password through Identity hashing. No password is generated, shared, or emailed. The page clears the URL fragment and keeps the token only in memory; reopening the email is necessary after an unfinished page reload.
4. O4. After owner confirmation, run `dotnet Gones.Migrator.dll owner promote` privately. It requires the bound completed enrollment, exact configured identity, verified email, password and profile. The one-shot Admin marker, role, security stamp, session revocations and audit commit together. The API never receives migration credentials or calls this promotion operation.
5. O5. Owner signs in normally, opens `/admin`, reloads, and confirms Admin access remains. Record only the outcome, not credentials or link contents. Declare owner access ready only after this check. Repeat independently for the other environment with a separately chosen password.

## Resend and recovery

- R1. `dotnet Gones.Migrator.dll owner resend` rotates a pending link, invalidating its predecessor. A persisted one-hour cooldown applies across command concurrency and restarts. Ordinary `owner setup` reruns retain a current unexpired link; expired or policy-revoked links can be reissued after cooldown. There is no public resend endpoint.
- R2. Links expire after 24 hours and cannot be used twice. Validation binds purpose, reserved identity, normalized configured owner, deployment environment and HTTPS origin. Copying token rows into an environment with different config does not make the link valid. Staging policy cutoff invalidates older unconsumed links. A policy change does not require repeating already completed password setup; current owner eligibility still gates promotion.
- R3. Any ordinary account establishment or hard deletion before setup completion permanently disqualifies the pending enrollment. Retained audit action history is checked under lock at issuance, resend and confirmation; deleted audit actors do not erase this history. Refusal commits the disabled state. Own setup mail/audit and reference catalogs do not count as ordinary account establishment.
- R4. Completed enrollment survives owner deletion without a user FK. Reruns never reset a password, recreate an account, or re-promote a deliberately demoted owner. A consumed Admin marker gives a terminal no-op even after deletion. Missing Admin on an established database requires explicitly authorized operator recovery; do not delete markers, erase history, downgrade the migration, alter bindings, or use fixture reset tools against a persistent environment.
- R5. Existing accounts use ordinary password recovery. Legacy `admin bootstrap --email` remains an explicit private compatibility operation for a never-issued/unbound enrollment, including migration-disabled older databases; it requires configured email, verified account, password and profile. It is not the normal fresh-environment deployment command. Bound pending/disabled enrollment cannot bypass setup through the legacy command; completed enrollment with changed owner/config cannot fall through to legacy promotion.

## Storage and compatibility

`20260909230646_OwnerSetup` is one additive migration after WorkerMaintenance. It adds a singleton enrollment, disabled for an already populated identity/domain database, preserving existing users and account-action tokens unchanged. No downgrade is part of deployment or recovery. Ordinary API auth startup does not acquire a new owner/deployment configuration prerequisite; only setup operations require explicit binding. Host environment `Staging` retains its existing fail-closed policy requirements.

Only the latest token hash lives in the enrollment. The pending outbox necessarily retains a private sendable URL; existing Worker success/dead-letter handling scrubs recipient and model payload. History previews redact action URLs. A File transport configured to include action links is a private delivery fixture, never a publishable report.

## Isolated executable checks

```bash
dotnet restore backend/Gones.sln --locked-mode
dotnet build backend/Gones.sln --no-restore
dotnet test backend/Gones.sln --no-restore --filter 'FullyQualifiedName~OwnerSetup'
npm test -- src/app/auth/owner-setup.component.test.ts src/app/auth/last-visited-url.service.test.ts
NG_CLI_ANALYTICS=false npm run build
npm run auth:owner:smoke
```

The browser smoke creates its own PostgreSQL container, API and loopback frontend, uses synthetic owner data, performs private promotion, then proves normal login/Admin/reload. It removes only its own processes/container and disables browser video/failure screenshots. It does not target an existing stack or contact OAuth/email providers. These checks are local evidence, not actual owner email delivery, staging deployment, or production readiness.
