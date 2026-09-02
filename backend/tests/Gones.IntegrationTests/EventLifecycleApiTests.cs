using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Application.Concurrency;
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

public sealed class EventLifecycleApiTests : IAsyncLifetime
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

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c21-lifecycle-signing-key-with-more-than-32-characters");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(clock);
            });
        });
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Organizer_list_is_paged_scoped_and_hides_deleted_while_admin_deleted_list_is_admin_only()
    {
        var alpha = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Alpha Cup");
        var beta = await CreateTournamentAsync(seed.Beta.Id, seed.Outsider.Id, "Beta Cup");
        var deleted = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Deleted Cup");
        deleted.SoftDelete(seed.Organizer.Id, "duplicate", clock.GetCurrentInstant());
        await using (var database = CreateContext())
        {
            database.Events.Update(deleted);
            await database.SaveChangesAsync();
        }

        using var organizerList = await SendAsync(HttpMethod.Get, "/api/organizer/events?page=1&pageSize=1", seed.Organizer.Id, "Organizer");
        Assert.Equal(HttpStatusCode.OK, organizerList.StatusCode);
        var organizerBody = await organizerList.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, organizerBody.GetProperty("items").GetArrayLength());
        Assert.Equal(alpha.OrganizationId, organizerBody.GetProperty("items")[0].GetProperty("organizationId").GetGuid());
        Assert.DoesNotContain(organizerBody.GetProperty("items").EnumerateArray(), item => item.GetProperty("id").GetGuid() == deleted.Id);

        using var adminList = await SendAsync(HttpMethod.Get, "/api/organizer/events?pageSize=100", seed.Admin.Id, "Admin");
        Assert.Equal(HttpStatusCode.OK, adminList.StatusCode);
        var adminListBody = await adminList.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(adminListBody.GetProperty("items").EnumerateArray(), item => item.GetProperty("id").GetGuid() == beta.Id);

        using var organizerDeleted = await SendAsync(HttpMethod.Get, "/api/admin/events/deleted", seed.Organizer.Id, "Organizer");
        Assert.Equal(HttpStatusCode.Forbidden, organizerDeleted.StatusCode);
        using var adminDeleted = await SendAsync(HttpMethod.Get, "/api/admin/events/deleted", seed.Admin.Id, "Admin");
        Assert.Equal(HttpStatusCode.OK, adminDeleted.StatusCode);
        var deletedBody = await adminDeleted.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(deletedBody.GetProperty("items").EnumerateArray(), item => item.GetProperty("id").GetGuid() == deleted.Id);
    }

    [Fact]
    public async Task Update_requires_fresh_if_match_rejects_cross_org_fields_and_records_major_marker_atomically()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Edit Cup");
        var details = Details("Renamed Cup") with
        {
            LiveTournamentUrl = "/live/edit-cup",
            ArchiveTournamentUrl = "https://example.test/archive/edit-cup"
        };

        using var zeroFormats = await SendJsonAsync(HttpMethod.Patch, $"/api/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", details with { FormatIds = [] }, ifMatch: StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.BadRequest, zeroFormats.StatusCode);
        using var twoFormats = await SendJsonAsync(HttpMethod.Patch, $"/api/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", details with { FormatIds = [seed.Legacy.Id, seed.Modern.Id] }, ifMatch: StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.BadRequest, twoFormats.StatusCode);

        using var missing = await SendJsonAsync(HttpMethod.Patch, $"/api/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", details);
        Assert.Equal(HttpStatusCode.PreconditionFailed, missing.StatusCode);
        using var stale = await SendJsonAsync(HttpMethod.Patch, $"/api/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", details, ifMatch: StrongETag.Encode(99));
        Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
        using var outsider = await SendJsonAsync(HttpMethod.Patch, $"/api/events/{tournament.Id:D}/details", seed.Outsider.Id, "Organizer", details, ifMatch: StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.NotFound, outsider.StatusCode);

        var massAssignment = JsonSerializer.Serialize(details).TrimEnd('}') + $",\"organizationId\":\"{seed.Beta.Id:D}\",\"slug\":\"hijack\",\"status\":\"Cancelled\"}}";
        using var rejected = await SendRawJsonAsync(HttpMethod.Patch, $"/api/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", massAssignment, StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);

        using var minor = await SendJsonAsync(HttpMethod.Patch, $"/api/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", details, ifMatch: StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.OK, minor.StatusCode);
        Assert.Equal(StrongETag.Encode(tournament.Version + 1), minor.Headers.ETag?.Tag);
        var minorBody = await minor.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Legacy — Renamed Cup", minorBody.GetProperty("displayTitle").GetString());
        Assert.Equal("/live/edit-cup", minorBody.GetProperty("liveTournamentUrl").GetString());
        Assert.Equal("https://example.test/archive/edit-cup", minorBody.GetProperty("archiveTournamentUrl").GetString());

        var majorDetails = details with { StreetAddress = "99 Major Street", Region = "Auvergne-Rhône-Alpes", EventType = "major", StartsAtLocal = "2035-03-05T10:00:00", EndsAtLocal = "2035-03-05T18:00:00", BodyMarkdown = "Secret changed body" };
        using var major = await SendJsonAsync(HttpMethod.Patch, $"/api/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", majorDetails, ifMatch: minor.Headers.ETag?.Tag);
        Assert.Equal(HttpStatusCode.OK, major.StatusCode);
        var majorBody = await major.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Auvergne-Rhône-Alpes", majorBody.GetProperty("region").GetString());
        Assert.Equal("major", majorBody.GetProperty("eventType").GetString());

        await using var database = CreateContext();
        var markers = await database.EventLifecycleEntries.Where(item => item.EventId == tournament.Id).ToListAsync();
        var marker = Assert.Single(markers);
        Assert.Equal(TournamentLifecycleEventType.MajorDetailsUpdated, marker.EventType);
        var changed = await database.Events.SingleAsync(item => item.Id == tournament.Id);
        Assert.Equal("Auvergne-Rhône-Alpes", changed.Region);
        Assert.Equal(CalendarEventType.Major, changed.EventType);
        Assert.Equal(TournamentReminderPlanAction.RecalculateFuture, marker.ReminderPlanAction);
        var audits = await database.AuditRecords.Where(item => item.EntityId == tournament.Id.ToString("D") && item.Action == "tournament.details.updated").OrderBy(item => item.OccurredAt).ToListAsync();
        Assert.Equal(2, audits.Count);
        Assert.Contains("bodyChanged", audits[1].RedactedDiff, StringComparison.Ordinal);
        Assert.DoesNotContain("Secret changed body", audits[1].RedactedDiff, StringComparison.Ordinal);
        Assert.Equal(seed.Alpha.Id, (await database.Events.SingleAsync(item => item.Id == tournament.Id)).OrganizationId);
    }

    [Fact]
    public async Task Update_then_public_detail_remove_XML_invalid_scalars_without_losing_valid_supplementary_text()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Control Cup");
        using var update = await SendJsonAsync(
            HttpMethod.Patch,
            $"/api/events/{tournament.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details("Control Cup") with { BodyMarkdown = "Before\u0001\uFFFE\uFFFF😀After" },
            ifMatch: StrongETag.Encode(tournament.Version));

        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        using var detail = await Client.GetAsync($"/api/events/{tournament.Slug}");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        var body = await detail.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("<p>Before😀After</p>", body.GetProperty("bodyHtml").GetString());
    }

    [Fact]
    public async Task Cancel_delete_restore_enforce_deadlines_admin_auth_and_idempotent_retries()
    {
        var completed = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Completed Cup");
        completed.AdvanceLifecycle(completed.StartsAtUtc);
        completed.AdvanceLifecycle(completed.EndsAtUtc);
        await using (var database = CreateContext())
        {
            database.Events.Update(completed);
            await database.SaveChangesAsync();
        }

        using var missingIdempotency = await SendJsonAsync(HttpMethod.Post, $"/api/events/{completed.Id:D}/cancel", seed.Organizer.Id, "Organizer", new { }, ifMatch: StrongETag.Encode(completed.Version));
        Assert.Equal(HttpStatusCode.BadRequest, missingIdempotency.StatusCode);
        using var cancelled = await SendJsonAsync(HttpMethod.Post, $"/api/events/{completed.Id:D}/cancel", seed.Organizer.Id, "Organizer", new { }, "cancel-completed", StrongETag.Encode(completed.Version));
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        using var cancelRetry = await SendJsonAsync(HttpMethod.Post, $"/api/events/{completed.Id:D}/cancel", seed.Organizer.Id, "Organizer", new { }, "cancel-completed", StrongETag.Encode(completed.Version));
        Assert.Equal(HttpStatusCode.OK, cancelRetry.StatusCode);
        Assert.Equal(cancelled.Headers.ETag?.Tag, cancelRetry.Headers.ETag?.Tag);

        var future = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Delete Cup");
        using var deleted = await SendJsonAsync(HttpMethod.Delete, $"/api/events/{future.Id:D}", seed.Organizer.Id, "Organizer", new { reason = "duplicate" }, "delete-future", StrongETag.Encode(future.Version));
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        using var deleteRetry = await SendJsonAsync(HttpMethod.Delete, $"/api/events/{future.Id:D}", seed.Organizer.Id, "Organizer", new { reason = "duplicate" }, "delete-future", StrongETag.Encode(future.Version));
        Assert.Equal(HttpStatusCode.OK, deleteRetry.StatusCode);

        using var organizerRestore = await SendJsonAsync(HttpMethod.Post, $"/api/admin/events/{future.Id:D}/restore", seed.Organizer.Id, "Organizer", new { }, ifMatch: deleted.Headers.ETag?.Tag);
        Assert.Equal(HttpStatusCode.Forbidden, organizerRestore.StatusCode);
        using var restored = await SendJsonAsync(HttpMethod.Post, $"/api/admin/events/{future.Id:D}/restore", seed.Admin.Id, "Admin", new { }, ifMatch: deleted.Headers.ETag?.Tag);
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);

        var restoreExpired = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Restore Expired Cup");
        using var expiredDelete = await SendJsonAsync(HttpMethod.Delete, $"/api/events/{restoreExpired.Id:D}", seed.Organizer.Id, "Organizer", new { }, "delete-restore-expired", StrongETag.Encode(restoreExpired.Version));
        Assert.Equal(HttpStatusCode.OK, expiredDelete.StatusCode);
        clock.Set(restoreExpired.StartsAtUtc);
        using var expiredRestore = await SendJsonAsync(HttpMethod.Post, $"/api/admin/events/{restoreExpired.Id:D}/restore", seed.Admin.Id, "Admin", new { }, ifMatch: expiredDelete.Headers.ETag?.Tag);
        Assert.Equal(HttpStatusCode.Conflict, expiredRestore.StatusCode);

        clock.Set(Instant.FromUtc(2030, 1, 1, 12, 0));
        var started = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Started Cup");
        clock.Set(started.StartsAtUtc);
        using var lateUpdate = await SendJsonAsync(HttpMethod.Patch, $"/api/events/{started.Id:D}/details", seed.Organizer.Id, "Organizer", Details("Too Late"), ifMatch: StrongETag.Encode(started.Version));
        Assert.Equal(HttpStatusCode.Conflict, lateUpdate.StatusCode);
        using var lateDelete = await SendJsonAsync(HttpMethod.Delete, $"/api/events/{started.Id:D}", seed.Organizer.Id, "Organizer", new { }, "delete-late", StrongETag.Encode(started.Version));
        Assert.Equal(HttpStatusCode.Conflict, lateDelete.StatusCode);
    }

    [Fact]
    public async Task Lifecycle_participant_mail_handles_zero_many_rollback_and_idempotent_dedupe()
    {
        var zero = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Zero Mail Cup");
        using var zeroUpdate = await SendJsonAsync(
            HttpMethod.Patch,
            $"/api/events/{zero.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details("Zero Mail Cup") with { StreetAddress = "99 Zero Street" },
            ifMatch: StrongETag.Encode(zero.Version));
        Assert.Equal(HttpStatusCode.OK, zeroUpdate.StatusCode);
        await using (var zeroDatabase = CreateContext())
        {
            Assert.Equal(0, await zeroDatabase.NotificationOutboxRecords.CountAsync(item => item.TournamentId == zero.Id));
        }

        var many = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Many Mail Cup");
        await using (var database = CreateContext())
        {
            database.EventRegistrationAttempts.AddRange(
                EventRegistrationAttempt.Register(many.Id, seed.Organizer.Id, seed.Organizer.Id, clock.GetCurrentInstant()),
                EventRegistrationAttempt.Register(many.Id, seed.Outsider.Id, seed.Outsider.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        using var manyUpdate = await SendJsonAsync(
            HttpMethod.Patch,
            $"/api/events/{many.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details("Many Mail Cup") with
            {
                StreetAddress = "99 Many Street",
                StartsAtLocal = "2035-03-05T10:00:00",
                EndsAtLocal = "2035-03-05T18:00:00"
            },
            ifMatch: StrongETag.Encode(many.Version));
        Assert.Equal(HttpStatusCode.OK, manyUpdate.StatusCode);
        using var cancelled = await SendJsonAsync(
            HttpMethod.Post,
            $"/api/events/{many.Id:D}/cancel",
            seed.Organizer.Id,
            "Organizer",
            new { },
            "many-cancel",
            manyUpdate.Headers.ETag?.Tag);
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        using var cancelRetry = await SendJsonAsync(
            HttpMethod.Post,
            $"/api/events/{many.Id:D}/cancel",
            seed.Organizer.Id,
            "Organizer",
            new { },
            "many-cancel",
            manyUpdate.Headers.ETag?.Tag);
        Assert.Equal(HttpStatusCode.OK, cancelRetry.StatusCode);

        await using (var database = CreateContext())
        {
            Assert.Equal(4, await database.NotificationOutboxRecords.CountAsync(item => item.TournamentId == many.Id));
            Assert.Equal(2, await database.EventRegistrationAttempts.CountAsync(item =>
                item.EventId == many.Id && item.Status == TournamentRegistrationStatus.CancelledByTournament));
        }

        var deletedTournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Delete Mail Cup");
        await using (var database = CreateContext())
        {
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(
                deletedTournament.Id,
                seed.Organizer.Id,
                seed.Organizer.Id,
                clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        using var deleted = await SendJsonAsync(
            HttpMethod.Delete,
            $"/api/events/{deletedTournament.Id:D}",
            seed.Organizer.Id,
            "Organizer",
            new { reason = "cancelled venue" },
            "participant-delete",
            StrongETag.Encode(deletedTournament.Version));
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        using var deleteRetry = await SendJsonAsync(
            HttpMethod.Delete,
            $"/api/events/{deletedTournament.Id:D}",
            seed.Organizer.Id,
            "Organizer",
            new { reason = "cancelled venue" },
            "participant-delete",
            StrongETag.Encode(deletedTournament.Version));
        Assert.Equal(HttpStatusCode.OK, deleteRetry.StatusCode);
        await using (var database = CreateContext())
        {
            Assert.Equal(1, await database.NotificationOutboxRecords.CountAsync(item => item.TournamentId == deletedTournament.Id));
            Assert.Equal(TournamentRegistrationStatus.CancelledByTournament, (await database.EventRegistrationAttempts.SingleAsync(item => item.EventId == deletedTournament.Id)).Status);
        }

        var rollback = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Rollback Mail Cup");
        var invalidRecipient = User("InvalidRecipient", GlobalRoles.User);
        invalidRecipient.Email = "not-an-email";
        invalidRecipient.NormalizedEmail = "NOT-AN-EMAIL";
        await using (var database = CreateContext())
        {
            database.Users.Add(invalidRecipient);
            database.UserProfiles.Add(Profile(invalidRecipient.Id, "InvalidRecipient"));
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(
                rollback.Id,
                invalidRecipient.Id,
                invalidRecipient.Id,
                clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        using var failedCancel = await SendJsonAsync(
            HttpMethod.Post,
            $"/api/events/{rollback.Id:D}/cancel",
            seed.Organizer.Id,
            "Organizer",
            new { },
            "rollback-cancel",
            StrongETag.Encode(rollback.Version));
        Assert.Equal(HttpStatusCode.InternalServerError, failedCancel.StatusCode);
        await using (var database = CreateContext())
        {
            Assert.Equal(ScheduledTournamentStatus.Published, (await database.Events.SingleAsync(item => item.Id == rollback.Id)).Status);
            Assert.Equal(TournamentRegistrationStatus.Confirmed, (await database.EventRegistrationAttempts.SingleAsync(item => item.EventId == rollback.Id)).Status);
            Assert.Equal(0, await database.EventLifecycleEntries.CountAsync(item => item.EventId == rollback.Id));
            Assert.Equal(0, await database.NotificationOutboxRecords.CountAsync(item => item.TournamentId == rollback.Id));
        }
    }

    [Fact]
    public async Task Concurrent_idempotent_cancel_replays_one_atomic_result()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Idempotent Race Cup");
        var etag = StrongETag.Encode(tournament.Version);
        var responses = await Task.WhenAll(
            SendJsonAsync(HttpMethod.Post, $"/api/events/{tournament.Id:D}/cancel", seed.Organizer.Id, "Organizer", new { }, "same-race-key", etag),
            SendJsonAsync(HttpMethod.Post, $"/api/events/{tournament.Id:D}/cancel", seed.Organizer.Id, "Organizer", new { }, "same-race-key", etag));
        using var first = responses[0];
        using var second = responses[1];
        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        Assert.Equal(first.Headers.ETag?.Tag, second.Headers.ETag?.Tag);

        await using var database = CreateContext();
        Assert.Equal(1, await database.EventLifecycleEntries.CountAsync(item => item.EventId == tournament.Id));
        Assert.Equal(1, await database.AuditRecords.CountAsync(item => item.EntityId == tournament.Id.ToString("D") && item.Action == "tournament.cancelled"));
    }

    [Fact]
    public async Task Concurrent_mutations_allow_one_winner_and_leave_single_atomic_event()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Race Cup");
        var etag = StrongETag.Encode(tournament.Version);
        var responses = await Task.WhenAll(
            SendJsonAsync(HttpMethod.Post, $"/api/events/{tournament.Id:D}/cancel", seed.Organizer.Id, "Organizer", new { }, "race-cancel", etag),
            SendJsonAsync(HttpMethod.Delete, $"/api/events/{tournament.Id:D}", seed.Organizer.Id, "Organizer", new { reason = "race" }, "race-delete", etag));
        using var first = responses[0];
        using var second = responses[1];
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
        // The loser has three legitimate outcomes. Both commands carry different Idempotency-Key
        // values, so they take different advisory locks and genuinely interleave: either they both
        // read the row before either committed and the version token rejects the second write
        // (PreconditionFailed), or the domain refuses the second command (Conflict), or the delete
        // committed first and the cancel then finds no active row (NotFound) -- the event really is
        // gone by then, so 404 is correct there. The list stays closed so a 500 still fails.
        Assert.Single(responses, response => response.StatusCode is HttpStatusCode.PreconditionFailed or HttpStatusCode.Conflict or HttpStatusCode.NotFound);

        await using var database = CreateContext();
        Assert.Equal(1, await database.EventLifecycleEntries.CountAsync(item => item.EventId == tournament.Id));
        Assert.Equal(1, await database.AuditRecords.CountAsync(item => item.EntityId == tournament.Id.ToString("D") && (item.Action == "tournament.cancelled" || item.Action == "tournament.deleted")));
    }

    private async Task<Event> CreateTournamentAsync(Guid organizationId, Guid creatorId, string title)
    {
        await using var database = CreateContext();
        var legacy = await database.TournamentFormats.SingleAsync(item => item.Id == seed.Legacy.Id);
        var slug = title.ToLowerInvariant().Replace(' ', '-');
        var tournament = Event.Create(organizationId, creatorId, Draft(title, slug), [legacy], clock.GetCurrentInstant());
        database.Events.Add(tournament);
        await database.SaveChangesAsync();
        return tournament;
    }

    private TournamentDetails Details(string title) => new(
        title, "Summary", "Body", "12 Rue de la Paix", "75001", "Paris", "France", "Europe/Paris",
        "2035-03-04T10:00:00", "2035-03-04T18:00:00", 64, [seed.Legacy.Id]);

    private static ScheduledTournamentDraft Draft(string title, string slug) => new(
        title, slug, "Summary", "Body", "12 Rue de la Paix", "75001", "Paris", "France", "Europe/Paris",
        new LocalDateTime(2035, 3, 4, 10, 0), new LocalDateTime(2035, 3, 4, 18, 0), 64, Region: "Île-de-France", EventType: CalendarEventType.Weekly);

    private Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid userId, string role)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add("X-Test-User", userId.ToString("D"));
        request.Headers.Add("X-Test-Roles", role);
        return Client.SendAsync(request);
    }

    private Task<HttpResponseMessage> SendJsonAsync(HttpMethod method, string url, Guid userId, string role, object body, string? idempotencyKey = null, string? ifMatch = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-Test-User", userId.ToString("D"));
        request.Headers.Add("X-Test-Roles", role);
        if (idempotencyKey is not null) request.Headers.Add("Idempotency-Key", idempotencyKey);
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return Client.SendAsync(request);
    }

    private Task<HttpResponseMessage> SendRawJsonAsync(HttpMethod method, string url, Guid userId, string role, string body, string ifMatch)
    {
        var request = new HttpRequestMessage(method, url) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Add("X-Test-User", userId.ToString("D"));
        request.Headers.Add("X-Test-Roles", role);
        request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return Client.SendAsync(request);
    }

    private static async Task<SeedRows> SeedAsync(GonesDbContext database)
    {
        var organizer = User("Organizer", GlobalRoles.Organizer);
        var outsider = User("Outsider", GlobalRoles.Organizer);
        var admin = User("Admin", GlobalRoles.Admin);
        var alpha = Organization.Create("Alpha Club", null, null, null, Now);
        var beta = Organization.Create("Beta Club", null, null, null, Now);
        var legacy = await database.TournamentFormats.SingleOrDefaultAsync(item => item.Slug == TournamentFormat.LegacySlug) ?? TournamentFormat.CreateLegacy(Now);
        var modern = TournamentFormat.Create("Modern", "modern", 10, Now);
        database.Users.AddRange(organizer, outsider, admin);
        database.UserProfiles.AddRange(
            Profile(organizer.Id, "Organizer"),
            Profile(outsider.Id, "Outsider"),
            Profile(admin.Id, "Admin"));
        database.Organizations.AddRange(alpha, beta);
        if (database.Entry(legacy).State == EntityState.Detached) database.TournamentFormats.Add(legacy);
        database.TournamentFormats.Add(modern);
        await database.SaveChangesAsync();
        database.OrganizationMembers.AddRange(
            OrganizationMember.Create(alpha.Id, organizer.Id, OrganizationRoles.Organizer, Now),
            OrganizationMember.Create(beta.Id, outsider.Id, OrganizationRoles.Organizer, Now));
        await database.SaveChangesAsync();
        return new SeedRows(alpha, beta, organizer, outsider, admin, legacy, modern);
    }

    private static ApplicationUser User(string prefix, string role)
    {
        var unique = Guid.NewGuid().ToString("N");
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(), UserName = $"{prefix}-{unique}@example.test", NormalizedUserName = $"{prefix.ToUpperInvariant()}-{unique}@EXAMPLE.TEST",
            Email = $"{prefix}-{unique}@example.test", NormalizedEmail = $"{prefix.ToUpperInvariant()}-{unique}@EXAMPLE.TEST", EmailConfirmed = true,
            SecurityStamp = Guid.NewGuid().ToString("N"), ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
        user.AssignGlobalRole(role);
        return user;
    }

    private static UserProfile Profile(Guid userId, string username) =>
        UserProfile.Create(userId, username, username, "Participant", Now);

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);
    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);

    private sealed record SeedRows(Organization Alpha, Organization Beta, ApplicationUser Organizer, ApplicationUser Outsider, ApplicationUser Admin, TournamentFormat Legacy, TournamentFormat Modern);
    private sealed record TournamentDetails(string Title, string? Summary, string? BodyMarkdown, string StreetAddress, string? PostalCode, string City, string Country, string TimeZoneId, string StartsAtLocal, string? EndsAtLocal, int? Capacity, IReadOnlyList<Guid> FormatIds, string? LiveTournamentUrl = null, string? ArchiveTournamentUrl = null, string Region = "Île-de-France", string EventType = "weekly");
    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Set(Instant value) => current = value;
    }
}
