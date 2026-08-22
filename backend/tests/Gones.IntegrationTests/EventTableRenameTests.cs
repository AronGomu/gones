using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Npgsql;

namespace Gones.IntegrationTests;

/// <summary>
/// T15 — the calendar domain is renamed from Tournament to Event by renaming the tables in place.
/// T1 later squashed that rename, and every other migration, into the single <c>InitialCreate</c>,
/// so there is no longer a revision to migrate to "just before the rename" and no data-preservation
/// round trip left to run. What survives asserts the schema the rename produced: the renamed tables
/// exist, the retired names do not, the out-of-scope tables kept their names, and the foreign key on
/// the renamed registration attempts still bites.
/// </summary>
public sealed class EventTableRenameTests : IAsyncLifetime
{
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

    private readonly PostgreSqlTestContainer postgres = new();

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
}
