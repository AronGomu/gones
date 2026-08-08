# PostgreSQL role contract

Production uses separate credentials:

- **Migration role:** owns schema; runs EF migrations; never used by API/Worker.
- **Application role:** gets DML only. For `audit_records`, grant `SELECT, INSERT`; revoke `UPDATE, DELETE, TRUNCATE`, then grant back `UPDATE (actor_id)` alone. No schema ownership or trigger/function DDL.

Provisioning template (run as DB administrator, replacing role names):

```sql
GRANT USAGE ON SCHEMA public TO gones_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gones_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_records FROM gones_app;
-- Revoking the table privilege also drops every column privilege, so this line must come last.
GRANT UPDATE (actor_id) ON audit_records TO gones_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gones_migration IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gones_app;
```

Migration `AppendOnlyAuditGuard` also rejects row update/delete plus table truncate. Migration
`AllowAccountHardDelete` narrows that trigger to tolerate exactly one mutation — clearing `actor_id`
on an otherwise unchanged row — so a hard account deletion (`docs/adr/0025-hard-account-deletion.md`)
can outlive the account it audited; every other update, delete and truncate still raises `55000`.
Role grants remain primary control; trigger provides defense in depth. Runtime `GONES_DB_CONNECTION` must use application role. EF tooling uses same variable with migration-role credential only inside migration job.
