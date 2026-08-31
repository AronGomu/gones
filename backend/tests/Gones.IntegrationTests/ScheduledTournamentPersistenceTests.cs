using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Npgsql;

namespace Gones.IntegrationTests;

public sealed class ScheduledTournamentPersistenceTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();

    public Task InitializeAsync() => postgres.StartAsync();

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Scheduled_tournament_round_trips_with_formats_and_version()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var seed = await SeedAsync(db);
        var tournament = Event.Create(seed.Organization.Id, seed.User.Id, Draft() with
        {
            LiveTournamentUrl = "/live/legacy-cup",
            ArchiveTournamentUrl = "https://example.test/archive/legacy-cup"
        }, [seed.Legacy], Now);
        db.Events.Add(tournament);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var stored = await db.Events.Include(item => item.Formats).SingleAsync(item => item.Id == tournament.Id);

        Assert.Equal("legacy-cup", stored.Slug);
        Assert.Equal(ScheduledTournamentStatus.Published, stored.Status);
        Assert.Equal(1, stored.Version);
        Assert.Single(stored.Formats);
        Assert.Equal(seed.Legacy.Id, stored.Formats.Single().TournamentFormatId);
        Assert.Equal("/live/legacy-cup", stored.LiveTournamentUrl);
        Assert.Equal("https://example.test/archive/legacy-cup", stored.ArchiveTournamentUrl);
    }

    [Fact]
    public async Task Database_rejects_second_format_row_for_same_event()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var seed = await SeedAsync(db);
        var modern = TournamentFormat.Create("Modern", "modern", 10, Now);
        db.TournamentFormats.Add(modern);
        var tournament = Event.Create(seed.Organization.Id, seed.User.Id, Draft(), [seed.Legacy], Now);
        db.Events.Add(tournament);
        await db.SaveChangesAsync();

        db.EventFormats.Add(EventFormat.Create(tournament.Id, modern.Id));
        var exception = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(PostgresErrorCodes.UniqueViolation, ((PostgresException)exception.InnerException!).SqlState);
    }

    [Fact]
    public async Task Database_enforces_unique_org_slug_time_order_capacity_and_status()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var seed = await SeedAsync(db);
        db.Events.Add(Event.Create(seed.Organization.Id, seed.User.Id, Draft(), [seed.Legacy], Now));
        db.Events.Add(Event.Create(seed.SecondOrganization.Id, seed.User.Id, Draft(), [seed.Legacy], Now));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());

        db.ChangeTracker.Clear();
        var id = Guid.NewGuid();
        var invalidEnd = await Assert.ThrowsAsync<PostgresException>(() => InsertRawTournamentAsync(db, seed, id, endsBeforeStart: true, capacity: 32, status: "Published"));
        Assert.Equal(PostgresErrorCodes.CheckViolation, invalidEnd.SqlState);
        var invalidCapacity = await Assert.ThrowsAsync<PostgresException>(() => InsertRawTournamentAsync(db, seed, Guid.NewGuid(), endsBeforeStart: false, capacity: 0, status: "Published"));
        Assert.Equal(PostgresErrorCodes.CheckViolation, invalidCapacity.SqlState);
        var invalidStatus = await Assert.ThrowsAsync<PostgresException>(() => InsertRawTournamentAsync(db, seed, Guid.NewGuid(), endsBeforeStart: false, capacity: 32, status: "Draft"));
        Assert.Equal(PostgresErrorCodes.CheckViolation, invalidStatus.SqlState);
        var invalidEventType = await Assert.ThrowsAsync<PostgresException>(() => InsertRawTournamentAsync(db, seed, Guid.NewGuid(), endsBeforeStart: false, capacity: 32, status: "Published", eventType: "Other"));
        Assert.Equal(PostgresErrorCodes.CheckViolation, invalidEventType.SqlState);
    }

    [Theory]
    [InlineData("Weekly")]
    [InlineData("Monthly")]
    [InlineData("Major")]
    public async Task Database_accepts_every_Event_Type(string eventType)
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var seed = await SeedAsync(db);
        await InsertRawTournamentAsync(db, seed, Guid.NewGuid(), endsBeforeStart: false, capacity: 32, status: "Published", eventType: eventType);
    }

    [Fact]
    public async Task Migration_adds_calendar_indexes_for_bounded_public_queries()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var indexNames = await db.Database.SqlQueryRaw<string>("SELECT indexname FROM pg_indexes WHERE tablename IN ('events', 'event_formats') ORDER BY indexname").ToListAsync();

        Assert.Contains("ix_events_venue_start_date_venue_start_time_id", indexNames);
        Assert.Contains("ix_events_starts_at_utc", indexNames);
        Assert.Contains("ix_events_status", indexNames);
        Assert.Contains("ix_events_city_country", indexNames);
        Assert.Contains("ix_events_country_region_city", indexNames);
        Assert.Contains("ix_events_region", indexNames);
        Assert.Contains("ix_events_event_type", indexNames);
        Assert.Contains("ix_events_slug", indexNames);
        Assert.Contains("ix_events_organization_id_slug", indexNames);
        Assert.Contains("ix_event_formats_tournament_format_id", indexNames);
        Assert.Contains("ix_event_formats_event_id", indexNames);
    }

    private static async Task InsertRawTournamentAsync(GonesDbContext db, SeedRows seed, Guid id, bool endsBeforeStart, int capacity, string status, string eventType = "Weekly")
    {
        var end = endsBeforeStart ? Instant.FromUtc(2026, 8, 2, 7, 0) : Instant.FromUtc(2026, 8, 2, 16, 0);
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO events
                (id, organization_id, title, slug, summary, body_html, street_address, postal_code, city, country, region, event_type, time_zone_id,
                 venue_start_date, venue_start_time, venue_end_date, venue_end_time, starts_at_utc, ends_at_utc, capacity, status,
                 created_by_user_id, created_at, updated_at, normalized_search_text, version)
            VALUES
                ({0}, {1}, 'Raw Cup', {2}, 'Raw', '<p>Raw</p>', '12 Rue de la Paix', '69001', 'Lyon', 'France', 'Auvergne-Rhône-Alpes', {9}, 'Europe/Paris',
                 DATE '2026-08-02', TIME '10:00:00', DATE '2026-08-02', TIME '18:00:00', {3}, {4}, {5}, {6},
                 {7}, {8}, {8}, 'RAW CUP RAW LYON FRANCE', 1)
            """,
            id,
            seed.Organization.Id,
            $"raw-{Guid.NewGuid():N}",
            Instant.FromUtc(2026, 8, 2, 8, 0),
            end,
            capacity,
            status,
            seed.User.Id,
            Now,
            eventType);
    }

    private static async Task<SeedRows> SeedAsync(GonesDbContext db)
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
        var secondOrganization = Organization.Create($"Club {Guid.NewGuid():N}", null, null, null, Now);
        var legacy = await db.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug)
            ?? TournamentFormat.CreateLegacy(Now);
        db.Users.Add(user);
        db.Organizations.AddRange(organization, secondOrganization);
        if (db.Entry(legacy).State == EntityState.Detached) db.TournamentFormats.Add(legacy);
        await db.SaveChangesAsync();
        return new SeedRows(user, organization, secondOrganization, legacy);
    }

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones(postgres.GetConnectionString())
            .Options;
        return new GonesDbContext(options);
    }

    private static ScheduledTournamentDraft Draft() => new(
        Title: "Legacy Cup",
        Slug: "legacy-cup",
        Summary: "Prizes",
        BodyHtml: "<p>Welcome</p>",
        StreetAddress: "12 Rue de la Paix",
        PostalCode: "69001",
        City: "Lyon",
        Country: "France",
        TimeZoneId: "Europe/Paris",
        StartsAtLocal: new LocalDateTime(2026, 8, 2, 10, 0),
        EndsAtLocal: new LocalDateTime(2026, 8, 2, 18, 0),
        Capacity: 64,
        Region: "Auvergne-Rhône-Alpes",
        EventType: CalendarEventType.Weekly);

    private static readonly Instant Now = Instant.FromUtc(2026, 8, 1, 12, 0);

    private sealed record SeedRows(ApplicationUser User, Organization Organization, Organization SecondOrganization, TournamentFormat Legacy);
}
