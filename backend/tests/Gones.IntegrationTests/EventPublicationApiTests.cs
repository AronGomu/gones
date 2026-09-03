using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Gones.Api.Errors;
using Gones.Application.Events;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class EventPublicationApiTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();
    private readonly MutableClock clock = new(Now);
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
    public async Task Preview_route_is_removed()
    {
        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/events/preview",
            seed.Organizer.Id,
            "Organizer",
            Payload(seed.Alpha.Id));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Direct_publish_attaches_ordered_temporary_images_and_replays_idempotently()
    {
        var first = EventImage.CreateTemporary(Guid.NewGuid(), seed.Organizer.Id, 960, 540, Now);
        var second = EventImage.CreateTemporary(Guid.NewGuid(), seed.Organizer.Id, 320, 180, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.AddRange(first, second);
            await database.SaveChangesAsync();
        }
        var payload = Payload(seed.Alpha.Id) with
        {
            Images = [new(second.Id, " Second "), new(first.Id, null)]
        };

        using var published = await PublishAsync(seed.Organizer.Id, "direct-images", payload);
        var publishedRaw = await published.Content.ReadAsStringAsync();
        Assert.True(published.StatusCode == HttpStatusCode.Created, publishedRaw);
        Assert.NotNull(published.Headers.ETag);
        Assert.Equal("/api/events/summer-cup-legacy", published.Headers.Location?.OriginalString);
        var body = await published.Content.ReadFromJsonAsync<JsonElement>();
        var eventId = body.GetProperty("id").GetGuid();

        using var replay = await PublishAsync(seed.Organizer.Id, "direct-images", payload);
        Assert.Equal(HttpStatusCode.Created, replay.StatusCode);
        Assert.Equal(eventId, (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid());

        await using var verify = CreateContext();
        var storedEvent = await verify.Events.AsNoTracking().SingleAsync(item => item.Id == eventId);
        Assert.Equal("12 Rue de la Paix", storedEvent.StreetAddress);
        Assert.Equal("Europe/Paris", storedEvent.TimeZoneId);
        Assert.Equal(new LocalTime(23, 59, 59), storedEvent.VenueEndTime);
        var images = await verify.EventImages.AsNoTracking()
            .Where(image => image.EventId == eventId)
            .OrderBy(image => image.SortOrder)
            .ToListAsync();
        Assert.Equal(new[] { second.Id, first.Id }, images.Select(image => image.Id).ToArray());
        Assert.All(images, image => Assert.Equal(EventImageState.EventOwned, image.State));
        Assert.Equal(new[] { "Second", null }, images.Select(image => image.AltText).ToArray());
        Assert.All(images, image => Assert.Null(image.ExpiresAt));
        Assert.Equal(1, await verify.Events.CountAsync(item => item.Id == eventId));
        Assert.Equal(1, await verify.IdempotencyRecords.CountAsync(item => item.Key == "direct-images"));
    }

    [Fact]
    public async Task Image_conflict_rolls_back_Event_and_leaves_temporary_ownership()
    {
        var image = EventImage.CreateTemporary(Guid.NewGuid(), seed.Organizer.Id, 960, 540, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.Add(image);
            await database.SaveChangesAsync();
        }
        var payload = Payload(seed.Alpha.Id) with
        {
            Title = "Duplicate Image Cup",
            Images = [new(image.Id, null), new(image.Id, "duplicate")]
        };

        using var response = await PublishAsync(seed.Organizer.Id, "duplicate-images", payload);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("image_state_conflict", await ProblemCode(response));

        await using var verify = CreateContext();
        Assert.Equal(0, await verify.Events.CountAsync(item => item.Title == payload.Title));
        var stored = await verify.EventImages.AsNoTracking().SingleAsync(item => item.Id == image.Id);
        Assert.Equal(EventImageState.Temporary, stored.State);
        Assert.Null(stored.EventId);
        Assert.NotNull(stored.ExpiresAt);
        Assert.Equal(0, await verify.IdempotencyRecords.CountAsync(item => item.Key == "duplicate-images"));
    }

    [Fact]
    public async Task Foreign_and_expired_images_conflict_without_partial_publication()
    {
        var foreign = EventImage.CreateTemporary(Guid.NewGuid(), seed.Outsider.Id, 960, 540, Now);
        var expired = EventImage.CreateTemporary(Guid.NewGuid(), seed.Organizer.Id, 960, 540, Now - EventImage.TemporaryLifetime);
        await using (var database = CreateContext())
        {
            database.EventImages.AddRange(foreign, expired);
            await database.SaveChangesAsync();
        }

        using var foreignResponse = await PublishAsync(
            seed.Organizer.Id,
            "foreign-image",
            Payload(seed.Alpha.Id) with { Title = "Foreign Image Cup", Images = [new(foreign.Id, null)] });
        using var expiredResponse = await PublishAsync(
            seed.Organizer.Id,
            "expired-image",
            Payload(seed.Alpha.Id) with { Title = "Expired Image Cup", Images = [new(expired.Id, null)] });

        Assert.Equal(HttpStatusCode.Conflict, foreignResponse.StatusCode);
        Assert.Equal("image_state_conflict", await ProblemCode(foreignResponse));
        Assert.Equal(HttpStatusCode.Conflict, expiredResponse.StatusCode);
        Assert.Equal("image_state_conflict", await ProblemCode(expiredResponse));
        await using var verify = CreateContext();
        Assert.Equal(0, await verify.Events.CountAsync(item => item.Title == "Foreign Image Cup" || item.Title == "Expired Image Cup"));
        Assert.All(await verify.EventImages.AsNoTracking().ToListAsync(), image => Assert.Equal(EventImageState.Temporary, image.State));
    }

    [Fact]
    public async Task Missing_image_returns_not_found_without_Event()
    {
        var payload = Payload(seed.Alpha.Id) with
        {
            Title = "Missing Image Cup",
            Images = [new(Guid.NewGuid(), null)]
        };

        using var response = await PublishAsync(seed.Organizer.Id, "missing-image", payload);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        await using var verify = CreateContext();
        Assert.Equal(0, await verify.Events.CountAsync(item => item.Title == payload.Title));
    }

    [Fact]
    public async Task Manual_location_values_are_trimmed_and_valid_IANA_timezone_is_persisted()
    {
        var json = JsonNode.Parse(JsonSerializer.Serialize(Payload(seed.Alpha.Id), WebJson))!.AsObject();
        var location = json["location"]!.AsObject();
        location["streetAddress"] = "  12 Rue de la Paix  ";
        location["postalCode"] = "  75001  ";
        location["city"] = "  Paris  ";
        location["country"] = "  France  ";
        location["region"] = "  Île-de-France  ";
        location["timeZoneId"] = "  Europe/Paris  ";

        using var response = await SendAsync(HttpMethod.Post, "/api/events", seed.Organizer.Id, "Organizer", json, "manual-location");
        var raw = await response.Content.ReadAsStringAsync();

        Assert.True(response.StatusCode == HttpStatusCode.Created, raw);
        var eventId = JsonDocument.Parse(raw).RootElement.GetProperty("id").GetGuid();
        await using var database = CreateContext();
        var stored = await database.Events.AsNoTracking().SingleAsync(item => item.Id == eventId);
        Assert.Equal("12 Rue de la Paix", stored.StreetAddress);
        Assert.Equal("75001", stored.PostalCode);
        Assert.Equal("Paris", stored.City);
        Assert.Equal("France", stored.Country);
        Assert.Equal("Île-de-France", stored.Region);
        Assert.Equal("Europe/Paris", stored.TimeZoneId);
    }

    [Fact]
    public async Task Unknown_IANA_timezone_returns_field_validation_and_rolls_back_Event()
    {
        var json = JsonNode.Parse(JsonSerializer.Serialize(Payload(seed.Alpha.Id), WebJson))!.AsObject();
        var location = json["location"]!.AsObject();
        location["timeZoneId"] = "Europe/Nope";

        using var response = await SendAsync(HttpMethod.Post, "/api/events", seed.Organizer.Id, "Organizer", json, "invalid-timezone");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("validation_failed", body.GetProperty("code").GetString());
        Assert.True(body.GetProperty("errors").TryGetProperty("location.timeZoneId", out _), body.ToString());
        await using var database = CreateContext();
        Assert.Equal(0, await database.Events.CountAsync(item => item.Title == "Summer Cup"));
        Assert.Equal(0, await database.IdempotencyRecords.CountAsync(item => item.Key == "invalid-timezone"));
    }

    [Fact]
    public async Task Latest_migration_removes_provider_geodata_columns()
    {
        await using var database = CreateContext();
        var columns = await database.Database.SqlQueryRaw<string>("""
            SELECT column_name AS "Value"
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'events'
            """).ToListAsync();

        Assert.DoesNotContain("provider_place_id", columns);
        Assert.DoesNotContain("latitude", columns);
        Assert.DoesNotContain("longitude", columns);
        Assert.Contains("time_zone_id", columns);
    }

    [Fact]
    public async Task Invalid_location_rolls_back_Event_and_image_promotion()
    {
        var image = EventImage.CreateTemporary(Guid.NewGuid(), seed.Organizer.Id, 960, 540, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.Add(image);
            await database.SaveChangesAsync();
        }
        var payload = Payload(seed.Alpha.Id) with
        {
            Title = "Invalid Location Cup",
            Location = Location() with { TimeZoneId = "Europe/Nope" },
            Images = [new(image.Id, null)]
        };

        using var response = await PublishAsync(seed.Organizer.Id, "invalid-location", payload);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("validation_failed", await ProblemCode(response));

        await using var verify = CreateContext();
        Assert.Equal(0, await verify.Events.CountAsync(item => item.Title == payload.Title));
        Assert.Equal(EventImageState.Temporary, (await verify.EventImages.AsNoTracking().SingleAsync(item => item.Id == image.Id)).State);
    }

    [Fact]
    public async Task Direct_publish_requires_nested_postal_region_and_capacity()
    {
        var json = JsonNode.Parse(JsonSerializer.Serialize(Payload(seed.Alpha.Id), WebJson))!.AsObject();
        json.Remove("capacity");
        var location = json["location"]!.AsObject();
        location.Remove("postalCode");
        location.Remove("region");

        using var response = await SendAsync(HttpMethod.Post, "/api/events", seed.Organizer.Id, "Organizer", json, "required-fields");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.True(errors.TryGetProperty("capacity", out _), errors.ToString());
        Assert.True(errors.TryGetProperty("location.postalCode", out _), errors.ToString());
        Assert.True(errors.TryGetProperty("location.region", out _), errors.ToString());
        await using var verify = CreateContext();
        Assert.Equal(0, await verify.IdempotencyRecords.CountAsync(item => item.Key == "required-fields"));
    }

    [Fact]
    public async Task Null_image_item_returns_nested_validation_error()
    {
        var json = JsonNode.Parse(JsonSerializer.Serialize(Payload(seed.Alpha.Id), WebJson))!.AsObject();
        json["images"] = JsonNode.Parse("[null]");

        using var response = await SendAsync(HttpMethod.Post, "/api/events", seed.Organizer.Id, "Organizer", json, "null-image");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.True(errors.TryGetProperty("images[0]", out _), errors.ToString());
        await using var verify = CreateContext();
        Assert.Equal(0, await verify.Events.CountAsync());
    }

    [Fact]
    public async Task Daylight_saving_gap_maps_to_startsAtLocal()
    {
        var payload = Payload(seed.Alpha.Id) with { StartsAtLocal = "2035-03-25T02:30" };

        using var response = await PublishAsync(seed.Organizer.Id, "dst-gap", payload);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.True(errors.TryGetProperty("startsAtLocal", out _), errors.ToString());
        Assert.False(errors.TryGetProperty("payload", out _), errors.ToString());
    }

    [Fact]
    public async Task Reused_idempotency_key_with_different_payload_conflicts()
    {
        using var first = await PublishAsync(seed.Organizer.Id, "same-key", Payload(seed.Alpha.Id));
        using var conflict = await PublishAsync(
            seed.Organizer.Id,
            "same-key",
            Payload(seed.Alpha.Id) with { Title = "Other Cup" });
        using var missingKey = await SendAsync(HttpMethod.Post, "/api/events", seed.Organizer.Id, "Organizer", Payload(seed.Alpha.Id));

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Equal("idempotency_conflict", await ProblemCode(conflict));
        Assert.Equal(HttpStatusCode.BadRequest, missingKey.StatusCode);
        await using var verify = CreateContext();
        Assert.Equal(1, await verify.Events.CountAsync());
    }

    [Fact]
    public async Task Direct_publish_enforces_auth_membership_and_draft_organization()
    {
        using var anonymous = await Client.PostAsJsonAsync("/api/events", Payload(seed.Alpha.Id));
        using var plain = await SendAsync(HttpMethod.Post, "/api/events", seed.Organizer.Id, "User", Payload(seed.Alpha.Id), "plain");
        using var foreign = await PublishAsync(seed.Organizer.Id, "foreign-org", Payload(seed.Beta.Id));
        using var missing = await PublishAsync(seed.Organizer.Id, "missing-org", Payload(Guid.NewGuid()));
        using var draft = await SendAsync(HttpMethod.Post, "/api/events", seed.Admin.Id, "Admin", Payload(seed.Draft.Id), "draft");
        using var admin = await SendAsync(HttpMethod.Post, "/api/events", seed.Admin.Id, "Admin", Payload(seed.Beta.Id), "admin");

        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, plain.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, draft.StatusCode);
        Assert.Equal("organization_is_draft", await ProblemCode(draft));
        Assert.Equal(HttpStatusCode.Created, admin.StatusCode);
    }

    [Fact]
    public async Task Concurrent_duplicate_titles_receive_unique_deterministic_slugs()
    {
        var payload = Payload(seed.Alpha.Id) with { Title = "Concurrent Cup" };
        var responses = await Task.WhenAll(
            PublishAsync(seed.Organizer.Id, "concurrent-1", payload),
            PublishAsync(seed.Organizer.Id, "concurrent-2", payload));
        using var first = responses[0];
        using var second = responses[1];

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.Created, response.StatusCode));
        var slugs = new[]
        {
            (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("slug").GetString(),
            (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("slug").GetString()
        };
        Assert.Equal(new[] { "concurrent-cup-legacy", "concurrent-cup-legacy-2" }, slugs.Order(StringComparer.Ordinal).ToArray());
    }

    private Task<HttpResponseMessage> PublishAsync(Guid userId, string idempotencyKey, EventPayload payload) =>
        SendAsync(HttpMethod.Post, "/api/events", userId, "Organizer", payload, idempotencyKey);

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method,
        string url,
        Guid userId,
        string role,
        object body,
        string? idempotencyKey = null)
    {
        using var request = new HttpRequestMessage(method, url) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-Test-User", userId.ToString("D"));
        request.Headers.Add("X-Test-Roles", role);
        if (idempotencyKey is not null) request.Headers.Add("Idempotency-Key", idempotencyKey);
        return await Client.SendAsync(request);
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t5-location-signing-key-with-more-than-32-characters");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(clock);
            });
        });

    private static async Task<SeedRows> SeedAsync(GonesDbContext database)
    {
        var organizer = User("Organizer", GlobalRoles.Organizer);
        var outsider = User("Outsider", GlobalRoles.Organizer);
        var admin = User("Admin", GlobalRoles.Admin);
        var alpha = Organization.Create("Alpha Club", "Public alpha", "https://alpha.example", "alpha@example.test", Now);
        var beta = Organization.Create("Beta Club", null, null, null, Now);
        var draft = Organization.Create("Draft Club", null, null, null, Now);
        var legacy = await database.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug)
            ?? TournamentFormat.CreateLegacy(Now);
        database.Users.AddRange(organizer, outsider, admin);
        database.Organizations.AddRange(alpha, beta, draft);
        if (database.Entry(legacy).State == EntityState.Detached) database.TournamentFormats.Add(legacy);
        await database.SaveChangesAsync();
        database.OrganizationMembers.AddRange(
            OrganizationMember.Create(alpha.Id, organizer.Id, OrganizationRoles.Organizer, Now),
            OrganizationMember.Create(beta.Id, outsider.Id, OrganizationRoles.Organizer, Now));
        await database.SaveChangesAsync();
        return new SeedRows(alpha, beta, draft, organizer, outsider, admin, legacy);
    }

    private static ApplicationUser User(string prefix, string role)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = $"{prefix}-{suffix}@example.test",
            NormalizedUserName = $"{prefix.ToUpperInvariant()}-{suffix}@EXAMPLE.TEST",
            Email = $"{prefix}-{suffix}@example.test",
            NormalizedEmail = $"{prefix.ToUpperInvariant()}-{suffix}@EXAMPLE.TEST",
            EmailConfirmed = true,
            SecurityStamp = Guid.NewGuid().ToString("N"),
            ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
        user.AssignGlobalRole(role);
        return user;
    }

    private EventPayload Payload(Guid organizationId) => new(
        organizationId,
        "Summer Cup",
        "Featured",
        "Welcome",
        Location(),
        "weekly",
        "2035-03-04T10:00",
        64,
        [seed.Legacy.Id],
        []);

    private static LocationPayload Location() => new(
        "12 Rue de la Paix",
        "75001",
        "Paris",
        "France",
        "Auvergne-Rhône-Alpes",
        "Europe/Paris");

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options;
        return new GonesDbContext(options);
    }

    private static async Task<string?> ProblemCode(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString();

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    private sealed record SeedRows(
        Organization Alpha,
        Organization Beta,
        Organization Draft,
        ApplicationUser Organizer,
        ApplicationUser Outsider,
        ApplicationUser Admin,
        TournamentFormat Legacy);

    private sealed record EventPayload(
        Guid OrganizationId,
        string Title,
        string? Summary,
        string? BodyMarkdown,
        LocationPayload Location,
        string EventType,
        string StartsAtLocal,
        int Capacity,
        IReadOnlyList<Guid> FormatIds,
        IReadOnlyList<ImagePayload> Images);

    private sealed record LocationPayload(
        string StreetAddress,
        string PostalCode,
        string City,
        string Country,
        string Region,
        string TimeZoneId);

    private sealed record ImagePayload(Guid ImageId, string? AltText);

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Advance(Duration duration) => current += duration;
    }
}
