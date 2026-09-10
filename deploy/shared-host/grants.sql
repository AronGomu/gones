-- Host creates gones_migration (schema owner), gones_app, gones_backup first.
-- Run as gones_migration on this environment's managed DB after each migration.
-- No role creation, credentials, restore authority or production/staging DB switch here.
BEGIN;
SELECT current_database() AS database \gset
GRANT CONNECT ON DATABASE :"database" TO gones_app, gones_backup;
GRANT USAGE ON SCHEMA public TO gones_app, gones_backup;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gones_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO gones_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_records FROM gones_app;
GRANT UPDATE (actor_id) ON audit_records TO gones_app;
-- Keep future table DML fail-closed until this post-migration job runs. Broad app
-- default grants could accidentally grant audit mutation during a failed rollout.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM gones_backup;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM gones_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gones_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO gones_backup;
COMMIT;
