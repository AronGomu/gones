using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// T15 — renames the calendar domain from Tournament to Event.
    ///
    /// EF scaffolds a <c>DropTable</c> + <c>CreateTable</c> pair for every table here because the
    /// model snapshot still carried the old CLR names at diff time, so it cannot recognise
    /// <c>ScheduledTournament</c> -&gt; <c>Event</c> (and its six siblings) as entity-type renames.
    /// Applying that scaffold would silently drop every published event, every registration and
    /// every proposal. It is hand-corrected here to a pure rename, exactly like
    /// <c>20260809122735_RenameLeagueArchiveTables</c>: the seven tables, the five foreign-key
    /// columns, the seven primary keys, the eighteen foreign keys and the thirty-two indexes are
    /// renamed in place and every row survives.
    ///
    /// Deliberately unchanged: the shared <c>tournament_formats</c> lookup, the archive and live
    /// tables, and every <c>ck_*</c> check constraint — EF keeps the check-constraint names it was
    /// given in the configurations, so they are identical on both sides of the rename.
    /// <c>scheduled_notifications</c> and <c>notification_history</c> belong to the notification
    /// domain and keep their table names; only their FK column moves to <c>event_id</c>.
    ///
    /// Two of the new foreign-key names EF derives are 65 characters, over PostgreSQL's 63-byte
    /// identifier limit. They are spelled here exactly as the model snapshot spells them: PostgreSQL
    /// truncates them on <c>RENAME CONSTRAINT</c> precisely as it would on the scaffolded
    /// <c>CreateTable</c>, so a renamed database and a freshly created one end up identical.
    /// </summary>
    public partial class RenameCalendarTournamentToEvent : Migration
    {
        private static readonly (string Old, string New)[] Tables =
        [
            ("scheduled_tournaments", "events"),
            ("scheduled_tournament_formats", "event_formats"),
            ("tournament_registration_attempts", "event_registration_attempts"),
            ("tournament_lifecycle_events", "event_lifecycle_entries"),
            ("tournament_proposals", "event_proposals"),
            ("tournament_proposal_recipients", "event_proposal_recipients"),
            ("consumed_tournament_preview_tickets", "consumed_event_preview_tickets")
        ];

        /// <summary>The calendar foreign-key column, per table under its NEW name.</summary>
        private static readonly (string Table, string Old, string New)[] Columns =
        [
            ("event_formats", "scheduled_tournament_id", "event_id"),
            ("event_registration_attempts", "tournament_id", "event_id"),
            ("event_lifecycle_entries", "tournament_id", "event_id"),
            ("scheduled_notifications", "tournament_id", "event_id"),
            ("notification_history", "tournament_id", "event_id")
        ];

        /// <summary>
        /// Primary keys and foreign keys, keyed by the table's NEW name — PostgreSQL has no
        /// standalone rename for either, and <see cref="MigrationBuilder"/> exposes neither.
        /// Renaming a primary-key constraint also renames the unique index backing it.
        /// </summary>
        private static readonly (string Table, string Old, string New)[] Constraints =
        [
            ("events", "pk_scheduled_tournaments", "pk_events"),
            ("event_formats", "pk_scheduled_tournament_formats", "pk_event_formats"),
            ("event_registration_attempts", "pk_tournament_registration_attempts", "pk_event_registration_attempts"),
            ("event_lifecycle_entries", "pk_tournament_lifecycle_events", "pk_event_lifecycle_entries"),
            ("event_proposals", "pk_tournament_proposals", "pk_event_proposals"),
            ("event_proposal_recipients", "pk_tournament_proposal_recipients", "pk_event_proposal_recipients"),
            ("consumed_event_preview_tickets", "pk_consumed_tournament_preview_tickets", "pk_consumed_event_preview_tickets"),

            ("events", "fk_scheduled_tournaments_asp_net_users_created_by_user_id", "fk_events_asp_net_users_created_by_user_id"),
            ("events", "fk_scheduled_tournaments_asp_net_users_deleted_by_user_id", "fk_events_asp_net_users_deleted_by_user_id"),
            ("events", "fk_scheduled_tournaments_organizations_organization_id", "fk_events_organizations_organization_id"),

            ("event_formats", "fk_scheduled_tournament_formats_scheduled_tournaments_schedule~", "fk_event_formats_events_event_id"),
            ("event_formats", "fk_scheduled_tournament_formats_tournament_formats_tournament_~", "fk_event_formats_tournament_formats_tournament_format_id"),

            ("event_registration_attempts", "fk_tournament_registration_attempts_asp_net_users_registered_by", "fk_event_registration_attempts_asp_net_users_registered_by_user_~"),
            ("event_registration_attempts", "fk_tournament_registration_attempts_asp_net_users_status_change", "fk_event_registration_attempts_asp_net_users_status_changed_by_u~"),
            ("event_registration_attempts", "fk_tournament_registration_attempts_asp_net_users_user_id", "fk_event_registration_attempts_asp_net_users_user_id"),
            ("event_registration_attempts", "fk_tournament_registration_attempts_scheduled_tournaments_tour~", "fk_event_registration_attempts_events_event_id"),

            ("event_lifecycle_entries", "fk_tournament_lifecycle_events_asp_net_users_actor_user_id", "fk_event_lifecycle_entries_asp_net_users_actor_user_id"),
            ("event_lifecycle_entries", "fk_tournament_lifecycle_events_scheduled_tournaments_tournamen~", "fk_event_lifecycle_entries_events_event_id"),

            ("event_proposals", "fk_tournament_proposals_asp_net_users_decided_by_user_id", "fk_event_proposals_asp_net_users_decided_by_user_id"),
            ("event_proposals", "fk_tournament_proposals_asp_net_users_submitted_by_user_id", "fk_event_proposals_asp_net_users_submitted_by_user_id"),

            ("event_proposal_recipients", "fk_tournament_proposal_recipients_asp_net_users_user_id", "fk_event_proposal_recipients_asp_net_users_user_id"),
            ("event_proposal_recipients", "fk_tournament_proposal_recipients_tournament_proposals_proposa~", "fk_event_proposal_recipients_event_proposals_proposal_id"),

            ("notification_history", "fk_notification_history_scheduled_tournaments_tournament_id", "fk_notification_history_events_event_id"),

            ("scheduled_notifications", "fk_scheduled_notifications_scheduled_tournaments_tournament_id", "fk_scheduled_notifications_events_event_id"),
            ("scheduled_notifications", "fk_scheduled_notifications_tournament_registration_attempts_re~", "fk_scheduled_notifications_event_registration_attempts_registr~")
        ];

        /// <summary>Indexes, keyed by the table's NEW name.</summary>
        private static readonly (string Table, string Old, string New)[] Indexes =
        [
            ("events", "ix_scheduled_tournaments_city_country", "ix_events_city_country"),
            ("events", "ix_scheduled_tournaments_created_by_user_id", "ix_events_created_by_user_id"),
            ("events", "ix_scheduled_tournaments_deleted_by_user_id", "ix_events_deleted_by_user_id"),
            ("events", "ix_scheduled_tournaments_normalized_search_text", "ix_events_normalized_search_text"),
            ("events", "ix_scheduled_tournaments_organization_id", "ix_events_organization_id"),
            ("events", "ix_scheduled_tournaments_organization_id_slug", "ix_events_organization_id_slug"),
            ("events", "ix_scheduled_tournaments_slug", "ix_events_slug"),
            ("events", "ix_scheduled_tournaments_starts_at_utc", "ix_events_starts_at_utc"),
            ("events", "ix_scheduled_tournaments_status", "ix_events_status"),
            ("events", "ix_scheduled_tournaments_status_ends_at_utc", "ix_events_status_ends_at_utc"),
            ("events", "ix_scheduled_tournaments_status_starts_at_utc", "ix_events_status_starts_at_utc"),
            ("events", "ix_scheduled_tournaments_venue_start_date_venue_start_time_id", "ix_events_venue_start_date_venue_start_time_id"),

            ("event_formats", "ix_scheduled_tournament_formats_tournament_format_id", "ix_event_formats_tournament_format_id"),

            ("event_registration_attempts", "ix_tournament_registration_attempts_active", "ix_event_registration_attempts_active"),
            ("event_registration_attempts", "ix_tournament_registration_attempts_registered_by_user_id", "ix_event_registration_attempts_registered_by_user_id"),
            ("event_registration_attempts", "ix_tournament_registration_attempts_status_changed_by_user_id", "ix_event_registration_attempts_status_changed_by_user_id"),
            ("event_registration_attempts", "ix_tournament_registration_attempts_tournament_id_status", "ix_event_registration_attempts_event_id_status"),
            ("event_registration_attempts", "ix_tournament_registration_attempts_user_id_registered_at_id", "ix_event_registration_attempts_user_id_registered_at_id"),

            ("event_lifecycle_entries", "ix_tournament_lifecycle_events_actor_user_id", "ix_event_lifecycle_entries_actor_user_id"),
            ("event_lifecycle_entries", "ix_tournament_lifecycle_events_reminder_plan_action_reminder_p~", "ix_event_lifecycle_entries_reminder_plan_action_reminder_plan_~"),
            ("event_lifecycle_entries", "ix_tournament_lifecycle_events_tournament_id_occurred_at", "ix_event_lifecycle_entries_event_id_occurred_at"),

            ("event_proposals", "ix_tournament_proposals_decided_by_user_id", "ix_event_proposals_decided_by_user_id"),
            ("event_proposals", "ix_tournament_proposals_status_expires_at", "ix_event_proposals_status_expires_at"),
            ("event_proposals", "ix_tournament_proposals_submitted_by_user_id", "ix_event_proposals_submitted_by_user_id"),

            ("event_proposal_recipients", "ix_tournament_proposal_recipients_proposal_id_user_id", "ix_event_proposal_recipients_proposal_id_user_id"),
            ("event_proposal_recipients", "ix_tournament_proposal_recipients_token_hash", "ix_event_proposal_recipients_token_hash"),
            ("event_proposal_recipients", "ix_tournament_proposal_recipients_user_id", "ix_event_proposal_recipients_user_id"),

            ("consumed_event_preview_tickets", "ix_consumed_tournament_preview_tickets_expires_at", "ix_consumed_event_preview_tickets_expires_at"),

            ("scheduled_notifications", "ix_scheduled_notifications_tournament_id_registration_attempt_~", "ix_scheduled_notifications_event_id_registration_attempt_id_st~"),
            ("notification_history", "ix_notification_history_tournament_id_sent_at", "ix_notification_history_event_id_sent_at")
        ];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var (old, renamed) in Tables)
            {
                migrationBuilder.RenameTable(name: old, newName: renamed);
            }

            foreach (var (table, old, renamed) in Columns)
            {
                migrationBuilder.RenameColumn(name: old, table: table, newName: renamed);
            }

            foreach (var (table, old, renamed) in Constraints)
            {
                RenameConstraint(migrationBuilder, table, old, renamed);
            }

            foreach (var (table, old, renamed) in Indexes)
            {
                migrationBuilder.RenameIndex(name: old, table: table, newName: renamed);
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Mirror image of Up: indexes, constraints and columns are renamed back while the tables
            // still carry their new names, then the tables themselves are renamed last.
            foreach (var (table, old, renamed) in Indexes)
            {
                migrationBuilder.RenameIndex(name: renamed, table: table, newName: old);
            }

            foreach (var (table, old, renamed) in Constraints)
            {
                RenameConstraint(migrationBuilder, table, renamed, old);
            }

            foreach (var (table, old, renamed) in Columns)
            {
                migrationBuilder.RenameColumn(name: renamed, table: table, newName: old);
            }

            foreach (var (old, renamed) in Tables)
            {
                migrationBuilder.RenameTable(name: renamed, newName: old);
            }
        }

        private static void RenameConstraint(MigrationBuilder migrationBuilder, string table, string from, string to) =>
            migrationBuilder.Sql($"""ALTER TABLE "{table}" RENAME CONSTRAINT "{from}" TO "{to}";""");
    }
}
