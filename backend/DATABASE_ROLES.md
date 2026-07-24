# PostgreSQL role contract

Production uses separate credentials:

- **Migration role:** owns schema; runs EF migrations; never used by API/Worker.
- **Application role:** gets DML only. For `audit_records`, grant `SELECT, INSERT`; revoke `UPDATE, DELETE, TRUNCATE`. No schema ownership or trigger/function DDL.

Provisioning template (run as DB administrator, replacing role names):

```sql
GRANT USAGE ON SCHEMA public TO gones_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gones_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_records FROM gones_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gones_migration IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gones_app;
```

Migration `AppendOnlyAuditGuard` also rejects row update/delete plus table truncate. Role grants remain primary control; trigger provides defense in depth. Runtime `GONES_DB_CONNECTION` must use application role. EF tooling uses same variable with migration-role credential only inside migration job.
