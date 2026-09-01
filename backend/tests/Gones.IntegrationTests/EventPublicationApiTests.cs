using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
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
    private readonly MutableClock clock = new(Instant.FromUtc(2030, 1, 1, 12, 0));
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
    public async Task Preview_requires_organizer_and_org_membership_without_disclosing_foreign_org()
    {
        using var anonymous = await Client.PostAsJsonAsync("/api/events/preview", Payload(seed.Alpha.Id));
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var user = await SendAsync(HttpMethod.Post, "/api/events/preview", seed.Organizer.Id, "User", Payload(seed.Alpha.Id));
        Assert.Equal(HttpStatusCode.Forbidden, user.StatusCode);

        using var foreign = await SendAsync(HttpMethod.Post, "/api/events/preview", seed.Outsider.Id, "Organizer", Payload(seed.Alpha.Id));
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);

        using var missing = await SendAsync(HttpMethod.Post, "/api/events/preview", seed.Outsider.Id, "Organizer", Payload(Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(await ProblemCode(foreign), await ProblemCode(missing));

        using var allowed = await PreviewAsync(seed.Organizer.Id, Payload(seed.Alpha.Id));
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
    }

    [Fact]
    public async Task Preview_requires_exactly_one_format_and_round_trips_tournament_links()
    {
        using var zero = await PreviewAsync(seed.Organizer.Id, Payload(seed.Alpha.Id) with { FormatIds = [] });
        Assert.Equal(HttpStatusCode.BadRequest, zero.StatusCode);
        Assert.True((await zero.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("formatIds", out _));

        using var two = await PreviewAsync(seed.Organizer.Id, Payload(seed.Alpha.Id) with { FormatIds = [seed.Legacy.Id, seed.Modern.Id] });
        Assert.Equal(HttpStatusCode.BadRequest, two.StatusCode);
        Assert.True((await two.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("formatIds", out _));

        var payload = Payload(seed.Alpha.Id) with
        {
            FormatIds = [seed.Modern.Id],
            LiveTournamentUrl = " /live/123 ",
            ArchiveTournamentUrl = "https://example.test/archive/123"
        };
        using var preview = await PreviewAsync(seed.Organizer.Id, payload);
        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        var render = (await preview.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("render");
        Assert.Equal("Modern — Summer Cup", render.GetProperty("displayTitle").GetString());
        Assert.Equal("/live/123", render.GetProperty("liveTournamentUrl").GetString());
        Assert.Equal("https://example.test/archive/123", render.GetProperty("archiveTournamentUrl").GetString());

        using var unsafeUrl = await PreviewAsync(seed.Organizer.Id, payload with { LiveTournamentUrl = "javascript:alert(1)" });
        Assert.Equal(HttpStatusCode.BadRequest, unsafeUrl.StatusCode);
    }

    [Fact]
    public async Task Preview_normalizes_on_server_rejects_zone_and_dst_gap_and_creates_no_draft()
    {
        await using var before = CreateContext();
        var initialCount = await before.Events.CountAsync();

        var payload = Payload(seed.Alpha.Id) with
        {
            Title = "  Summer Cup  ",
            Summary = "  Featured  ",
            BodyMarkdown = "Safe & **bold**",
            StreetAddress = "  12 Rue de la Paix  "
        };
        using var preview = await PreviewAsync(seed.Organizer.Id, payload);
        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        var body = await preview.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("previewTicket").GetString()));
        var render = body.GetProperty("render");
        Assert.Equal("Summer Cup", render.GetProperty("title").GetString());
        Assert.Equal("Featured", render.GetProperty("summary").GetString());
        Assert.Equal("<p>Safe &amp; <strong>bold</strong></p>", render.GetProperty("bodyHtml").GetString());
        Assert.Equal(0, render.GetProperty("images").GetArrayLength());
        Assert.Equal("12 Rue de la Paix", render.GetProperty("venue").GetProperty("streetAddress").GetString());
        Assert.Equal("2035-03-04T09:00:00Z", render.GetProperty("startsAtUtc").GetString());

        await using var after = CreateContext();
        Assert.Equal(initialCount, await after.Events.CountAsync());

        using var invalidZone = await PreviewAsync(seed.Organizer.Id, Payload(seed.Alpha.Id) with { TimeZoneId = "Mars/Olympus" });
        Assert.Equal(HttpStatusCode.BadRequest, invalidZone.StatusCode);

        using var dstGap = await PreviewAsync(seed.Organizer.Id, Payload(seed.Alpha.Id) with { StartsAtLocal = "2035-03-25T02:30:00" });
        Assert.Equal(HttpStatusCode.BadRequest, dstGap.StatusCode);
    }

    [Fact]
    public async Task Mutated_payload_is_rejected_original_publishes_once_and_retry_is_idempotent()
    {
        var payload = Payload(seed.Alpha.Id) with { BodyMarkdown = "  Welcome  \n" };
        var ticket = await GetTicketAsync(seed.Organizer.Id, payload);

        using var mutated = await PublishAsync(seed.Organizer.Id, "mutated-key", ticket, payload with { City = "Lyon" });
        Assert.Equal(HttpStatusCode.BadRequest, mutated.StatusCode);

        using var published = await PublishAsync(seed.Organizer.Id, "publish-once", ticket, payload);
        Assert.Equal(HttpStatusCode.Created, published.StatusCode);
        Assert.NotNull(published.Headers.Location);
        Assert.NotNull(published.Headers.ETag);
        var firstBody = await published.Content.ReadFromJsonAsync<JsonElement>();
        var tournamentId = firstBody.GetProperty("id").GetGuid();
        Assert.Equal("summer-cup-legacy", firstBody.GetProperty("slug").GetString());

        using var retry = await PublishAsync(seed.Organizer.Id, "publish-once", ticket, payload);
        Assert.Equal(HttpStatusCode.Created, retry.StatusCode);
        var retryBody = await retry.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(tournamentId, retryBody.GetProperty("id").GetGuid());
        Assert.Equal(published.Headers.Location, retry.Headers.Location);
        Assert.Equal(published.Headers.ETag, retry.Headers.ETag);

        using var replay = await PublishAsync(seed.Organizer.Id, "replay-key", ticket, payload);
        Assert.Equal(HttpStatusCode.Conflict, replay.StatusCode);

        using var detail = await Client.GetAsync("/api/events/summer-cup-legacy");
        var publicEvent = await detail.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(payload.Region, publicEvent.GetProperty("venue").GetProperty("region").GetString());
        Assert.Equal(payload.EventType, publicEvent.GetProperty("eventType").GetString());

        await using var database = CreateContext();
        var stored = await database.Events.SingleAsync(item => item.Id == tournamentId);
        Assert.Equal(payload.Region, stored.Region);
        Assert.Equal(payload.BodyMarkdown, stored.BodyMarkdown);
        Assert.Equal(CalendarEventType.Weekly, stored.EventType);
        Assert.Equal(1, await database.Events.CountAsync(item => item.Id == tournamentId));
        Assert.Equal(1, await database.AuditRecords.CountAsync(item => item.Action == "tournament.published" && item.EntityId == tournamentId.ToString("D")));
        Assert.Equal(1, await database.IdempotencyRecords.CountAsync(item => item.Scope.Contains(seed.Organizer.Id.ToString("D")) && item.Key == "publish-once"));
    }

    [Fact]
    public async Task Expired_or_cross_user_ticket_and_reused_idempotency_key_are_rejected()
    {
        var payload = Payload(seed.Alpha.Id);
        var ticket = await GetTicketAsync(seed.Organizer.Id, payload);

        using var crossUser = await PublishAsync(seed.SecondOrganizer.Id, "cross-user", ticket, payload);
        Assert.Equal(HttpStatusCode.BadRequest, crossUser.StatusCode);

        var tamperedTicket = (ticket[0] == 'A' ? 'B' : 'A') + ticket[1..];
        using var tampered = await PublishAsync(seed.Organizer.Id, "tampered", tamperedTicket, payload);
        Assert.Equal(HttpStatusCode.BadRequest, tampered.StatusCode);

        using var missingKey = await SendAsync(HttpMethod.Post, "/api/events", seed.Organizer.Id, "Organizer", new { previewTicket = ticket, payload });
        Assert.Equal(HttpStatusCode.BadRequest, missingKey.StatusCode);

        clock.Advance(Duration.FromMinutes(11));
        using var expired = await PublishAsync(seed.Organizer.Id, "expired", ticket, payload);
        Assert.Equal(HttpStatusCode.BadRequest, expired.StatusCode);

        clock.Advance(Duration.FromMinutes(-11));
        var firstTicket = await GetTicketAsync(seed.Organizer.Id, payload);
        using var first = await PublishAsync(seed.Organizer.Id, "same-key", firstTicket, payload);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var otherPayload = payload with { Title = "Other Cup" };
        var secondTicket = await GetTicketAsync(seed.Organizer.Id, otherPayload);
        using var conflictingRetry = await PublishAsync(seed.Organizer.Id, "same-key", secondTicket, otherPayload);
        Assert.Equal(HttpStatusCode.Conflict, conflictingRetry.StatusCode);
    }

    [Fact]
    public async Task Concurrent_ticket_replay_creates_one_tournament()
    {
        var payload = Payload(seed.Alpha.Id) with { Title = "Replay Race Cup" };
        var ticket = await GetTicketAsync(seed.Organizer.Id, payload);

        var responses = await Task.WhenAll(
            PublishAsync(seed.Organizer.Id, "replay-race-1", ticket, payload),
            PublishAsync(seed.Organizer.Id, "replay-race-2", ticket, payload));
        using var first = responses[0];
        using var second = responses[1];
        Assert.Contains(HttpStatusCode.Created, responses.Select(response => response.StatusCode));
        Assert.Contains(HttpStatusCode.Conflict, responses.Select(response => response.StatusCode));

        await using var database = CreateContext();
        Assert.Equal(1, await database.Events.CountAsync(item => item.Title == "Replay Race Cup"));
    }

    [Fact]
    public async Task Format_specific_slug_truncates_title_prefix_within_event_bound()
    {
        using var preview = await PreviewAsync(seed.Organizer.Id, Payload(seed.Alpha.Id) with
        {
            Title = new string('A', Event.MaximumTitleLength),
            FormatIds = [seed.LongSlugFormat.Id]
        });
        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        var slug = (await preview.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("render").GetProperty("slug").GetString()!;

        Assert.Equal(Event.MaximumSlugLength, slug.Length);
        Assert.EndsWith($"-{seed.LongSlugFormat.Slug}", slug, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Concurrent_duplicate_titles_receive_unique_deterministic_slugs()
    {
        var payload = Payload(seed.Alpha.Id) with { Title = "Concurrent Cup" };
        var firstTicket = await GetTicketAsync(seed.Organizer.Id, payload);
        var secondTicket = await GetTicketAsync(seed.Organizer.Id, payload);

        var responses = await Task.WhenAll(
            PublishAsync(seed.Organizer.Id, "concurrent-1", firstTicket, payload),
            PublishAsync(seed.Organizer.Id, "concurrent-2", secondTicket, payload));
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

    [Fact]
    public async Task Publish_validates_required_nested_payload_fields()
    {
        var payload = Payload(seed.Alpha.Id) with { Title = "Nested Validation Cup" };
        var numeric = JsonNode.Parse(JsonSerializer.Serialize(payload))!.AsObject();
        numeric["EventType"] = 0;
        using var invalidEnum = await SendAsync(HttpMethod.Post, "/api/events/preview", seed.Organizer.Id, "Organizer", numeric);
        Assert.Equal(HttpStatusCode.BadRequest, invalidEnum.StatusCode);
        var ticket = await GetTicketAsync(seed.Organizer.Id, payload);
        var missing = JsonNode.Parse(JsonSerializer.Serialize(payload))!.AsObject();
        missing.Remove("Region");
        missing.Remove("EventType");
        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/events",
            seed.Organizer.Id,
            "Organizer",
            new { previewTicket = ticket, payload = missing },
            "nested-validation");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        var errors = problem.GetProperty("errors");
        Assert.True(errors.TryGetProperty("region", out _));
        Assert.True(errors.TryGetProperty("eventType", out _));
        await using var database = CreateContext();
        Assert.Equal(0, await database.Events.CountAsync(item => item.Title == payload.Title));
        Assert.Equal(0, await database.IdempotencyRecords.CountAsync(item => item.Key == "nested-validation"));
    }

    [Fact]
    public async Task Extra_request_fields_cannot_assign_server_controlled_state()
    {
        var payload = Payload(seed.Alpha.Id) with { Title = "Mass Assignment Cup" };
        var ticket = await GetTicketAsync(seed.Organizer.Id, payload);
        var attackerId = Guid.NewGuid();
        var poisoned = new Dictionary<string, object?>
        {
            ["organizationId"] = payload.OrganizationId,
            ["title"] = payload.Title,
            ["summary"] = payload.Summary,
            ["bodyMarkdown"] = payload.BodyMarkdown,
            ["streetAddress"] = payload.StreetAddress,
            ["postalCode"] = payload.PostalCode,
            ["city"] = payload.City,
            ["country"] = payload.Country,
            ["region"] = payload.Region,
            ["eventType"] = payload.EventType,
            ["timeZoneId"] = payload.TimeZoneId,
            ["startsAtLocal"] = payload.StartsAtLocal,
            ["endsAtLocal"] = payload.EndsAtLocal,
            ["capacity"] = payload.Capacity,
            ["formatIds"] = payload.FormatIds,
            // Every key below is server-owned and must be ignored no matter what a client sends.
            ["id"] = attackerId,
            ["slug"] = "attacker-controlled-slug",
            ["status"] = "Completed",
            ["createdByUserId"] = attackerId,
            ["deletedAt"] = "2030-01-01T00:00:00Z",
            ["deletedByUserId"] = attackerId,
            ["version"] = 999,
            ["createdAt"] = "2000-01-01T00:00:00Z",
            ["normalizedSearchText"] = "poison"
        };

        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/events",
            seed.Organizer.Id,
            "Organizer",
            new { previewTicket = ticket, payload = poisoned },
            "mass-assignment");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = body.GetProperty("id").GetGuid();
        Assert.NotEqual(attackerId, id);
        Assert.Equal("mass-assignment-cup-legacy", body.GetProperty("slug").GetString());
        Assert.Equal("Published", body.GetProperty("status").GetString());

        await using var database = CreateContext();
        var stored = await database.Events.AsNoTracking().SingleAsync(entity => entity.Id == id);
        Assert.Equal(seed.Organizer.Id, stored.CreatedByUserId);
        Assert.Null(stored.DeletedAt);
        Assert.Null(stored.DeletedByUserId);
        Assert.Equal(1, stored.Version);
        Assert.Equal("mass-assignment-cup-legacy", stored.Slug);
        Assert.DoesNotContain("poison", stored.NormalizedSearchText, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("<script>alert('xss')</script>")]
    [InlineData("<p onclick=\"alert(1)\">hi</p>")]
    [InlineData("<img src=x onerror=alert(1)>")]
    [InlineData("<a href=\"javascript:alert(1)\">click</a>")]
    [InlineData("<iframe src=\"https://evil.test\"></iframe>")]
    [InlineData("<svg/onload=alert(1)>")]
    [InlineData("<p style=\"background:url(javascript:alert(1))\">styled</p>")]
    [InlineData("<a href=\"http://evil.test\" onmouseover=\"alert(1)\">link</a>")]
    public async Task Body_markdown_xss_payloads_render_inert_without_mutating_source(string payloadMarkdown)
    {
        using var preview = await PreviewAsync(seed.Organizer.Id, Payload(seed.Alpha.Id) with { BodyMarkdown = payloadMarkdown });

        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        var body = await preview.Content.ReadFromJsonAsync<JsonElement>();
        var rendered = body.GetProperty("render").GetProperty("bodyHtml").GetString() ?? string.Empty;
        Assert.DoesNotContain("<script", rendered, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<img", rendered, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<iframe", rendered, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<svg", rendered, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("href=\"javascript:", rendered, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Text_fields_are_stored_escaped_and_never_rendered_as_markup()
    {
        var payload = Payload(seed.Alpha.Id) with
        {
            Title = "Cup <script>alert(1)</script>",
            Summary = "Summary \"><img src=x onerror=alert(1)>",
            BodyMarkdown = "Safe [rules](https://example.test/rules)"
        };
        var ticket = await GetTicketAsync(seed.Organizer.Id, payload);
        using var published = await PublishAsync(seed.Organizer.Id, "xss-text", ticket, payload);
        Assert.Equal(HttpStatusCode.Created, published.StatusCode);
        var slug = (await published.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("slug").GetString();

        using var detail = await Client.GetAsync($"/api/events/{slug}");
        var body = await detail.Content.ReadFromJsonAsync<JsonElement>();
        var bodyHtml = body.GetProperty("bodyHtml").GetString()!;

        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        // Title/summary are plain text fields; they must round-trip verbatim as data, never as markup,
        // and the only HTML the API ever returns is the allowlisted sanitizer output.
        Assert.Equal("Cup <script>alert(1)</script>", body.GetProperty("title").GetString());
        Assert.DoesNotContain("<script", bodyHtml, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("onerror", bodyHtml, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("href=\"https://example.test/rules\"", bodyHtml, StringComparison.Ordinal);
        Assert.Equal("application/json", detail.Content.Headers.ContentType?.MediaType);
        Assert.Equal("nosniff", detail.Headers.GetValues("X-Content-Type-Options").Single());
    }

    /// <summary>
    /// T11: an organization with no members is a Draft, and a Draft cannot publish. Only an admin can
    /// even reach the publish path for one - a member-less organization has nobody whose membership
    /// check could pass - so the refusal is proved with an admin caller, server-side, and a staffed
    /// organization in the same run proves the gate is not blanket.
    /// </summary>
    [Fact]
    public async Task Draft_organization_cannot_publish_but_a_staffed_one_still_can()
    {
        var draftPayload = Payload(seed.Draft.Id) with { Title = "Draft Org Cup" };
        using var draftPreview = await SendAsync(HttpMethod.Post, "/api/events/preview", seed.Admin.Id, "Admin", draftPayload);
        Assert.Equal(HttpStatusCode.OK, draftPreview.StatusCode);
        var draftTicket = (await draftPreview.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("previewTicket").GetString()!;

        using var refused = await SendAsync(
            HttpMethod.Post,
            "/api/events",
            seed.Admin.Id,
            "Admin",
            new { previewTicket = draftTicket, payload = draftPayload },
            "draft-org-publish");
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("organization_is_draft", await ProblemCode(refused));

        await using (var database = CreateContext())
        {
            Assert.Equal(0, await database.Events.CountAsync(item => item.OrganizationId == seed.Draft.Id));
            // The refusal must not burn the idempotency key or the preview ticket either.
            Assert.Equal(0, await database.IdempotencyRecords.CountAsync(item => item.Key == "draft-org-publish"));
        }

        // Staffing the organization lifts the gate with no other change.
        await using (var database = CreateContext())
        {
            database.OrganizationMembers.Add(OrganizationMember.Create(seed.Draft.Id, seed.Organizer.Id, OrganizationRoles.Organizer, Now));
            await database.SaveChangesAsync();
        }

        using var staffed = await SendAsync(
            HttpMethod.Post,
            "/api/events",
            seed.Admin.Id,
            "Admin",
            new { previewTicket = draftTicket, payload = draftPayload },
            "draft-org-publish");
        Assert.Equal(HttpStatusCode.Created, staffed.StatusCode);
        Assert.Equal("draft-org-cup-legacy", (await staffed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("slug").GetString());
    }

    /// <summary>
    /// T14: the create form offers an admin every organization, so the widening has to be the
    /// server's rather than the picker's. An admin publishes for an organization they do not belong
    /// to; an organizer sending the very same payload - and even the admin's preview ticket - is
    /// refused, and refused indistinguishably from an organization that does not exist, so no
    /// picker can be turned into an enumeration oracle.
    /// </summary>
    [Fact]
    public async Task Admin_publishes_for_a_non_member_organization_and_an_organizer_still_cannot()
    {
        await using (var database = CreateContext())
        {
            Assert.False(await database.OrganizationMembers
                .AnyAsync(member => member.OrganizationId == seed.Beta.Id && member.UserId == seed.Admin.Id));
            Assert.False(await database.OrganizationMembers
                .AnyAsync(member => member.OrganizationId == seed.Beta.Id && member.UserId == seed.Organizer.Id));
        }

        var payload = Payload(seed.Beta.Id) with { Title = "Cross Org Cup" };
        using var adminPreview = await SendAsync(HttpMethod.Post, "/api/events/preview", seed.Admin.Id, "Admin", payload);
        Assert.Equal(HttpStatusCode.OK, adminPreview.StatusCode);
        var ticket = (await adminPreview.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("previewTicket").GetString()!;

        using var foreignPublish = await SendAsync(
            HttpMethod.Post,
            "/api/events",
            seed.Organizer.Id,
            "Organizer",
            new { previewTicket = ticket, payload },
            "cross-org-organizer");
        Assert.Equal(HttpStatusCode.NotFound, foreignPublish.StatusCode);

        using var missingPublish = await SendAsync(
            HttpMethod.Post,
            "/api/events",
            seed.Organizer.Id,
            "Organizer",
            new { previewTicket = ticket, payload = payload with { OrganizationId = Guid.NewGuid() } },
            "cross-org-missing");
        Assert.Equal(HttpStatusCode.NotFound, missingPublish.StatusCode);
        Assert.Equal(await ProblemCode(foreignPublish), await ProblemCode(missingPublish));

        using var adminPublish = await SendAsync(
            HttpMethod.Post,
            "/api/events",
            seed.Admin.Id,
            "Admin",
            new { previewTicket = ticket, payload },
            "cross-org-admin");
        Assert.Equal(HttpStatusCode.Created, adminPublish.StatusCode);

        await using (var verify = CreateContext())
        {
            var stored = await verify.Events.SingleAsync(item => item.Title == "Cross Org Cup");
            Assert.Equal(seed.Beta.Id, stored.OrganizationId);
            Assert.Equal(seed.Admin.Id, stored.CreatedByUserId);
            // The two refusals wrote nothing at all, not even an idempotency record to replay.
            Assert.Equal(0, await verify.IdempotencyRecords.CountAsync(item => item.Key == "cross-org-organizer" || item.Key == "cross-org-missing"));
        }
    }

    private async Task<HttpResponseMessage> PreviewAsync(Guid userId, TournamentPayload payload) =>
        await SendAsync(HttpMethod.Post, "/api/events/preview", userId, "Organizer", payload);

    private async Task<string> GetTicketAsync(Guid userId, TournamentPayload payload)
    {
        using var response = await PreviewAsync(userId, payload);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("previewTicket").GetString()!;
    }

    private Task<HttpResponseMessage> PublishAsync(Guid userId, string idempotencyKey, string ticket, TournamentPayload payload) =>
        SendAsync(HttpMethod.Post, "/api/events", userId, "Organizer", new { previewTicket = ticket, payload }, idempotencyKey);

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid userId, string role, object body, string? idempotencyKey = null)
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
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c19-preview-ticket-signing-key-with-more-than-32-characters");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(clock);
            });
        });

    private static async Task<SeedRows> SeedAsync(GonesDbContext database)
    {
        var organizer = User("Organizer");
        var secondOrganizer = User("SecondOrganizer");
        var outsider = User("Outsider");
        var admin = User("Admin");
        admin.AssignGlobalRole(GlobalRoles.Admin);
        var alpha = Organization.Create("Alpha Club", "Public alpha", "https://alpha.example", "alpha@example.test", Now);
        var beta = Organization.Create("Beta Club", null, null, null, Now);
        // Member-less on purpose: this is the Draft organization T11's publish gate must refuse.
        var draft = Organization.Create("Draft Club", null, null, null, Now);
        var legacy = await database.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug)
            ?? TournamentFormat.CreateLegacy(Now);
        var modern = TournamentFormat.Create("Modern", "modern", 10, Now);
        var longSlugFormat = TournamentFormat.Create("Long format", new string('f', TournamentFormat.MaximumSlugLength), 20, Now);
        database.Users.AddRange(organizer, secondOrganizer, outsider, admin);
        database.Organizations.AddRange(alpha, beta, draft);
        if (database.Entry(legacy).State == EntityState.Detached) database.TournamentFormats.Add(legacy);
        database.TournamentFormats.AddRange(modern, longSlugFormat);
        await database.SaveChangesAsync();
        database.OrganizationMembers.AddRange(
            OrganizationMember.Create(alpha.Id, organizer.Id, OrganizationRoles.Organizer, Now),
            OrganizationMember.Create(alpha.Id, secondOrganizer.Id, OrganizationRoles.Organizer, Now),
            OrganizationMember.Create(beta.Id, outsider.Id, OrganizationRoles.Organizer, Now));
        await database.SaveChangesAsync();
        return new SeedRows(alpha, beta, draft, organizer, secondOrganizer, outsider, admin, legacy, modern, longSlugFormat);
    }

    private static ApplicationUser User(string prefix)
    {
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = $"{prefix}-{Guid.NewGuid():N}@example.test",
            NormalizedUserName = $"{prefix.ToUpperInvariant()}-{Guid.NewGuid():N}@EXAMPLE.TEST",
            Email = $"{prefix}-{Guid.NewGuid():N}@example.test",
            NormalizedEmail = $"{prefix.ToUpperInvariant()}-{Guid.NewGuid():N}@EXAMPLE.TEST",
            EmailConfirmed = true,
            SecurityStamp = Guid.NewGuid().ToString("N"),
            ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
        user.AssignGlobalRole(GlobalRoles.Organizer);
        return user;
    }

    private TournamentPayload Payload(Guid organizationId) => new(
        organizationId,
        "Summer Cup",
        "Featured",
        "Welcome",
        "12 Rue de la Paix",
        "75001",
        "Paris",
        "France",
        "Europe/Paris",
        "2035-03-04T10:00:00",
        "2035-03-04T18:00:00",
        64,
        [seed.Legacy.Id]);

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options;
        return new GonesDbContext(options);
    }

    private static async Task<string?> ProblemCode(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString();

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);

    private sealed record SeedRows(
        Organization Alpha,
        Organization Beta,
        Organization Draft,
        ApplicationUser Organizer,
        ApplicationUser SecondOrganizer,
        ApplicationUser Outsider,
        ApplicationUser Admin,
        TournamentFormat Legacy,
        TournamentFormat Modern,
        TournamentFormat LongSlugFormat);

    private sealed record TournamentPayload(
        Guid OrganizationId,
        string Title,
        string? Summary,
        string? BodyMarkdown,
        string StreetAddress,
        string? PostalCode,
        string City,
        string Country,
        string TimeZoneId,
        string StartsAtLocal,
        string? EndsAtLocal,
        int? Capacity,
        IReadOnlyList<Guid> FormatIds,
        string? LiveTournamentUrl = null,
        string? ArchiveTournamentUrl = null,
        string Region = "Auvergne-Rhône-Alpes",
        string EventType = "weekly");

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Advance(Duration duration) => current += duration;
    }
}
