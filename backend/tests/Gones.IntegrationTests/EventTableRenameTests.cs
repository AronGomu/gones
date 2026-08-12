using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

/// <summary>
/// T15 — the calendar domain is renamed from Tournament to Event by renaming the tables in place.
/// The migration is only correct if it is data-preserving, so these tests migrate to the revision
/// just before the rename, write rows under the old table names, and then prove the same rows are
/// readable through the renamed entities with every column intact.
/// </summary>
public sealed class EventTableRenameTests : IAsyncLifetime
{
    /// <summary>The migration immediately before <c>RenameCalendarTournamentToEvent</c>.</summary>
    private const string BeforeRename = "20260812154508_HealOrganizationMembershipInvariants";

    private static readonly string[] RenamedTables =
    [
        "events",
        "event_formats",
        "event_registration_attempts",
        "event_lifecycle_entries",
        "event_proposals",
        "event_proposal_recipients",
        "consumed_event_preview_tickets"
    ];

    private static readonly string[] RetiredTables =
    [
        "scheduled_tournaments",
        "scheduled_tournament_formats",
        "tournament_registration_attempts",
        "tournament_lifecycle_events",
        "tournament_proposals",
        "tournament_proposal_recipients",
        "consumed_tournament_preview_tickets"
    ];

    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();

    public Task InitializeAsync() => postgres.StartAsync();

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Rename_migration_replaces_the_old_calendar_tables()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        foreach (var table in RenamedTables) Assert.True(await TableExistsAsync(db, table), $"{table} is missing");
        foreach (var table in RetiredTables) Assert.False(await TableExistsAsync(db, table), $"{table} still exists");
    }

    [Fact]
    public async Task Out_of_scope_tables_keep_their_names()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        // The shared format lookup, the archive and the live domains are explicitly not renamed.
        foreach (var table in new[] { "tournament_formats", "league_archive_aggregates", "live_aggregates" })
        {
            Assert.True(await TableExistsAsync(db, table), $"{table} must not be renamed");
        }

        // The notification tables belong to the notification domain: only their FK column moves.
        foreach (var table in new[] { "scheduled_notifications", "notification_history" })
        {
            Assert.True(await TableExistsAsync(db, table), $"{table} must not be renamed");
            Assert.True(await ColumnExistsAsync(db, table, "event_id"), $"{table}.event_id is missing");
            Assert.False(await ColumnExistsAsync(db, table, "tournament_id"), $"{table}.tournament_id still exists");
        }
    }

    [Fact]
    public async Task Rows_written_before_the_rename_survive_it()
    {
        await using var db = CreateContext();
        await db.GetService<IMigrator>().MigrateAsync(BeforeRename);
        var seed = await SeedPrincipalsAsync(db);
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        await InsertLegacyTournamentAsync(db, seed, first, "legacy-alpha", "Legacy Alpha");
        await InsertLegacyTournamentAsync(db, seed, second, "legacy-beta", "Legacy Beta");
        var attemptId = await InsertLegacyRegistrationAsync(db, seed, first);
        var lifecycleId = await InsertLegacyLifecycleEventAsync(db, seed, first);
        var beforeCounts = await CountLegacyRowsAsync(db);

        await db.Database.MigrateAsync();
        db.ChangeTracker.Clear();

        var stored = await db.Events.AsNoTracking().Include(item => item.Formats).OrderBy(item => item.Slug).ToListAsync();
        Assert.Equal(2, stored.Count);
        Assert.Equal(["legacy-alpha", "legacy-beta"], stored.Select(item => item.Slug));

        // Full-row round trip, not just a count: every column of the seeded row must come back.
        var alpha = stored[0];
        Assert.Equal(first, alpha.Id);
        Assert.Equal(seed.Organization.Id, alpha.OrganizationId);
        Assert.Equal("Legacy Alpha", alpha.Title);
        Assert.Equal("Summary", alpha.Summary);
        Assert.Equal("<p>Body</p>", alpha.BodyHtml);
        Assert.Equal("12 Rue de la Paix", alpha.StreetAddress);
        Assert.Equal("69001", alpha.PostalCode);
        Assert.Equal("Lyon", alpha.City);
        Assert.Equal("France", alpha.Country);
        Assert.Equal("Europe/Paris", alpha.TimeZoneId);
        Assert.Equal(new LocalDate(2026, 8, 2), alpha.VenueStartDate);
        Assert.Equal(new LocalTime(10, 0), alpha.VenueStartTime);
        Assert.Equal(new LocalDate(2026, 8, 2), alpha.VenueEndDate);
        Assert.Equal(new LocalTime(18, 0), alpha.VenueEndTime);
        Assert.Equal(Instant.FromUtc(2026, 8, 2, 8, 0), alpha.StartsAtUtc);
        Assert.Equal(Instant.FromUtc(2026, 8, 2, 16, 0), alpha.EndsAtUtc);
        Assert.Equal(64, alpha.Capacity);
        Assert.Equal(ScheduledTournamentStatus.Published, alpha.Status);
        Assert.Equal(seed.User.Id, alpha.CreatedByUserId);
        Assert.Equal(Now, alpha.CreatedAt);
        Assert.Equal(Now, alpha.UpdatedAt);
        Assert.Null(alpha.DeletedAt);
        Assert.Null(alpha.DeletedByUserId);
        Assert.Null(alpha.DeletedReason);
        Assert.Equal("LEGACY ALPHA SUMMARY LYON FRANCE", alpha.NormalizedSearchText);
        Assert.Equal(3, alpha.Version);
        Assert.Equal(seed.Legacy.Id, Assert.Single(alpha.Formats).TournamentFormatId);
        Assert.Equal(first, Assert.Single(alpha.Formats).EventId);

        var attempt = await db.EventRegistrationAttempts.AsNoTracking().SingleAsync();
        Assert.Equal(attemptId, attempt.Id);
        Assert.Equal(first, attempt.EventId);
        Assert.Equal(seed.User.Id, attempt.UserId);
        Assert.Equal(TournamentRegistrationStatus.Confirmed, attempt.Status);

        var lifecycle = await db.EventLifecycleEntries.AsNoTracking().SingleAsync();
        Assert.Equal(lifecycleId, lifecycle.Id);
        Assert.Equal(first, lifecycle.EventId);
        Assert.Equal(TournamentLifecycleEventType.Cancelled, lifecycle.EventType);

        Assert.Equal(beforeCounts.Tournaments, await db.Events.CountAsync());
        Assert.Equal(beforeCounts.Formats, await db.EventFormats.CountAsync());
        Assert.Equal(beforeCounts.Registrations, await db.EventRegistrationAttempts.CountAsync());
        Assert.Equal(beforeCounts.LifecycleEvents, await db.EventLifecycleEntries.CountAsync());
    }

    [Fact]
    public async Task Renamed_registration_attempts_still_enforce_the_event_foreign_key()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var seed = await SeedPrincipalsAsync(db);

        var violation = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("""
            INSERT INTO event_registration_attempts
                (id, event_id, user_id, status, registered_by_user_id, registered_at, version)
            VALUES ({0}, {1}, {2}, 'Confirmed', {2}, {3}, 1)
            """,
            Guid.NewGuid(),
            Guid.NewGuid(),
            seed.User.Id,
            Now));

        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, violation.SqlState);
    }

    private static async Task<bool> TableExistsAsync(GonesDbContext db, string table) =>
        await db.Database
            .SqlQueryRaw<bool>("SELECT to_regclass('public.' || {0}) IS NOT NULL AS \"Value\"", table)
            .SingleAsync();

    private static async Task<bool> ColumnExistsAsync(GonesDbContext db, string table, string column) =>
        await db.Database
            .SqlQueryRaw<bool>(
                """
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = {0} AND column_name = {1}) AS "Value"
                """,
                table,
                column)
            .SingleAsync();

    private static async Task<LegacyCounts> CountLegacyRowsAsync(GonesDbContext db) => new(
        await ScalarAsync(db, "SELECT count(*)::int AS \"Value\" FROM scheduled_tournaments"),
        await ScalarAsync(db, "SELECT count(*)::int AS \"Value\" FROM scheduled_tournament_formats"),
        await ScalarAsync(db, "SELECT count(*)::int AS \"Value\" FROM tournament_registration_attempts"),
        await ScalarAsync(db, "SELECT count(*)::int AS \"Value\" FROM tournament_lifecycle_events"));

    private static Task<int> ScalarAsync(GonesDbContext db, string sql) =>
        db.Database.SqlQueryRaw<int>(sql).SingleAsync();

    private static async Task InsertLegacyTournamentAsync(GonesDbContext db, SeedRows seed, Guid id, string slug, string title)
    {
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO scheduled_tournaments
                (id, organization_id, title, slug, summary, body_html, street_address, postal_code, city, country, time_zone_id,
                 venue_start_date, venue_start_time, venue_end_date, venue_end_time, starts_at_utc, ends_at_utc, capacity, status,
                 created_by_user_id, created_at, updated_at, normalized_search_text, version)
            VALUES
                ({0}, {1}, {2}, {3}, 'Summary', '<p>Body</p>', '12 Rue de la Paix', '69001', 'Lyon', 'France', 'Europe/Paris',
                 DATE '2026-08-02', TIME '10:00:00', DATE '2026-08-02', TIME '18:00:00', {4}, {5}, 64, 'Published',
                 {6}, {7}, {7}, {8}, 3)
            """,
            id,
            seed.Organization.Id,
            title,
            slug,
            Instant.FromUtc(2026, 8, 2, 8, 0),
            Instant.FromUtc(2026, 8, 2, 16, 0),
            seed.User.Id,
            Now,
            $"{title.ToUpperInvariant()} SUMMARY LYON FRANCE");
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO scheduled_tournament_formats (scheduled_tournament_id, tournament_format_id) VALUES ({0}, {1})",
            id,
            seed.Legacy.Id);
    }

    private static async Task<Guid> InsertLegacyRegistrationAsync(GonesDbContext db, SeedRows seed, Guid tournamentId)
    {
        var id = Guid.NewGuid();
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO tournament_registration_attempts
                (id, tournament_id, user_id, status, registered_by_user_id, registered_at, version)
            VALUES ({0}, {1}, {2}, 'Confirmed', {2}, {3}, 1)
            """,
            id,
            tournamentId,
            seed.User.Id,
            Now);
        return id;
    }

    private static async Task<Guid> InsertLegacyLifecycleEventAsync(GonesDbContext db, SeedRows seed, Guid tournamentId)
    {
        var id = Guid.NewGuid();
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO tournament_lifecycle_events
                (id, tournament_id, actor_user_id, event_type, reminder_plan_action, occurred_at)
            VALUES ({0}, {1}, {2}, 'Cancelled', 'CancelFuture', {3})
            """,
            id,
            tournamentId,
            seed.User.Id,
            Now);
        return id;
    }

    private static async Task<SeedRows> SeedPrincipalsAsync(GonesDbContext db)
    {
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = $"user-{Guid.NewGuid():N}@example.test",
            NormalizedUserName = $"USER-{Guid.NewGuid():N}@EXAMPLE.TEST",
            Email = $"user-{Guid.NewGuid():N}@example.test",
            NormalizedEmail = $"USER-{Guid.NewGuid():N}@EXAMPLE.TEST",
            EmailConfirmed = true,
            SecurityStamp = Guid.NewGuid().ToString("N"),
            ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
        var organization = Organization.Create($"Club {Guid.NewGuid():N}", null, null, null, Now);
        var legacy = await db.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug)
            ?? TournamentFormat.CreateLegacy(Now);
        db.Users.Add(user);
        db.Organizations.Add(organization);
        if (db.Entry(legacy).State == EntityState.Detached) db.TournamentFormats.Add(legacy);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        return new SeedRows(user, organization, legacy);
    }

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones(postgres.GetConnectionString())
            .Options;
        return new GonesDbContext(options);
    }

    private static readonly Instant Now = Instant.FromUtc(2026, 8, 1, 12, 0);

    private sealed record SeedRows(ApplicationUser User, Organization Organization, TournamentFormat Legacy);

    private sealed record LegacyCounts(int Tournaments, int Formats, int Registrations, int LifecycleEvents);
}
