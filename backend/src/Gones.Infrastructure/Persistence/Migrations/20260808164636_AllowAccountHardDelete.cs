using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AllowAccountHardDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // audit_records is append-only at the database level (20260724112436_AppendOnlyAuditGuard).
            // A hard account deletion has to drop the actor reference so the row outlives the account,
            // so the guard is narrowed to tolerate exactly that one change and nothing else: any other
            // column difference, any INSERT-free DELETE and every TRUNCATE still raise 55000.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                DECLARE
                    without_actor audit_records%ROWTYPE;
                BEGIN
                    IF TG_OP = 'UPDATE' THEN
                        IF OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL THEN
                            without_actor := OLD;
                            without_actor.actor_id := NULL;
                            IF NEW IS NOT DISTINCT FROM without_actor THEN
                                RETURN NEW;
                            END IF;
                        END IF;
                    END IF;

                    RAISE EXCEPTION 'audit_records is append-only' USING ERRCODE = '55000';
                END;
                $$;
                """);

            // The application role may only write audit rows; nulling the actor is the single column
            // it is now allowed to update. The role is absent from throwaway test databases.
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'gones_app') THEN
                        EXECUTE 'GRANT UPDATE (actor_id) ON audit_records TO gones_app';
                    END IF;
                END $$;
                """);

            migrationBuilder.DropForeignKey(
                name: "fk_tournament_registration_attempts_asp_net_users_user_id",
                table: "tournament_registration_attempts");

            migrationBuilder.CreateIndex(
                name: "ix_audit_records_actor_id",
                table: "audit_records",
                column: "actor_id");

            // audit_records.actor_id carried no foreign key until now, so nothing guaranteed the
            // referenced account still exists. Drop the dangling references before the constraint
            // that would reject them; a null actor is exactly what the new rule produces anyway.
            migrationBuilder.Sql(
                """
                UPDATE audit_records
                SET actor_id = NULL
                WHERE actor_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM asp_net_users WHERE asp_net_users.id = audit_records.actor_id);
                """);

            migrationBuilder.AddForeignKey(
                name: "fk_audit_records_asp_net_users_actor_id",
                table: "audit_records",
                column: "actor_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "fk_tournament_registration_attempts_asp_net_users_user_id",
                table: "tournament_registration_attempts",
                column: "user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'gones_app') THEN
                        EXECUTE 'REVOKE UPDATE (actor_id) ON audit_records FROM gones_app';
                    END IF;
                END $$;
                """);

            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    RAISE EXCEPTION 'audit_records is append-only' USING ERRCODE = '55000';
                END;
                $$;
                """);

            migrationBuilder.DropForeignKey(
                name: "fk_audit_records_asp_net_users_actor_id",
                table: "audit_records");

            migrationBuilder.DropForeignKey(
                name: "fk_tournament_registration_attempts_asp_net_users_user_id",
                table: "tournament_registration_attempts");

            migrationBuilder.DropIndex(
                name: "ix_audit_records_actor_id",
                table: "audit_records");

            migrationBuilder.AddForeignKey(
                name: "fk_tournament_registration_attempts_asp_net_users_user_id",
                table: "tournament_registration_attempts",
                column: "user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
