using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "asp_net_users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    global_role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    user_name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    normalized_user_name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    normalized_email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    email_confirmed = table.Column<bool>(type: "boolean", nullable: false),
                    password_hash = table.Column<string>(type: "text", nullable: true),
                    security_stamp = table.Column<string>(type: "text", nullable: true),
                    concurrency_stamp = table.Column<string>(type: "text", nullable: true),
                    phone_number = table.Column<string>(type: "text", nullable: true),
                    phone_number_confirmed = table.Column<bool>(type: "boolean", nullable: false),
                    two_factor_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    lockout_end = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    lockout_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    access_failed_count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_asp_net_users", x => x.id);
                    table.CheckConstraint("ck_asp_net_users_global_role", "global_role IN ('User', 'Organizer', 'Admin')");
                });

            migrationBuilder.CreateTable(
                name: "consumed_event_preview_tickets",
                columns: table => new
                {
                    ticket_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_consumed_event_preview_tickets", x => x.ticket_hash);
                });

            migrationBuilder.CreateTable(
                name: "deck_archetypes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    normalized_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_deck_archetypes", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "idempotency_records",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    scope = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    response_status_code = table.Column<int>(type: "integer", nullable: false),
                    response_body = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_idempotency_records", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "league_archive_aggregates",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    canonical_document = table.Column<string>(type: "jsonb", nullable: false),
                    tournament_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    player_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    counts_version = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_league_archive_aggregates", x => x.id);
                    table.CheckConstraint("ck_league_aggregate_document_metadata", "canonical_document ->> 'id' = document_id AND canonical_document ->> 'name' = name AND canonical_document ->> 'status' = status");
                    table.CheckConstraint("ck_league_aggregate_document_object", "jsonb_typeof(canonical_document) = 'object'");
                    table.CheckConstraint("ck_league_aggregate_document_size", "octet_length(canonical_document::text) <= 1048576");
                    table.CheckConstraint("ck_league_aggregate_status", "status IN ('active', 'completed')");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "live_aggregates",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    tournament_date = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    stage = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    canonical_document = table.Column<string>(type: "jsonb", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_live_aggregates", x => x.id);
                    table.CheckConstraint("ck_live_aggregate_checkpoint_bound", "jsonb_array_length(canonical_document -> 'checkpoints') <= 80");
                    table.CheckConstraint("ck_live_aggregate_document_metadata", "canonical_document ->> 'id' = document_id AND canonical_document ->> 'name' = name AND canonical_document ->> 'tournamentDate' = tournament_date AND canonical_document ->> 'stage' = stage");
                    table.CheckConstraint("ck_live_aggregate_document_object", "jsonb_typeof(canonical_document) = 'object'");
                    table.CheckConstraint("ck_live_aggregate_document_size", "octet_length(canonical_document::text) <= 1048576");
                    table.CheckConstraint("ck_live_aggregate_stage", "stage IN ('registration', 'round', 'standings', 'completed')");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "notification_outbox",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    dedupe_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    template_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    locale = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    recipient = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: true),
                    template_model_json = table.Column<string>(type: "jsonb", nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    tournament_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    available_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    lease_token = table.Column<Guid>(type: "uuid", nullable: true),
                    lease_expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    last_attempt_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    attempt_count = table.Column<int>(type: "integer", nullable: false),
                    last_error_code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    sent_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    dead_lettered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    scrubbed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    provider_first_attempt_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    provider_message_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    delivery_status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    last_provider_event_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    delivery_metadata_scrubbed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    trace_parent = table.Column<string>(type: "character varying(55)", maxLength: 55, nullable: true),
                    correlation_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notification_outbox", x => x.id);
                    table.CheckConstraint("ck_notification_outbox_attempt_count", "attempt_count >= 0");
                    table.CheckConstraint("ck_notification_outbox_state", "(status = 'Pending' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)\nOR (status = 'Sending' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)\nOR (status = 'Sent' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NOT NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NOT NULL AND recipient IS NULL AND template_model_json IS NULL)\nOR (status = 'Reconciliation' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NULL AND scrubbed_at IS NULL AND recipient IS NOT NULL AND template_model_json IS NOT NULL)\nOR (status = 'DeadLetter' AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL AND dead_lettered_at IS NOT NULL AND scrubbed_at IS NOT NULL AND recipient IS NULL AND template_model_json IS NULL)");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "organizations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    normalized_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    website = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    contact_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organizations", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "outbox_records",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    message_type = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    occurred_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    processed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    attempt_count = table.Column<int>(type: "integer", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_outbox_records", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "player_statistics",
                columns: table => new
                {
                    player_name = table.Column<string>(type: "text", nullable: false),
                    played_match_count = table.Column<int>(type: "integer", nullable: false),
                    match_wins = table.Column<int>(type: "integer", nullable: false),
                    match_losses = table.Column<int>(type: "integer", nullable: false),
                    match_draws = table.Column<int>(type: "integer", nullable: false),
                    match_winrate = table.Column<double>(type: "double precision", nullable: true),
                    played_game_count = table.Column<int>(type: "integer", nullable: false),
                    game_wins = table.Column<int>(type: "integer", nullable: false),
                    game_losses = table.Column<int>(type: "integer", nullable: false),
                    game_winrate = table.Column<double>(type: "double precision", nullable: true),
                    nemesis = table.Column<string>(type: "jsonb", nullable: true),
                    rival = table.Column<string>(type: "jsonb", nullable: true),
                    most_played_archetype = table.Column<string>(type: "jsonb", nullable: true),
                    rating = table.Column<double>(type: "double precision", nullable: false),
                    rating_deviation = table.Column<double>(type: "double precision", nullable: false),
                    rating_volatility = table.Column<double>(type: "double precision", nullable: false),
                    previous_rating = table.Column<double>(type: "double precision", nullable: false),
                    last_rating_delta = table.Column<double>(type: "double precision", nullable: false),
                    tournaments_played = table.Column<int>(type: "integer", nullable: false),
                    last_played_date = table.Column<string>(type: "text", nullable: true),
                    decayed_rating = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_player_statistics", x => x.player_name);
                });

            migrationBuilder.CreateTable(
                name: "player_statistics_meta",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false),
                    formula_version = table.Column<int>(type: "integer", nullable: false),
                    rebuilt_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_player_statistics_meta", x => x.id);
                    table.CheckConstraint("ck_player_statistics_meta_single_row", "id = 1");
                });

            migrationBuilder.CreateTable(
                name: "schema_versions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    applied_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_schema_versions", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "system_markers",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    consumed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    consumed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_system_markers", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "tournament_formats",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    slug = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_tournament_formats", x => x.id);
                    table.CheckConstraint("ck_tournament_format_sort_order", "sort_order >= 0");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                });

            migrationBuilder.CreateTable(
                name: "worker_heartbeats",
                columns: table => new
                {
                    worker_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    last_seen_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_worker_heartbeats", x => x.worker_id);
                });

            migrationBuilder.CreateTable(
                name: "account_action_tokens",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    purpose = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    token_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    security_stamp = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    target_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    normalized_target_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    consumed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    superseded_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_account_action_tokens", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_account_action_tokens_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "asp_net_user_claims",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    claim_type = table.Column<string>(type: "text", nullable: true),
                    claim_value = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_asp_net_user_claims", x => x.id);
                    table.ForeignKey(
                        name: "fk_asp_net_user_claims_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "asp_net_user_logins",
                columns: table => new
                {
                    login_provider = table.Column<string>(type: "text", nullable: false),
                    provider_key = table.Column<string>(type: "text", nullable: false),
                    provider_display_name = table.Column<string>(type: "text", nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_asp_net_user_logins", x => new { x.login_provider, x.provider_key });
                    table.ForeignKey(
                        name: "fk_asp_net_user_logins_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "asp_net_user_tokens",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    login_provider = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    value = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_asp_net_user_tokens", x => new { x.user_id, x.login_provider, x.name });
                    table.ForeignKey(
                        name: "fk_asp_net_user_tokens_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "audit_records",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_id = table.Column<Guid>(type: "uuid", nullable: true),
                    action = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    entity_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    entity_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    redacted_diff = table.Column<string>(type: "jsonb", nullable: false),
                    occurred_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_audit_records", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_audit_records_asp_net_users_actor_id",
                        column: x => x.actor_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "event_proposals",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    submitted_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    payload_json = table.Column<string>(type: "jsonb", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    decided_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    decided_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    rejection_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_proposals", x => x.id);
                    table.CheckConstraint("ck_tournament_proposal_decision", "(status = 'Pending' AND decided_at IS NULL AND rejection_reason IS NULL) OR (status <> 'Pending' AND decided_at IS NOT NULL)");
                    table.CheckConstraint("ck_tournament_proposal_expiry", "expires_at > created_at");
                    table.CheckConstraint("ck_tournament_proposal_status", "status IN ('Pending', 'Approved', 'Rejected')");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_event_proposals_asp_net_users_decided_by_user_id",
                        column: x => x.decided_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_event_proposals_asp_net_users_submitted_by_user_id",
                        column: x => x.submitted_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "external_identities",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    provider_subject = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    provider_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    provider_email_verified = table.Column<bool>(type: "boolean", nullable: false),
                    provider_email_updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_external_identities", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_external_identities_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "oauth_attempts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    purpose = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    state_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    correlation_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    completion_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    email_verification_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    provider_subject = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    provider_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    provider_email_verified = table.Column<bool>(type: "boolean", nullable: false),
                    proposed_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    proposed_username = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    proposed_first_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    proposed_last_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    consumed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_oauth_attempts", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_oauth_attempts_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "refresh_sessions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    security_stamp = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    device_label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    last_used_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    idle_expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    absolute_expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    revocation_reason = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_refresh_sessions", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_refresh_sessions_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_email_histories",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    recorded_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    retain_until = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    redacted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_email_histories", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_user_email_histories_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_profiles",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    username = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    normalized_username = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    first_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    last_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    location_country = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    location_region = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    location_city = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    birth_date = table.Column<LocalDate>(type: "date", nullable: true),
                    preferred_language = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    is_first_name_public = table.Column<bool>(type: "boolean", nullable: false),
                    is_last_name_public = table.Column<bool>(type: "boolean", nullable: false),
                    is_location_public = table.Column<bool>(type: "boolean", nullable: false),
                    is_birth_date_public = table.Column<bool>(type: "boolean", nullable: false),
                    is_preferred_language_public = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    closed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_profiles", x => x.id);
                    table.CheckConstraint("ck_user_profile_birth_date", "birth_date IS NULL OR birth_date >= DATE '1900-01-01'");
                    table.CheckConstraint("ck_user_profile_language", "preferred_language IN ('fr', 'en')");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_user_profiles_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "notification_delivery_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    replay_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    outbox_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider_message_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    occurred_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    received_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notification_delivery_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_notification_delivery_events_notification_outbox_outbox_id",
                        column: x => x.outbox_id,
                        principalTable: "notification_outbox",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    slug = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    summary = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    body_html = table.Column<string>(type: "character varying(10000)", maxLength: 10000, nullable: true),
                    live_tournament_url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    archive_tournament_url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    street_address = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    postal_code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    city = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    country = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    time_zone_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    venue_start_date = table.Column<LocalDate>(type: "date", nullable: false),
                    venue_start_time = table.Column<LocalTime>(type: "time", nullable: false),
                    venue_end_date = table.Column<LocalDate>(type: "date", nullable: false),
                    venue_end_time = table.Column<LocalTime>(type: "time", nullable: false),
                    starts_at_utc = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    ends_at_utc = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    capacity = table.Column<int>(type: "integer", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    deleted_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    deleted_reason = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    normalized_search_text = table.Column<string>(type: "character varying(600)", maxLength: 600, nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_events", x => x.id);
                    table.CheckConstraint("ck_scheduled_tournament_capacity", "capacity IS NULL OR capacity > 0");
                    table.CheckConstraint("ck_scheduled_tournament_deleted_metadata", "(deleted_at IS NULL AND deleted_by_user_id IS NULL) OR (deleted_at IS NOT NULL AND deleted_by_user_id IS NOT NULL)");
                    table.CheckConstraint("ck_scheduled_tournament_status", "status IN ('Published', 'InProgress', 'Completed', 'Cancelled')");
                    table.CheckConstraint("ck_scheduled_tournament_time_order", "ends_at_utc >= starts_at_utc");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_events_asp_net_users_created_by_user_id",
                        column: x => x.created_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_events_asp_net_users_deleted_by_user_id",
                        column: x => x.deleted_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_events_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organization_blocked_users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    blocked_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    blocked_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    unblocked_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    unblocked_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organization_blocked_users", x => x.id);
                    table.CheckConstraint("ck_organization_block_expiry", "expires_at IS NULL OR expires_at > blocked_at");
                    table.CheckConstraint("ck_organization_block_inactive_metadata", "(is_active AND unblocked_by_user_id IS NULL AND unblocked_at IS NULL) OR (NOT is_active AND unblocked_by_user_id IS NOT NULL AND unblocked_at IS NOT NULL)");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_organization_blocked_users_asp_net_users_blocked_by_user_id",
                        column: x => x.blocked_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_organization_blocked_users_asp_net_users_unblocked_by_user_id",
                        column: x => x.unblocked_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_organization_blocked_users_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_organization_blocked_users_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organization_members",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organization_members", x => x.id);
                    table.CheckConstraint("ck_organization_member_role", "role IN ('Owner', 'Organizer')");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_organization_members_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_organization_members_organizations_organization_id",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "organization_notification_settings",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organization_id = table.Column<Guid>(type: "uuid", nullable: false),
                    notify_on_registration = table.Column<bool>(type: "boolean", nullable: false),
                    notify_on_unregistration = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_organization_notification_settings", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_organization_notification_settings_organizations_organizati~",
                        column: x => x.organization_id,
                        principalTable: "organizations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "event_proposal_recipients",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    proposal_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    sent_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_proposal_recipients", x => x.id);
                    table.CheckConstraint("ck_tournament_proposal_recipient_token_hash", "token_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_event_proposal_recipients_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_event_proposal_recipients_event_proposals_proposal_id",
                        column: x => x.proposal_id,
                        principalTable: "event_proposals",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "refresh_tokens",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    session_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    used_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    revoked_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    replaced_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_refresh_tokens", x => x.id);
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_refresh_tokens_refresh_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "refresh_sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_refresh_tokens_refresh_tokens_replaced_by_id",
                        column: x => x.replaced_by_id,
                        principalTable: "refresh_tokens",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_formats",
                columns: table => new
                {
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tournament_format_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_formats", x => new { x.event_id, x.tournament_format_id });
                    table.ForeignKey(
                        name: "fk_event_formats_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_event_formats_tournament_formats_tournament_format_id",
                        column: x => x.tournament_format_id,
                        principalTable: "tournament_formats",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_lifecycle_entries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    reminder_plan_action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    occurred_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    reminder_plan_processed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_lifecycle_entries", x => x.id);
                    table.CheckConstraint("ck_tournament_lifecycle_event_type", "event_type IN ('MajorDetailsUpdated', 'Cancelled', 'Deleted', 'Restored')");
                    table.CheckConstraint("ck_tournament_lifecycle_reminder_action", "reminder_plan_action IN ('None', 'RecalculateFuture', 'CancelFuture')");
                    table.ForeignKey(
                        name: "fk_event_lifecycle_entries_asp_net_users_actor_user_id",
                        column: x => x.actor_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_event_lifecycle_entries_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_attempts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    registered_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    registered_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    status_changed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status_changed_at = table.Column<Instant>(type: "timestamp with time zone", nullable: true),
                    version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_event_registration_attempts", x => x.id);
                    table.CheckConstraint("ck_tournament_registration_status", "status IN ('Confirmed', 'CancelledByUser', 'CancelledByTournament', 'RemovedByOrganizer')");
                    table.CheckConstraint("ck_tournament_registration_status_history", "(status = 'Confirmed' AND status_changed_by_user_id IS NULL AND status_changed_at IS NULL) OR (status <> 'Confirmed' AND status_changed_by_user_id IS NOT NULL AND status_changed_at IS NOT NULL)");
                    table.CheckConstraint("ck_version_positive", "version > 0");
                    table.ForeignKey(
                        name: "fk_event_registration_attempts_asp_net_users_registered_by_user_~",
                        column: x => x.registered_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_event_registration_attempts_asp_net_users_status_changed_by_u~",
                        column: x => x.status_changed_by_user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_event_registration_attempts_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_event_registration_attempts_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "notification_history",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    outbox_id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    dedupe_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    event_id = table.Column<Guid>(type: "uuid", nullable: true),
                    sent_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notification_history", x => x.id);
                    table.ForeignKey(
                        name: "fk_notification_history_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_notification_history_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_notification_history_notification_outbox_outbox_id",
                        column: x => x.outbox_id,
                        principalTable: "notification_outbox",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "scheduled_notifications",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    registration_attempt_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    scheduled_at_utc = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    dedupe_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<Instant>(type: "timestamp with time zone", nullable: false),
                    outbox_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_scheduled_notifications", x => x.id);
                    table.CheckConstraint("ck_scheduled_notification_outbox", "(status = 'Enqueued' AND outbox_id IS NOT NULL) OR (status <> 'Enqueued' AND outbox_id IS NULL)");
                    table.CheckConstraint("ck_scheduled_notification_status", "status IN ('Planned', 'Enqueued', 'Missed', 'Cancelled')");
                    table.CheckConstraint("ck_scheduled_notification_type", "type IN ('Monthly', 'Saturday', 'DayTwo', 'DayOne')");
                    table.ForeignKey(
                        name: "fk_scheduled_notifications_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_scheduled_notifications_event_registration_attempts_registr~",
                        column: x => x.registration_attempt_id,
                        principalTable: "event_registration_attempts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_scheduled_notifications_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_scheduled_notifications_notification_outbox_outbox_id",
                        column: x => x.outbox_id,
                        principalTable: "notification_outbox",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_account_action_tokens_token_hash",
                table: "account_action_tokens",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_account_action_tokens_user_id_purpose",
                table: "account_action_tokens",
                columns: new[] { "user_id", "purpose" },
                unique: true,
                filter: "consumed_at IS NULL AND superseded_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_asp_net_user_claims_user_id",
                table: "asp_net_user_claims",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_asp_net_user_logins_user_id",
                table: "asp_net_user_logins",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "email_index",
                table: "asp_net_users",
                column: "normalized_email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_asp_net_users_global_role",
                table: "asp_net_users",
                column: "global_role");

            migrationBuilder.CreateIndex(
                name: "user_name_index",
                table: "asp_net_users",
                column: "normalized_user_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_audit_records_actor_id",
                table: "audit_records",
                column: "actor_id");

            migrationBuilder.CreateIndex(
                name: "ix_audit_records_entity_type_entity_id",
                table: "audit_records",
                columns: new[] { "entity_type", "entity_id" });

            migrationBuilder.CreateIndex(
                name: "ix_audit_records_occurred_at",
                table: "audit_records",
                column: "occurred_at");

            migrationBuilder.CreateIndex(
                name: "ix_consumed_event_preview_tickets_expires_at",
                table: "consumed_event_preview_tickets",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "ix_deck_archetypes_deleted_at_name",
                table: "deck_archetypes",
                columns: new[] { "deleted_at", "name" });

            migrationBuilder.CreateIndex(
                name: "ix_deck_archetypes_normalized_name",
                table: "deck_archetypes",
                column: "normalized_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_event_formats_event_id",
                table: "event_formats",
                column: "event_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_event_formats_tournament_format_id",
                table: "event_formats",
                column: "tournament_format_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_lifecycle_entries_actor_user_id",
                table: "event_lifecycle_entries",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_lifecycle_entries_event_id_occurred_at",
                table: "event_lifecycle_entries",
                columns: new[] { "event_id", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "ix_event_lifecycle_entries_reminder_plan_action_reminder_plan_~",
                table: "event_lifecycle_entries",
                columns: new[] { "reminder_plan_action", "reminder_plan_processed_at", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "ix_event_proposal_recipients_proposal_id_user_id",
                table: "event_proposal_recipients",
                columns: new[] { "proposal_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_event_proposal_recipients_token_hash",
                table: "event_proposal_recipients",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_event_proposal_recipients_user_id",
                table: "event_proposal_recipients",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_proposals_decided_by_user_id",
                table: "event_proposals",
                column: "decided_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_proposals_status_expires_at",
                table: "event_proposals",
                columns: new[] { "status", "expires_at" });

            migrationBuilder.CreateIndex(
                name: "ix_event_proposals_submitted_by_user_id",
                table: "event_proposals",
                column: "submitted_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_registration_attempts_active",
                table: "event_registration_attempts",
                columns: new[] { "event_id", "user_id" },
                unique: true,
                filter: "status = 'Confirmed'");

            migrationBuilder.CreateIndex(
                name: "ix_event_registration_attempts_event_id_status",
                table: "event_registration_attempts",
                columns: new[] { "event_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_event_registration_attempts_registered_by_user_id",
                table: "event_registration_attempts",
                column: "registered_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_registration_attempts_status_changed_by_user_id",
                table: "event_registration_attempts",
                column: "status_changed_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_event_registration_attempts_user_id_registered_at_id",
                table: "event_registration_attempts",
                columns: new[] { "user_id", "registered_at", "id" });

            migrationBuilder.CreateIndex(
                name: "ix_events_city_country",
                table: "events",
                columns: new[] { "city", "country" });

            migrationBuilder.CreateIndex(
                name: "ix_events_created_by_user_id",
                table: "events",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_events_deleted_by_user_id",
                table: "events",
                column: "deleted_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_events_normalized_search_text",
                table: "events",
                column: "normalized_search_text");

            migrationBuilder.CreateIndex(
                name: "ix_events_organization_id",
                table: "events",
                column: "organization_id");

            migrationBuilder.CreateIndex(
                name: "ix_events_organization_id_slug",
                table: "events",
                columns: new[] { "organization_id", "slug" });

            migrationBuilder.CreateIndex(
                name: "ix_events_slug",
                table: "events",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_events_starts_at_utc",
                table: "events",
                column: "starts_at_utc");

            migrationBuilder.CreateIndex(
                name: "ix_events_status",
                table: "events",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_events_status_ends_at_utc",
                table: "events",
                columns: new[] { "status", "ends_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_events_status_starts_at_utc",
                table: "events",
                columns: new[] { "status", "starts_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_events_venue_start_date_venue_start_time_id",
                table: "events",
                columns: new[] { "venue_start_date", "venue_start_time", "id" });

            migrationBuilder.CreateIndex(
                name: "ix_external_identities_provider_provider_subject",
                table: "external_identities",
                columns: new[] { "provider", "provider_subject" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_external_identities_user_id_provider",
                table: "external_identities",
                columns: new[] { "user_id", "provider" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_idempotency_records_expires_at",
                table: "idempotency_records",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "ix_idempotency_records_scope_key",
                table: "idempotency_records",
                columns: new[] { "scope", "key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_counts_version",
                table: "league_archive_aggregates",
                column: "counts_version");

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_deleted_at_updated_at_id",
                table: "league_archive_aggregates",
                columns: new[] { "deleted_at", "updated_at", "id" },
                descending: new[] { false, true, false });

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_document_id",
                table: "league_archive_aggregates",
                column: "document_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_name",
                table: "league_archive_aggregates",
                column: "name");

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_status",
                table: "league_archive_aggregates",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_league_archive_aggregates_version",
                table: "league_archive_aggregates",
                column: "version");

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_deleted_at_updated_at_id",
                table: "live_aggregates",
                columns: new[] { "deleted_at", "updated_at", "id" },
                descending: new[] { false, true, false });

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_document_id",
                table: "live_aggregates",
                column: "document_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_name",
                table: "live_aggregates",
                column: "name");

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_stage",
                table: "live_aggregates",
                column: "stage");

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_tournament_date",
                table: "live_aggregates",
                column: "tournament_date");

            migrationBuilder.CreateIndex(
                name: "ix_live_aggregates_version",
                table: "live_aggregates",
                column: "version");

            migrationBuilder.CreateIndex(
                name: "ix_notification_delivery_events_outbox_id",
                table: "notification_delivery_events",
                column: "outbox_id");

            migrationBuilder.CreateIndex(
                name: "ix_notification_delivery_events_received_at",
                table: "notification_delivery_events",
                column: "received_at");

            migrationBuilder.CreateIndex(
                name: "ix_notification_delivery_events_replay_key",
                table: "notification_delivery_events",
                column: "replay_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_notification_history_event_id_sent_at",
                table: "notification_history",
                columns: new[] { "event_id", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_history_outbox_id",
                table: "notification_history",
                column: "outbox_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_notification_history_user_id_sent_at",
                table: "notification_history",
                columns: new[] { "user_id", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_created_at",
                table: "notification_outbox",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_dedupe_key",
                table: "notification_outbox",
                column: "dedupe_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_last_provider_event_at",
                table: "notification_outbox",
                column: "last_provider_event_at");

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_provider_message_id",
                table: "notification_outbox",
                column: "provider_message_id");

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_status_available_at_created_at",
                table: "notification_outbox",
                columns: new[] { "status", "available_at", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_status_created_at",
                table: "notification_outbox",
                columns: new[] { "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_status_last_provider_event_at",
                table: "notification_outbox",
                columns: new[] { "status", "last_provider_event_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_status_lease_expires_at",
                table: "notification_outbox",
                columns: new[] { "status", "lease_expires_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_tournament_id",
                table: "notification_outbox",
                column: "tournament_id");

            migrationBuilder.CreateIndex(
                name: "ix_notification_outbox_user_id",
                table: "notification_outbox",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_oauth_attempts_completion_hash",
                table: "oauth_attempts",
                column: "completion_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_oauth_attempts_email_verification_hash",
                table: "oauth_attempts",
                column: "email_verification_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_oauth_attempts_expires_at",
                table: "oauth_attempts",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "ix_oauth_attempts_state_hash",
                table: "oauth_attempts",
                column: "state_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_oauth_attempts_user_id",
                table: "oauth_attempts",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_organization_blocked_users_active",
                table: "organization_blocked_users",
                columns: new[] { "organization_id", "user_id" },
                unique: true,
                filter: "is_active");

            migrationBuilder.CreateIndex(
                name: "ix_organization_blocked_users_blocked_by_user_id",
                table: "organization_blocked_users",
                column: "blocked_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_organization_blocked_users_organization_id_user_id_expires_~",
                table: "organization_blocked_users",
                columns: new[] { "organization_id", "user_id", "expires_at" });

            migrationBuilder.CreateIndex(
                name: "ix_organization_blocked_users_unblocked_by_user_id",
                table: "organization_blocked_users",
                column: "unblocked_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_organization_blocked_users_user_id",
                table: "organization_blocked_users",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_organization_members_one_owner",
                table: "organization_members",
                column: "organization_id",
                unique: true,
                filter: "role = 'Owner'");

            migrationBuilder.CreateIndex(
                name: "ix_organization_members_organization_id_user_id",
                table: "organization_members",
                columns: new[] { "organization_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_organization_members_user_id_organization_id",
                table: "organization_members",
                columns: new[] { "user_id", "organization_id" });

            migrationBuilder.CreateIndex(
                name: "ix_organization_notification_settings_organization_id",
                table: "organization_notification_settings",
                column: "organization_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_organizations_deleted_at_name",
                table: "organizations",
                columns: new[] { "deleted_at", "name" });

            migrationBuilder.CreateIndex(
                name: "ix_organizations_normalized_name",
                table: "organizations",
                column: "normalized_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_outbox_records_processed_at_occurred_at",
                table: "outbox_records",
                columns: new[] { "processed_at", "occurred_at" });

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_game_losses",
                table: "player_statistics",
                column: "game_losses");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_game_winrate",
                table: "player_statistics",
                column: "game_winrate");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_game_wins",
                table: "player_statistics",
                column: "game_wins");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_match_draws",
                table: "player_statistics",
                column: "match_draws");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_match_losses",
                table: "player_statistics",
                column: "match_losses");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_match_winrate",
                table: "player_statistics",
                column: "match_winrate");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_match_wins",
                table: "player_statistics",
                column: "match_wins");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_played_game_count",
                table: "player_statistics",
                column: "played_game_count");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_played_match_count",
                table: "player_statistics",
                column: "played_match_count");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_player_name_pattern",
                table: "player_statistics",
                column: "player_name")
                .Annotation("Npgsql:IndexOperators", new[] { "text_pattern_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_rating",
                table: "player_statistics",
                column: "rating");

            migrationBuilder.CreateIndex(
                name: "ix_player_statistics_tournaments_played",
                table: "player_statistics",
                column: "tournaments_played");

            migrationBuilder.CreateIndex(
                name: "ix_refresh_sessions_user_id_revoked_at",
                table: "refresh_sessions",
                columns: new[] { "user_id", "revoked_at" });

            migrationBuilder.CreateIndex(
                name: "ix_refresh_tokens_replaced_by_id",
                table: "refresh_tokens",
                column: "replaced_by_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_refresh_tokens_session_id",
                table: "refresh_tokens",
                column: "session_id");

            migrationBuilder.CreateIndex(
                name: "ix_refresh_tokens_token_hash",
                table: "refresh_tokens",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_dedupe_key",
                table: "scheduled_notifications",
                column: "dedupe_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_event_id_registration_attempt_id_st~",
                table: "scheduled_notifications",
                columns: new[] { "event_id", "registration_attempt_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_outbox_id",
                table: "scheduled_notifications",
                column: "outbox_id");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_registration_attempt_id",
                table: "scheduled_notifications",
                column: "registration_attempt_id");

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_status_scheduled_at_utc_id",
                table: "scheduled_notifications",
                columns: new[] { "status", "scheduled_at_utc", "id" });

            migrationBuilder.CreateIndex(
                name: "ix_scheduled_notifications_user_id",
                table: "scheduled_notifications",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_schema_versions_name",
                table: "schema_versions",
                column: "name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_system_markers_key",
                table: "system_markers",
                column: "key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_tournament_formats_deleted_at_sort_order_name",
                table: "tournament_formats",
                columns: new[] { "deleted_at", "sort_order", "name" });

            migrationBuilder.CreateIndex(
                name: "ix_tournament_formats_slug",
                table: "tournament_formats",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_user_email_histories_redacted_at_retain_until",
                table: "user_email_histories",
                columns: new[] { "redacted_at", "retain_until" });

            migrationBuilder.CreateIndex(
                name: "ix_user_email_histories_user_id_recorded_at",
                table: "user_email_histories",
                columns: new[] { "user_id", "recorded_at" });

            migrationBuilder.CreateIndex(
                name: "ix_user_profiles_normalized_username",
                table: "user_profiles",
                column: "normalized_username",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_user_profiles_user_id",
                table: "user_profiles",
                column: "user_id",
                unique: true);

            // ---- Carried from 20260724112436_AppendOnlyAuditGuard and 20260808164636_AllowAccountHardDelete.
            // audit_records is append-only at the database level. The guard is narrowed to tolerate
            // exactly one change — a hard account deletion nulling actor_id and changing nothing else —
            // so the audit row outlives the account. Every other update, delete and truncate raises 55000.
            // EF's model diff cannot express a function, a trigger or a grant, so this is hand-written.
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

                CREATE TRIGGER audit_records_append_only
                BEFORE UPDATE OR DELETE ON audit_records
                FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

                CREATE TRIGGER audit_records_no_truncate
                BEFORE TRUNCATE ON audit_records
                FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

                REVOKE UPDATE, DELETE, TRUNCATE ON audit_records FROM PUBLIC;
                """);

            // The application role may only write audit rows; nulling the actor is the single column
            // it is allowed to update. The role is absent from throwaway test databases.
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'gones_app') THEN
                        EXECUTE 'GRANT UPDATE (actor_id) ON audit_records TO gones_app';
                    END IF;
                END $$;
                """);

            // ---- Carried from 20260801152724_AddAdminBootstrapAndFormats.
            migrationBuilder.Sql("""
                INSERT INTO tournament_formats (id, name, slug, sort_order, created_at, updated_at, deleted_at, version)
                VALUES ('00000000-0000-0000-0000-0000000000f1', 'Legacy', 'legacy', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1)
                ON CONFLICT (slug) DO NOTHING;
                """);

            // ---- Carried from 20260805105726_AddDeckArchetypeCatalog. 49 rows; the count is asserted by
            // DeckArchetypeCatalogApiTests.Public_deck_archetypes_lists_seeded_legacy_presets against
            // DeckArchetypePresets.LegacyNames.Count.
            migrationBuilder.Sql("""
                INSERT INTO deck_archetypes (id, name, normalized_name, created_at, updated_at, deleted_at, version)
                VALUES
                ('00000000-0000-0000-00c3-000000000001', 'Reanimator (Rakdos)', 'reanimator (rakdos)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000002', 'Tempo (Dimir)', 'tempo (dimir)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000003', 'Delver (Izzet)', 'delver (izzet)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000004', 'Show and Tell (Blue)', 'show and tell (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000005', 'Sneak and Show (Izzet)', 'sneak and show (izzet)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000006', 'Cephalid Breakfast (Simic)', 'cephalid breakfast (simic)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000007', 'Dragon Stompy (Red)', 'dragon stompy (red)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000008', 'Eldrazi (Colorless)', 'eldrazi (colorless)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000009', 'Mystic Forge (Colorless)', 'mystic forge (colorless)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000010', 'Death and Taxes (White)', 'death and taxes (white)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000011', 'Control (UWx)', 'control (uwx)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000012', 'Lands (Gruul)', 'lands (gruul)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000013', 'Cloudpost (Blue)', 'cloudpost (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000014', 'Oops All Spells (Jund)', 'oops all spells (jund)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000015', 'Nadu (Simic)', 'nadu (simic)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000016', 'Painter (Red)', 'painter (red)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000017', 'Doomsday (Dimir)', 'doomsday (dimir)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000018', 'Canadian Threshold (Temur)', 'canadian threshold (temur)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000019', 'Artifacts (Blue)', 'artifacts (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000020', 'The EPIC Storm (Grixis)', 'the epic storm (grixis)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000021', 'Initiative Stompy (White)', 'initiative stompy (white)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000022', 'Energy (Mardu)', 'energy (mardu)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000023', 'Energy (Boros)', 'energy (boros)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000024', 'Maverick (Selesnya)', 'maverick (selesnya)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000025', 'Ninjas (Dimir)', 'ninjas (dimir)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000026', 'Control (Grixis)', 'control (grixis)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000027', 'Control (Sultai)', 'control (sultai)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000028', 'Control (Bant)', 'control (bant)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000029', 'Stoneblade (Azorius)', 'stoneblade (azorius)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000030', 'Cradle Control (Green)', 'cradle control (green)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000031', 'Stiflenought (Blue)', 'stiflenought (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000032', 'Dark Depths (Golgari)', 'dark depths (golgari)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000033', 'Goblins (Red)', 'goblins (red)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000034', 'Merfolk (Blue)', 'merfolk (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000035', 'Dredge (Black)', 'dredge (black)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000036', 'Elves (Green)', 'elves (green)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000037', 'Aluren (Sultai)', 'aluren (sultai)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000038', 'Infect (Simic)', 'infect (simic)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000039', 'Storm (Red)', 'storm (red)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000040', 'Turbo Depths (Golgari)', 'turbo depths (golgari)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000041', 'Affinity (Blue)', 'affinity (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000042', 'Burn (Red)', 'burn (red)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000043', 'Humans (White)', 'humans (white)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000044', 'Pox (Black)', 'pox (black)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000045', 'Nic Fit (Golgari)', 'nic fit (golgari)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000046', 'Reanimator (Black)', 'reanimator (black)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000047', 'Omni-Tell (Blue)', 'omni-tell (blue)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000048', 'Control (Jeskai)', 'control (jeskai)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                ('00000000-0000-0000-00c3-000000000049', 'Beanstalk Control (Bant)', 'beanstalk control (bant)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1)
                ON CONFLICT (normalized_name) DO NOTHING;
                """);

            // ---- Carried from 20260802204547_AddLeagueAggregates, retargeted at the table's final name.
            // The fixed placeholder League. LeagueArchiveAggregate.Delete refuses to delete it,
            // MigrationImportService calls SingleAsync on it, and scripts/seed-local.mjs asserts it.
            // Retired at T17 with the rest of the legacy archive, not here.
            migrationBuilder.InsertData(
                table: "league_archive_aggregates",
                columns: new[] { "id", "document_id", "name", "status", "updated_at", "deleted_at", "canonical_document", "version" },
                values: new object[]
                {
                    new Guid("00000000-0000-0000-0000-000000000030"),
                    "placeholder-league",
                    "Unassigned Tournaments",
                    "active",
                    Instant.FromUtc(2026, 8, 3, 0, 0),
                    null,
                    "{\"id\":\"placeholder-league\",\"name\":\"Unassigned Tournaments\",\"status\":\"active\",\"tournaments\":[]}",
                    1L
                });

            // ---- Carried from the historical AddColumn(defaultValue:) backfills
            // (20260820160349_AddPlayerRatingColumns, 20260802173103_AddOrganizerParticipantManagement).
            // EF applies defaultValue: when it adds a NOT NULL column to a populated table, and the
            // DEFAULT persists in PostgreSQL afterwards. The model never declares these, so the model
            // diff cannot regenerate them and they are carried by hand — otherwise the squash would
            // silently drop eight column defaults. Literals are taken from the pre-squash pg_dump.
            migrationBuilder.Sql("""
                ALTER TABLE player_statistics ALTER COLUMN rating SET DEFAULT 1500.0;
                ALTER TABLE player_statistics ALTER COLUMN previous_rating SET DEFAULT 1500.0;
                ALTER TABLE player_statistics ALTER COLUMN decayed_rating SET DEFAULT 1500.0;
                ALTER TABLE player_statistics ALTER COLUMN rating_deviation SET DEFAULT 350.0;
                ALTER TABLE player_statistics ALTER COLUMN rating_volatility SET DEFAULT 0.059999999999999998;
                ALTER TABLE player_statistics ALTER COLUMN last_rating_delta SET DEFAULT 0.0;
                ALTER TABLE player_statistics ALTER COLUMN tournaments_played SET DEFAULT 0;
                ALTER TABLE organization_blocked_users ALTER COLUMN reason SET DEFAULT 'Unspecified';
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

            migrationBuilder.DropTable(
                name: "account_action_tokens");

            migrationBuilder.DropTable(
                name: "asp_net_user_claims");

            migrationBuilder.DropTable(
                name: "asp_net_user_logins");

            migrationBuilder.DropTable(
                name: "asp_net_user_tokens");

            migrationBuilder.DropTable(
                name: "audit_records");

            migrationBuilder.DropTable(
                name: "consumed_event_preview_tickets");

            migrationBuilder.DropTable(
                name: "deck_archetypes");

            migrationBuilder.DropTable(
                name: "event_formats");

            migrationBuilder.DropTable(
                name: "event_lifecycle_entries");

            migrationBuilder.DropTable(
                name: "event_proposal_recipients");

            migrationBuilder.DropTable(
                name: "external_identities");

            migrationBuilder.DropTable(
                name: "idempotency_records");

            migrationBuilder.DropTable(
                name: "league_archive_aggregates");

            migrationBuilder.DropTable(
                name: "live_aggregates");

            migrationBuilder.DropTable(
                name: "notification_delivery_events");

            migrationBuilder.DropTable(
                name: "notification_history");

            migrationBuilder.DropTable(
                name: "oauth_attempts");

            migrationBuilder.DropTable(
                name: "organization_blocked_users");

            migrationBuilder.DropTable(
                name: "organization_members");

            migrationBuilder.DropTable(
                name: "organization_notification_settings");

            migrationBuilder.DropTable(
                name: "outbox_records");

            migrationBuilder.DropTable(
                name: "player_statistics");

            migrationBuilder.DropTable(
                name: "player_statistics_meta");

            migrationBuilder.DropTable(
                name: "refresh_tokens");

            migrationBuilder.DropTable(
                name: "scheduled_notifications");

            migrationBuilder.DropTable(
                name: "schema_versions");

            migrationBuilder.DropTable(
                name: "system_markers");

            migrationBuilder.DropTable(
                name: "user_email_histories");

            migrationBuilder.DropTable(
                name: "user_profiles");

            migrationBuilder.DropTable(
                name: "worker_heartbeats");

            migrationBuilder.DropTable(
                name: "tournament_formats");

            migrationBuilder.DropTable(
                name: "event_proposals");

            migrationBuilder.DropTable(
                name: "refresh_sessions");

            migrationBuilder.DropTable(
                name: "event_registration_attempts");

            migrationBuilder.DropTable(
                name: "notification_outbox");

            migrationBuilder.DropTable(
                name: "events");

            migrationBuilder.DropTable(
                name: "asp_net_users");

            migrationBuilder.DropTable(
                name: "organizations");
        }
    }
}
