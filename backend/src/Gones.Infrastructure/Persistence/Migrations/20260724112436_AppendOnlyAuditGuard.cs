using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AppendOnlyAuditGuard : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE FUNCTION reject_audit_mutation() RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    RAISE EXCEPTION 'audit_records is append-only' USING ERRCODE = '55000';
                END;
                $$;

                CREATE TRIGGER audit_records_append_only
                BEFORE UPDATE OR DELETE ON audit_records
                FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

                CREATE TRIGGER audit_records_no_truncate
                BEFORE TRUNCATE ON audit_records
                FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

                REVOKE UPDATE, DELETE, TRUNCATE ON audit_records FROM PUBLIC;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS audit_records_no_truncate ON audit_records;
                DROP TRIGGER IF EXISTS audit_records_append_only ON audit_records;
                DROP FUNCTION IF EXISTS reject_audit_mutation();
                """);
        }
    }
}
