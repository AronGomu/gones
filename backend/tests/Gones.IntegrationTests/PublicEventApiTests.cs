using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class PublicEventApiTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;
    private SeedRows seed = null!;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            seed = await SeedAsync(database);
        }
        factory = CreateFactory();
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task List_filters_page_visibility_and_public_dto_privacy()
    {
        using var filtered = await Client.GetAsync($"/api/events?from=2035-03-04&to=2035-03-04&city=Paris&country=France&organization={seed.Alpha.Id:D}&format=pioneer&status=Published&search=Search&pageSize=5");
        Assert.Equal(HttpStatusCode.OK, filtered.StatusCode);
        Assert.Contains("public, max-age=60", filtered.Headers.CacheControl!.ToString());
        Assert.NotNull(filtered.Headers.ETag);
        var filteredBody = await filtered.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, filteredBody.GetProperty("totalCount").GetInt32());
        var item = filteredBody.GetProperty("items")[0];
        Assert.Equal("search-cup", item.GetProperty("slug").GetString());
        Assert.Equal("Pioneer — Search Cup", item.GetProperty("displayTitle").GetString());
        Assert.False(item.TryGetProperty("liveTournamentUrl", out _));
        Assert.False(item.TryGetProperty("archiveTournamentUrl", out _));
        Assert.Equal("Europe/Paris", item.GetProperty("timeZoneId").GetString());
        Assert.Equal("2035-03-04", item.GetProperty("venueStartDate").GetString());
        Assert.Equal("10:00:00", item.GetProperty("venueStartTime").GetString());
        Assert.Equal("2035-03-04T09:00:00Z", item.GetProperty("startsAtUtc").GetString());
        Assert.Equal(seed.Alpha.Id, item.GetProperty("organization").GetProperty("id").GetGuid());
        Assert.Contains(item.GetProperty("formats").EnumerateArray(), format => format.GetProperty("slug").GetString() == "pioneer");
        Assert.False(item.TryGetProperty("bodyHtml", out _));
        Assert.False(item.TryGetProperty("createdByUserId", out _));
        Assert.False(item.TryGetProperty("normalizedSearchText", out _));

        using var defaultList = await Client.GetAsync("/api/events");
        var defaultBody = await defaultList.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, defaultList.StatusCode);
        Assert.Equal(20, defaultBody.GetProperty("pageSize").GetInt32());
        Assert.Equal(20, defaultBody.GetProperty("items").GetArrayLength());
        var defaultSlugs = defaultBody.GetProperty("items").EnumerateArray().Select(entry => entry.GetProperty("slug").GetString()).ToArray();
        Assert.DoesNotContain("completed-cup", defaultSlugs);
        Assert.DoesNotContain("deleted-cup", defaultSlugs);

        using var cancelled = await Client.GetAsync("/api/events?status=Cancelled&pageSize=25");
        var cancelledBody = await cancelled.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        Assert.Contains(cancelledBody.GetProperty("items").EnumerateArray(), entry => entry.GetProperty("slug").GetString() == "cancelled-cup");

        using var past = await Client.GetAsync("/api/events?past=true&status=Completed");
        var pastBody = await past.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, past.StatusCode);
        Assert.Contains(pastBody.GetProperty("items").EnumerateArray(), entry => entry.GetProperty("slug").GetString() == "completed-cup");
    }

    [Fact]
    public async Task Detail_participants_and_ics_are_anonymous_cacheable_and_safe()
    {
        using var detail = await Client.GetAsync("/api/events/search-cup");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        Assert.NotNull(detail.Headers.ETag);
        var etag = detail.Headers.ETag!.ToString();
        var detailBody = await detail.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("<p>Public <strong>body</strong></p>", detailBody.GetProperty("bodyHtml").GetString());
        Assert.Equal("Pioneer — Search Cup", detailBody.GetProperty("displayTitle").GetString());
        Assert.Equal("/live/search-cup", detailBody.GetProperty("liveTournamentUrl").GetString());
        Assert.Equal("https://example.test/archive/search-cup", detailBody.GetProperty("archiveTournamentUrl").GetString());
        Assert.False(detailBody.TryGetProperty("createdByUserId", out _));
        Assert.False(detailBody.TryGetProperty("deletedReason", out _));

        using var notModifiedRequest = new HttpRequestMessage(HttpMethod.Get, "/api/events/search-cup");
        notModifiedRequest.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var notModified = await Client.SendAsync(notModifiedRequest);
        Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);

        using var participants = await Client.GetAsync("/api/events/search-cup/participants");
        Assert.Equal(HttpStatusCode.OK, participants.StatusCode);
        var participantsBody = await participants.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, participantsBody.GetProperty("items").GetArrayLength());

        using var missingParticipants = await Client.GetAsync("/api/events/deleted-cup/participants");
        Assert.Equal(HttpStatusCode.NotFound, missingParticipants.StatusCode);

        using var ics = await Client.GetAsync("/api/events/cancelled-cup.ics");
        Assert.Equal(HttpStatusCode.OK, ics.StatusCode);
        Assert.Equal("text/calendar", ics.Content.Headers.ContentType!.MediaType);
        var calendar = await ics.Content.ReadAsStringAsync();
        Assert.Contains("STATUS:CANCELLED", calendar);
        Assert.Contains("X-GONES-TIMEZONE:Europe/Paris", calendar);
        Assert.Contains("DTSTART:20350305T090000Z", calendar);
        Assert.DoesNotContain("<p>", calendar);
        Assert.DoesNotContain("Public body", calendar);
    }

    [Fact]
    public async Task Ics_is_served_inline_with_calendar_content_type_and_valid_body()
    {
        using var ics = await Client.GetAsync("/api/events/search-cup.ics");
        Assert.Equal(HttpStatusCode.OK, ics.StatusCode);

        var disposition = ics.Content.Headers.ContentDisposition!;
        Assert.Equal("inline", disposition.DispositionType);
        Assert.Contains("search-cup.ics", disposition.FileNameStar ?? disposition.FileName ?? string.Empty);

        Assert.Equal("text/calendar", ics.Content.Headers.ContentType!.MediaType);

        var body = await ics.Content.ReadAsStringAsync();
        Assert.Contains("BEGIN:VEVENT", body);
        Assert.Contains("END:VCALENDAR", body);
    }

    [Fact]
    public async Task Representative_public_filters_use_calendar_indexes()
    {
        await using var database = CreateContext();
        await database.Database.ExecuteSqlRawAsync("SET enable_seqscan = off");
        var datePlan = string.Join('\n', await database.Database.SqlQueryRaw<string>("""
            EXPLAIN SELECT id
            FROM events
            WHERE deleted_at IS NULL
              AND venue_start_date >= DATE '2035-03-01'
              AND venue_start_date <= DATE '2035-03-31'
            ORDER BY venue_start_date, venue_start_time, id
            LIMIT 20
            """).ToListAsync());
        var formatPlan = string.Join('\n', await database.Database.SqlQueryRaw<string>("""
            EXPLAIN SELECT st.id
            FROM events st
            JOIN event_formats stf ON stf.event_id = st.id
            JOIN tournament_formats tf ON tf.id = stf.tournament_format_id
            WHERE st.deleted_at IS NULL AND tf.slug = 'pioneer'
            LIMIT 20
            """).ToListAsync());

        Assert.Contains("ix_events_venue_start_date_venue_start_time_id", datePlan);
        Assert.Contains("ix_event_formats_tournament_format_id", formatPlan);
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c17-public-tournament-signing-key-value");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
        });

    private static async Task<SeedRows> SeedAsync(GonesDbContext database)
    {
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = $"writer-{Guid.NewGuid():N}@example.test",
            NormalizedUserName = $"WRITER-{Guid.NewGuid():N}@EXAMPLE.TEST",
            Email = $"writer-{Guid.NewGuid():N}@example.test",
            NormalizedEmail = $"WRITER-{Guid.NewGuid():N}@EXAMPLE.TEST",
            EmailConfirmed = true,
            SecurityStamp = Guid.NewGuid().ToString("N"),
            ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
        var alpha = Organization.Create("Alpha Club", "Public alpha", "https://alpha.example", "alpha@example.test", Now);
        var beta = Organization.Create("Beta Club", null, null, null, Now);
        var legacy = await database.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug)
            ?? TournamentFormat.CreateLegacy(Now);
        var pioneer = TournamentFormat.Create("Pioneer", "pioneer", 10, Now);
        database.Users.Add(user);
        database.Organizations.AddRange(alpha, beta);
        if (database.Entry(legacy).State == EntityState.Detached) database.TournamentFormats.Add(legacy);
        database.TournamentFormats.Add(pioneer);
        await database.SaveChangesAsync();

        for (var index = 0; index < 22; index++)
        {
            database.Events.Add(Event.Create(
                alpha.Id,
                user.Id,
                Draft($"Page Cup {index:00}", $"page-cup-{index:00}", new LocalDateTime(2035, 1, 1 + index, 10, 0), "Lyon", "Paged", null),
                [legacy],
                Now));
        }

        database.Events.Add(Event.Create(
            alpha.Id,
            user.Id,
            Draft("Search Cup", "search-cup", new LocalDateTime(2035, 3, 4, 10, 0), "Paris", "Search", "<p>Public <strong>body</strong></p>") with
            {
                LiveTournamentUrl = "/live/search-cup",
                ArchiveTournamentUrl = "https://example.test/archive/search-cup"
            },
            [pioneer],
            Now));
        var cancelled = Event.Create(
            alpha.Id,
            user.Id,
            Draft("Cancelled Cup", "cancelled-cup", new LocalDateTime(2035, 3, 5, 10, 0), "Paris", "Cancelled", "<p>Cancelled body</p>"),
            [legacy],
            Now);
        cancelled.Cancel(Now.Plus(Duration.FromMinutes(1)));
        database.Events.Add(cancelled);
        var completed = Event.Create(
            beta.Id,
            user.Id,
            Draft("Completed Cup", "completed-cup", new LocalDateTime(2020, 1, 2, 10, 0), "Lyon", "Past", null),
            [legacy],
            Instant.FromUtc(2019, 12, 1, 12, 0));
        completed.AdvanceLifecycle(Instant.FromUtc(2020, 1, 2, 12, 0));
        completed.AdvanceLifecycle(Instant.FromUtc(2020, 1, 2, 19, 0));
        database.Events.Add(completed);
        var deleted = Event.Create(
            beta.Id,
            user.Id,
            Draft("Deleted Cup", "deleted-cup", new LocalDateTime(2035, 3, 6, 10, 0), "Lyon", "Deleted", null),
            [legacy],
            Now);
        deleted.SoftDelete(user.Id, "hidden", Now.Plus(Duration.FromMinutes(1)));
        database.Events.Add(deleted);
        await database.SaveChangesAsync();
        return new SeedRows(alpha, beta);
    }

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones(postgres.GetConnectionString())
            .Options;
        return new GonesDbContext(options);
    }

    [Fact]
    public async Task Lists_the_organizations_organizers()
    {
        await using var database = CreateContext();
        var userZoe = new ApplicationUser { Id = Guid.NewGuid(), UserName = "zoe@example.test", NormalizedUserName = "ZOE@EXAMPLE.TEST", Email = "zoe@example.test", NormalizedEmail = "ZOE@EXAMPLE.TEST", EmailConfirmed = true, SecurityStamp = Guid.NewGuid().ToString("N"), ConcurrencyStamp = Guid.NewGuid().ToString("N") };
        var userAdam = new ApplicationUser { Id = Guid.NewGuid(), UserName = "adam@example.test", NormalizedUserName = "ADAM@EXAMPLE.TEST", Email = "adam@example.test", NormalizedEmail = "ADAM@EXAMPLE.TEST", EmailConfirmed = true, SecurityStamp = Guid.NewGuid().ToString("N"), ConcurrencyStamp = Guid.NewGuid().ToString("N") };
        database.Users.AddRange(userZoe, userAdam);
        await database.SaveChangesAsync();
        database.UserProfiles.AddRange(
            UserProfile.Create(userZoe.Id, "zoe", "Zoe", "Tester", Now),
            UserProfile.Create(userAdam.Id, "adam", "Adam", "Tester", Now));
        database.OrganizationMembers.AddRange(
            OrganizationMember.Create(seed.Alpha.Id, userZoe.Id, OrganizationRoles.Organizer, Now),
            OrganizationMember.Create(seed.Alpha.Id, userAdam.Id, OrganizationRoles.Organizer, Now));
        await database.SaveChangesAsync();

        using var detail = await Client.GetAsync("/api/events/search-cup");
        var body = await detail.Content.ReadFromJsonAsync<JsonElement>();
        var organizers = body.GetProperty("organization").GetProperty("organizers").EnumerateArray().Select(el => el.GetString()).ToArray();

        // lists both, alphabetically
        Assert.Equal(new[] { "adam", "zoe" }, organizers);

        // no member's user e-mail leaks: the organization's own public contactEmail is the only "@" in the payload
        var organization = body.GetProperty("organization");
        Assert.Equal("alpha@example.test", organization.GetProperty("contactEmail").GetString());
        var fieldsWithAnAtSign = organization.EnumerateObject()
            .Where(property => property.Name != "contactEmail" && property.Value.GetRawText().Contains('@'))
            .Select(property => property.Name)
            .ToArray();
        Assert.Equal(Array.Empty<string>(), fieldsWithAnAtSign);
    }

    [Fact]
    public async Task Is_empty_for_a_member_less_organization()
    {
        // completed-cup belongs to seed.Beta which has no members
        using var detail = await Client.GetAsync("/api/events/completed-cup");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        var body = await detail.Content.ReadFromJsonAsync<JsonElement>();
        var organizers = body.GetProperty("organization").GetProperty("organizers");
        Assert.Equal(JsonValueKind.Array, organizers.ValueKind);
        Assert.Equal(0, organizers.GetArrayLength());
    }

    private static ScheduledTournamentDraft Draft(string title, string slug, LocalDateTime startsAt, string city, string summary, string? bodyHtml) => new(
        Title: title,
        Slug: slug,
        Summary: summary,
        BodyHtml: bodyHtml,
        StreetAddress: "12 Rue de la Paix",
        PostalCode: "75001",
        City: city,
        Country: "France",
        TimeZoneId: "Europe/Paris",
        StartsAtLocal: startsAt,
        EndsAtLocal: startsAt.Date.At(new LocalTime(18, 0)),
        Capacity: 64);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);

    private sealed record SeedRows(Organization Alpha, Organization Beta);
}
