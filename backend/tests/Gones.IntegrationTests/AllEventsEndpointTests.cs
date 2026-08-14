using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class AllEventsEndpointTests : IAsyncLifetime
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
    public async Task All_is_anonymous()
    {
        using var response = await Client.GetAsync("/api/events/all");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task All_returns_future_tournaments()
    {
        using var response = await Client.GetAsync("/api/events/all");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(3, body.GetProperty("count").GetInt32());
        var slugs = body.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("slug").GetString()).ToArray();
        Assert.DoesNotContain("past-one", slugs);
        Assert.DoesNotContain("past-two", slugs);
    }

    [Fact]
    public async Task All_honours_an_explicit_from()
    {
        using var response = await Client.GetAsync("/api/events/all?from=2020-01-01");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(5, body.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task All_ignores_paging_parameters()
    {
        using var response = await Client.GetAsync("/api/events/all?page=2&pageSize=1");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(3, body.GetProperty("count").GetInt32());
        Assert.Equal(3, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task All_orders_by_start_then_id()
    {
        using var response = await Client.GetAsync("/api/events/all");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal("future-one", items[0].GetProperty("slug").GetString());
        var tiedIds = new[] { items[1].GetProperty("id").GetGuid(), items[2].GetProperty("id").GetGuid() };
        var expectedOrder = tiedIds.OrderBy(id => id).ToArray();
        Assert.Equal(expectedOrder, tiedIds);
        Assert.Equal(items[1].GetProperty("startsAtUtc").GetString(), items[2].GetProperty("startsAtUtc").GetString());
    }

    [Fact]
    public async Task All_excludes_deleted_tournaments_and_orgs()
    {
        using var response = await Client.GetAsync("/api/events/all?from=2020-01-01");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var slugs = body.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("slug").GetString()).ToArray();
        Assert.DoesNotContain("deleted-cup", slugs);
        Assert.DoesNotContain("org-deleted-cup", slugs);
    }

    [Fact]
    public async Task All_sets_a_strong_etag_and_cache_control()
    {
        using var response = await Client.GetAsync("/api/events/all");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(response.Headers.ETag);
        Assert.Contains("public, max-age=3600", response.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task All_returns_304_for_a_matching_etag()
    {
        using var first = await Client.GetAsync("/api/events/all");
        var etag = first.Headers.ETag!.ToString();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/events/all");
        request.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var replay = await Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NotModified, replay.StatusCode);
        var body = await replay.Content.ReadAsByteArrayAsync();
        Assert.Empty(body);
    }

    [Fact]
    public async Task All_changes_its_etag_when_data_changes()
    {
        using var first = await Client.GetAsync("/api/events/all");
        var etag = first.Headers.ETag!.ToString();

        await using (var database = CreateContext())
        {
            database.Events.Add(Event.Create(
                seed.Alpha.Id,
                seed.UserId,
                Draft("Fresh Cup", "fresh-cup", new LocalDateTime(2035, 6, 1, 10, 0), "Lyon", "Fresh", null),
                [seed.Legacy],
                Now));
            await database.SaveChangesAsync();
        }

        using var second = await Client.GetAsync("/api/events/all");
        var secondEtag = second.Headers.ETag!.ToString();
        Assert.NotEqual(etag, secondEtag);
    }

    [Fact]
    public async Task All_flags_truncation()
    {
        await using var truncatedFactory = factory!.WithWebHostBuilder(builder =>
            builder.UseSetting("Gones:Calendar:MaximumCatalogSize", "2"));
        using var truncatedClient = truncatedFactory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        using var response = await truncatedClient.GetAsync("/api/events/all");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("truncated").GetBoolean());
        Assert.Equal(2, body.GetProperty("items").GetArrayLength());
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c17-all-tournaments-signing-key-value");
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
        var alpha = Organization.Create("All Alpha Club", "Public alpha", "https://alpha.example", "alpha@example.test", Now);
        var deletedOrg = Organization.Create("Deleted Club", null, null, null, Now);
        var legacy = await database.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug)
            ?? TournamentFormat.CreateLegacy(Now);
        database.Users.Add(user);
        database.Organizations.AddRange(alpha, deletedOrg);
        if (database.Entry(legacy).State == EntityState.Detached) database.TournamentFormats.Add(legacy);
        await database.SaveChangesAsync();

        var tiedStart = new LocalDateTime(2035, 2, 6, 10, 0);
        database.Events.Add(Event.Create(
            alpha.Id, user.Id, Draft("Future One", "future-one", new LocalDateTime(2035, 2, 5, 10, 0), "Lyon", "Future", null), [legacy], Now));
        database.Events.Add(Event.Create(
            alpha.Id, user.Id, Draft("Future Two", "future-two", tiedStart, "Lyon", "Future", null), [legacy], Now));
        database.Events.Add(Event.Create(
            alpha.Id, user.Id, Draft("Future Three", "future-three", tiedStart, "Lyon", "Future", null), [legacy], Now));

        database.Events.Add(Event.Create(
            alpha.Id, user.Id, Draft("Past One", "past-one", new LocalDateTime(2020, 1, 5, 10, 0), "Lyon", "Past", null), [legacy], Instant.FromUtc(2019, 12, 1, 12, 0)));
        database.Events.Add(Event.Create(
            alpha.Id, user.Id, Draft("Past Two", "past-two", new LocalDateTime(2020, 1, 6, 10, 0), "Lyon", "Past", null), [legacy], Instant.FromUtc(2019, 12, 1, 12, 0)));

        var deleted = Event.Create(
            alpha.Id, user.Id, Draft("Deleted Cup", "deleted-cup", new LocalDateTime(2035, 2, 8, 10, 0), "Lyon", "Deleted", null), [legacy], Now);
        deleted.SoftDelete(user.Id, "hidden", Now.Plus(Duration.FromMinutes(1)));
        database.Events.Add(deleted);

        database.Events.Add(Event.Create(
            deletedOrg.Id, user.Id, Draft("Org Deleted Cup", "org-deleted-cup", new LocalDateTime(2035, 2, 9, 10, 0), "Lyon", "OrgDeleted", null), [legacy], Now));
        await database.SaveChangesAsync();

        deletedOrg.SoftDelete(Now.Plus(Duration.FromMinutes(1)));
        await database.SaveChangesAsync();

        return new SeedRows(alpha, user.Id, legacy);
    }

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones(postgres.GetConnectionString())
            .Options;
        return new GonesDbContext(options);
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

    private sealed record SeedRows(Organization Alpha, Guid UserId, TournamentFormat Legacy);
}
