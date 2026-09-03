using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Gones.Application.Concurrency;
using Gones.Application.Events;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Infrastructure.EventProviders;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodaTime;
using NodaTime.Text;

namespace Gones.IntegrationTests;

public sealed class EventLifecycleApiTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();
    private readonly MutableClock clock = new(Instant.FromUtc(2030, 1, 1, 12, 0));
    private readonly RecordingObjectStore objects = new();
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
                services.RemoveAll<IEventImageObjectStore>();
                services.AddSingleton<IClock>(clock);
                services.AddSingleton<IEventImageObjectStore>(objects);
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
    public async Task Update_requires_fresh_if_match_preserves_hidden_urls_and_records_major_marker_atomically()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Edit Cup");
        const string hiddenLiveUrl = "  /live/%2fKeep?x=%20  ";
        const string hiddenArchiveUrl = " HTTPS://Example.TEST/%2fPath?x=%20 ";
        await using (var database = CreateContext())
        {
            await database.Database.ExecuteSqlInterpolatedAsync($$"""
                UPDATE events SET live_tournament_url = {{hiddenLiveUrl}}, archive_tournament_url = {{hiddenArchiveUrl}}
                WHERE id = {{tournament.Id}}
                """);
        }
        var details = Details(tournament, "Renamed Cup");
        Assert.DoesNotContain("liveTournamentUrl", JsonSerializer.Serialize(details), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("archiveTournamentUrl", JsonSerializer.Serialize(details), StringComparison.OrdinalIgnoreCase);

        using var zeroFormats = await SendJsonAsync(HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", details with { FormatIds = [] }, ifMatch: StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.BadRequest, zeroFormats.StatusCode);
        using var twoFormats = await SendJsonAsync(HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", details with { FormatIds = [seed.Legacy.Id, seed.Modern.Id] }, ifMatch: StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.BadRequest, twoFormats.StatusCode);

        using var missing = await SendJsonAsync(HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", details);
        Assert.Equal(HttpStatusCode.PreconditionFailed, missing.StatusCode);
        using var stale = await SendJsonAsync(HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", details, ifMatch: StrongETag.Encode(99));
        Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
        using var outsider = await SendJsonAsync(HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Outsider.Id, "Organizer", details, ifMatch: StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.NotFound, outsider.StatusCode);

        var massAssignment = JsonSerializer.Serialize(details).TrimEnd('}') + $",\"organizationId\":\"{seed.Beta.Id:D}\",\"liveTournamentUrl\":\"/hijack\",\"slug\":\"hijack\",\"status\":\"Cancelled\"}}";
        using var rejected = await SendRawJsonAsync(HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", massAssignment, StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);

        using var minor = await SendJsonAsync(HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", details, ifMatch: StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.OK, minor.StatusCode);
        Assert.Equal(StrongETag.Encode(tournament.Version + 1), minor.Headers.ETag?.Tag);
        var minorBody = await minor.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Legacy — Renamed Cup", minorBody.GetProperty("displayTitle").GetString());
        Assert.Equal("Renamed Cup", minorBody.GetProperty("title").GetString());
        Assert.Equal("12 Rue de la Paix", minorBody.GetProperty("location").GetProperty("streetAddress").GetString());
        Assert.Equal("Europe/Paris", minorBody.GetProperty("location").GetProperty("timeZoneId").GetString());

        var majorDetails = Details(
            tournament,
            "Renamed Cup",
            streetAddress: "99 Major Street",
            region: "Auvergne-Rhône-Alpes",
            startsAtLocal: "2035-03-05T10:00",
            eventType: "major",
            bodyMarkdown: "Secret changed body");
        using var major = await SendJsonAsync(HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer", majorDetails, ifMatch: minor.Headers.ETag?.Tag);
        Assert.Equal(HttpStatusCode.OK, major.StatusCode);
        var majorBody = await major.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Auvergne-Rhône-Alpes", majorBody.GetProperty("location").GetProperty("region").GetString());
        Assert.Equal("major", majorBody.GetProperty("eventType").GetString());
        using var publicDetail = await Client.GetAsync($"/api/events/{tournament.Slug}");
        Assert.Equal(HttpStatusCode.OK, publicDetail.StatusCode);
        var publicBody = await publicDetail.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(hiddenLiveUrl, publicBody.GetProperty("liveTournamentUrl").GetString());
        Assert.Equal(hiddenArchiveUrl, publicBody.GetProperty("archiveTournamentUrl").GetString());

        await using var verify = CreateContext();
        var markers = await verify.EventLifecycleEntries.Where(item => item.EventId == tournament.Id).ToListAsync();
        var marker = Assert.Single(markers);
        Assert.Equal(TournamentLifecycleEventType.MajorDetailsUpdated, marker.EventType);
        var changed = await verify.Events.SingleAsync(item => item.Id == tournament.Id);
        Assert.Equal("Auvergne-Rhône-Alpes", changed.Region);
        Assert.Equal(CalendarEventType.Major, changed.EventType);
        Assert.Equal(hiddenLiveUrl, changed.LiveTournamentUrl);
        Assert.Equal(hiddenArchiveUrl, changed.ArchiveTournamentUrl);
        Assert.Equal(new LocalDate(2035, 3, 5), changed.VenueEndDate);
        Assert.Equal(new LocalTime(23, 59, 59), changed.VenueEndTime);
        Assert.Equal(TournamentReminderPlanAction.RecalculateFuture, marker.ReminderPlanAction);
        var audits = await verify.AuditRecords.Where(item => item.EntityId == tournament.Id.ToString("D") && item.Action == "tournament.details.updated").OrderBy(item => item.OccurredAt).ToListAsync();
        Assert.Equal(2, audits.Count);
        Assert.Contains("bodyChanged", audits[1].RedactedDiff, StringComparison.Ordinal);
        Assert.DoesNotContain("Secret changed body", audits[1].RedactedDiff, StringComparison.Ordinal);
        Assert.Equal(seed.Alpha.Id, changed.OrganizationId);
    }

    [Fact]
    public async Task Update_then_public_detail_remove_XML_invalid_scalars_without_losing_valid_supplementary_text()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Control Cup");
        using var update = await SendJsonAsync(
            HttpMethod.Patch,
            $"/api/organizer/events/{tournament.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details(tournament, "Control Cup") with { BodyMarkdown = "Before\u0001\uFFFE\uFFFF😀After" },
            ifMatch: StrongETag.Encode(tournament.Version));

        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        using var detail = await Client.GetAsync($"/api/events/{tournament.Slug}");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        var body = await detail.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("<p>Before😀After</p>", body.GetProperty("bodyHtml").GetString());
    }

    [Fact]
    public async Task Manual_location_edit_trims_values_and_accepts_valid_IANA_timezone()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Manual Edit Cup");
        var json = JsonNode.Parse(JsonSerializer.Serialize(Details(tournament, "Manual Edit Cup")))!.AsObject();
        var location = json["Location"]!.AsObject();
        location["StreetAddress"] = "  99 Manual Street  ";
        location["Region"] = "  Île-de-France  ";
        location["TimeZoneId"] = "  Europe/Paris  ";

        using var response = await SendRawJsonAsync(
            HttpMethod.Patch,
            $"/api/organizer/events/{tournament.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            json.ToJsonString(),
            StrongETag.Encode(tournament.Version));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var database = CreateContext();
        var stored = await database.Events.AsNoTracking().SingleAsync(item => item.Id == tournament.Id);
        Assert.Equal("99 Manual Street", stored.StreetAddress);
        Assert.Equal("Île-de-France", stored.Region);
        Assert.Equal("Europe/Paris", stored.TimeZoneId);
    }

    [Fact]
    public async Task Management_load_returns_manual_location_and_singular_image()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Load Cup");
        var image = await CreateOwnedImageAsync(tournament.Id, seed.Organizer.Id);

        using var response = await SendAsync(HttpMethod.Get, "/api/organizer/events?pageSize=100", seed.Organizer.Id, "Organizer");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var item = body.GetProperty("items").EnumerateArray().Single(value => value.GetProperty("id").GetGuid() == tournament.Id);
        var location = item.GetProperty("location");
        Assert.Equal("12 Rue de la Paix", location.GetProperty("streetAddress").GetString());
        Assert.Equal("Europe/Paris", location.GetProperty("timeZoneId").GetString());
        Assert.Equal(image.Id, item.GetProperty("image").GetProperty("id").GetGuid());
        Assert.False(item.GetProperty("image").TryGetProperty("altText", out _));
        Assert.Equal(new[] { 320 }, item.GetProperty("image").GetProperty("variants").EnumerateArray().Select(variant => variant.GetProperty("width").GetInt32()));

        using var edit = await SendJsonAsync(
            HttpMethod.Patch,
            $"/api/organizer/events/{tournament.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details(tournament, "Loaded Edit", images: [new(image.Id)]),
            ifMatch: item.GetProperty("eTag").GetString());
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
    }

    [Fact]
    public async Task Management_list_reads_Event_fields_images_and_ETag_from_one_snapshot()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Snapshot List Cup");
        var image = await CreateOwnedImageAsync(tournament.Id, seed.Organizer.Id);

        await using var writer = CreateContext();
        await using var transaction = await writer.Database.BeginTransactionAsync();
        await writer.Database.ExecuteSqlRawAsync("LOCK TABLE event_images IN ACCESS EXCLUSIVE MODE");
        await writer.Database.ExecuteSqlInterpolatedAsync($$"""
            UPDATE events SET title = {{"New Event"}}, version = version + 1 WHERE id = {{tournament.Id}};
            UPDATE event_images SET width = 960 WHERE id = {{image.Id}};
            """);

        var listing = SendAsync(HttpMethod.Get, "/api/organizer/events?pageSize=100", seed.Organizer.Id, "Organizer");
        await WaitUntilBlockedOnEventImagesAsync();
        await transaction.CommitAsync();

        using var response = await listing;
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var item = body.GetProperty("items").EnumerateArray().Single(value => value.GetProperty("id").GetGuid() == tournament.Id);
        Assert.Equal("Snapshot List Cup", item.GetProperty("title").GetString());
        Assert.Equal(tournament.Version, item.GetProperty("version").GetInt64());
        Assert.Equal(StrongETag.Encode(tournament.Version), item.GetProperty("eTag").GetString());
        Assert.Equal(320, item.GetProperty("image").GetProperty("variants")[0].GetProperty("width").GetInt32());
    }

    [Fact]
    public async Task Fresh_media_edit_replaces_owned_image_and_deletes_objects_post_commit()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Media Cup");
        var removed = await CreateOwnedImageAsync(tournament.Id, seed.Organizer.Id);
        var temporary = await CreateTemporaryImageAsync(seed.Organizer.Id);

        using var response = await SendJsonAsync(
            HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details",
            seed.Organizer.Id, "Organizer",
            Details(tournament, tournament.Title, images: [new(temporary.Id)]),
            ifMatch: StrongETag.Encode(tournament.Version));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(temporary.Id, body.GetProperty("image").GetProperty("id").GetGuid());
        await using var database = CreateContext();
        Assert.False(await database.EventImages.AnyAsync(item => item.Id == removed.Id));
        var image = await database.EventImages.SingleAsync(item => item.EventId == tournament.Id);
        Assert.Equal(temporary.Id, image.Id);
        Assert.Equal(EventImageState.EventOwned, image.State);
        Assert.Contains(EventImageObjectKeys.Variant(removed.Id, 320), objects.DeleteKeys);
        Assert.Equal(0, await database.EventLifecycleEntries.CountAsync(item => item.EventId == tournament.Id));
    }

    [Fact]
    public async Task Stale_media_removal_is_no_op_across_rows_and_objects()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Stale Media Cup");
        var image = await CreateOwnedImageAsync(tournament.Id, seed.Organizer.Id);
        var temporary = await CreateTemporaryImageAsync(seed.Organizer.Id);
        var staleTag = StrongETag.Encode(tournament.Version);
        using var winner = await SendJsonAsync(
            HttpMethod.Patch,
            $"/api/organizer/events/{tournament.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details(tournament, "Winner", images: [new(image.Id)]),
            ifMatch: staleTag);
        Assert.Equal(HttpStatusCode.OK, winner.StatusCode);
        objects.Reset();

        using var stale = await SendJsonAsync(
            HttpMethod.Patch,
            $"/api/organizer/events/{tournament.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details(tournament, "Stale loser", images: [new(temporary.Id)]),
            ifMatch: staleTag);

        Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
        await using var database = CreateContext();
        var stored = await database.EventImages.SingleAsync(item => item.Id == image.Id);
        var storedTemporary = await database.EventImages.SingleAsync(item => item.Id == temporary.Id);
        Assert.Equal(tournament.Id, stored.EventId);
        Assert.Equal(EventImageState.Temporary, storedTemporary.State);
        Assert.Null(storedTemporary.EventId);
        Assert.Empty(await database.EventImageObjectDeletions.Where(item => item.ImageId == image.Id).ToListAsync());
        Assert.Empty(objects.DeleteKeys);
    }

    [Fact]
    public async Task Concurrent_media_edits_allow_one_ETag_winner_and_one_no_op_loser()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Concurrent Media Cup");
        var current = await CreateOwnedImageAsync(tournament.Id, seed.Organizer.Id);
        var first = await CreateTemporaryImageAsync(seed.Organizer.Id);
        var second = await CreateTemporaryImageAsync(seed.Organizer.Id);
        var etag = StrongETag.Encode(tournament.Version);

        var responses = await Task.WhenAll(
            SendJsonAsync(HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer",
                Details(tournament, tournament.Title, images: [new(first.Id)]), ifMatch: etag),
            SendJsonAsync(HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer",
                Details(tournament, tournament.Title, images: [new(second.Id)]), ifMatch: etag));
        foreach (var response in responses) response.Dispose();

        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.PreconditionFailed);
        await using var database = CreateContext();
        Assert.False(await database.EventImages.AnyAsync(item => item.Id == current.Id));
        Assert.Single(await database.EventImages.Where(item => item.EventId == tournament.Id).ToListAsync());
    }

    [Fact]
    public async Task PATCH_response_keeps_its_Event_version_and_media_snapshot_while_next_PATCH_commits()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Snapshot PATCH Cup");
        var retained = await CreateOwnedImageAsync(tournament.Id, seed.Organizer.Id);
        var added = await CreateTemporaryImageAsync(seed.Organizer.Id);

        using var first = await SendJsonAsync(
            HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer",
            Details(tournament, "First snapshot", images: [new(retained.Id)]),
            ifMatch: StrongETag.Encode(tournament.Version));
        using var second = await SendJsonAsync(
            HttpMethod.Patch, $"/api/organizer/events/{tournament.Id:D}/details", seed.Organizer.Id, "Organizer",
            Details(tournament, "Second snapshot", images: [new(added.Id)]),
            ifMatch: StrongETag.Encode(tournament.Version + 1));

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("First snapshot", firstBody.GetProperty("title").GetString());
        Assert.Equal(retained.Id, firstBody.GetProperty("image").GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Media_edit_rejects_missing_and_foreign_attached_images_without_mutation()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Conflict Media Cup");
        var own = await CreateOwnedImageAsync(tournament.Id, seed.Organizer.Id);
        var foreignTournament = await CreateTournamentAsync(seed.Beta.Id, seed.Outsider.Id, "Foreign Media Cup");
        var foreign = await CreateOwnedImageAsync(foreignTournament.Id, seed.Outsider.Id);

        using var missing = await SendJsonAsync(
            HttpMethod.Patch,
            $"/api/organizer/events/{tournament.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details(tournament, tournament.Title, images: [new(Guid.NewGuid())]),
            ifMatch: StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal("image_not_found", (await missing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        using var conflict = await SendJsonAsync(
            HttpMethod.Patch,
            $"/api/organizer/events/{tournament.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details(tournament, tournament.Title, images: [new(foreign.Id)]),
            ifMatch: StrongETag.Encode(tournament.Version));
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Equal("image_state_conflict", (await conflict.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        await using var database = CreateContext();
        var ownStored = await database.EventImages.SingleAsync(item => item.Id == own.Id);
        Assert.Equal(tournament.Id, ownStored.EventId);
        Assert.Equal(tournament.Title, (await database.Events.SingleAsync(item => item.Id == tournament.Id)).Title);
    }

    [Fact]
    public async Task Media_removal_returns_success_when_object_delete_fails_and_leaves_durable_retry_state()
    {
        var tournament = await CreateTournamentAsync(seed.Alpha.Id, seed.Organizer.Id, "Retry Media Cup");
        var image = await CreateOwnedImageAsync(tournament.Id, seed.Organizer.Id);
        objects.FailDeletes = true;

        using var response = await SendJsonAsync(
            HttpMethod.Patch,
            $"/api/organizer/events/{tournament.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details(tournament, tournament.Title, images: []),
            ifMatch: StrongETag.Encode(tournament.Version));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var database = CreateContext();
        Assert.False(await database.EventImages.AnyAsync(item => item.Id == image.Id));
        var retry = Assert.Single(await database.EventImageObjectDeletions.Where(item => item.ImageId == image.Id).ToListAsync());
        Assert.Equal(1, retry.Attempts);
        Assert.Equal(nameof(EventImageStorageUnavailableException), retry.LastError);
        Assert.True(retry.NextAttemptAt > clock.GetCurrentInstant());
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
        using var lateUpdate = await SendJsonAsync(HttpMethod.Patch, $"/api/organizer/events/{started.Id:D}/details", seed.Organizer.Id, "Organizer", Details(started, "Too Late"), ifMatch: StrongETag.Encode(started.Version));
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
            $"/api/organizer/events/{zero.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details(zero, "Zero Mail Cup", streetAddress: "99 Zero Street"),
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
            $"/api/organizer/events/{many.Id:D}/details",
            seed.Organizer.Id,
            "Organizer",
            Details(many, "Many Mail Cup", streetAddress: "99 Many Street", startsAtLocal: "2035-03-05T10:00"),
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

    private async Task WaitUntilBlockedOnEventImagesAsync()
    {
        await using var poll = CreateContext();
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
        while (DateTime.UtcNow < deadline)
        {
            var waiting = await poll.Database
                .SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%event_images%'")
                .SingleAsync();
            if (waiting > 0) return;
            await Task.Delay(TimeSpan.FromMilliseconds(50));
        }
        Assert.Fail("No management list query blocked on event_images within 15s.");
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

    private TournamentDetails Details(
        Event tournament,
        string title,
        string? streetAddress = null,
        string? region = null,
        string? startsAtLocal = null,
        string eventType = "weekly",
        string? bodyMarkdown = "Body",
        IReadOnlyList<TournamentImage>? images = null)
    {
        return new TournamentDetails(
            title,
            "Summary",
            bodyMarkdown,
            new TournamentLocation(
                streetAddress ?? tournament.StreetAddress,
                tournament.PostalCode,
                tournament.City,
                tournament.Country,
                region ?? tournament.Region,
                tournament.TimeZoneId),
            eventType,
            startsAtLocal ?? $"{LocalDatePattern.Iso.Format(tournament.VenueStartDate)}T{LocalTimePattern.CreateWithInvariantCulture("HH:mm").Format(tournament.VenueStartTime)}",
            tournament.Capacity,
            [seed.Legacy.Id],
            images?.FirstOrDefault()?.ImageId);
    }

    private async Task<EventImage> CreateOwnedImageAsync(Guid eventId, Guid userId)
    {
        var image = EventImage.CreateTemporary(Guid.NewGuid(), userId, 320, 180, clock.GetCurrentInstant());
        image.AttachToEvent(eventId, userId, clock.GetCurrentInstant());
        await using var database = CreateContext();
        database.EventImages.Add(image);
        await database.SaveChangesAsync();
        return image;
    }

    private async Task<EventImage> CreateTemporaryImageAsync(Guid userId)
    {
        var image = EventImage.CreateTemporary(Guid.NewGuid(), userId, 320, 180, clock.GetCurrentInstant());
        await using var database = CreateContext();
        database.EventImages.Add(image);
        await database.SaveChangesAsync();
        return image;
    }

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
    private sealed record TournamentDetails(
        string Title,
        string? Summary,
        string? BodyMarkdown,
        TournamentLocation Location,
        string EventType,
        string StartsAtLocal,
        int Capacity,
        IReadOnlyList<Guid> FormatIds,
        Guid? ImageId);
    private sealed record TournamentLocation(string StreetAddress, string PostalCode, string City, string Country, string Region, string TimeZoneId);
    private sealed record TournamentImage(Guid ImageId);

    private sealed class RecordingObjectStore : IEventImageObjectStore
    {
        private TaskCompletionSource? deleteBlocked;
        private TaskCompletionSource? releaseDeletes;
        public bool FailDeletes { get; set; }
        public IReadOnlyList<string> DeleteKeys { get; private set; } = [];

        public Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken) =>
            Task.FromException<Stream>(new KeyNotFoundException());

        public async Task DeleteAsync(string key, CancellationToken cancellationToken)
        {
            DeleteKeys = [.. DeleteKeys, key];
            if (deleteBlocked is not null && releaseDeletes is not null)
            {
                deleteBlocked.TrySetResult();
                await releaseDeletes.Task.WaitAsync(cancellationToken);
            }
            if (FailDeletes) throw new EventImageStorageUnavailableException();
        }

        public void BlockDeletes()
        {
            deleteBlocked = new(TaskCreationOptions.RunContinuationsAsynchronously);
            releaseDeletes = new(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        public async Task WaitUntilDeleteBlockedAsync()
        {
            if (deleteBlocked is null) throw new InvalidOperationException("Delete blocking was not configured.");
            await deleteBlocked.Task.WaitAsync(TimeSpan.FromSeconds(15));
        }

        public void ReleaseDeletes() => releaseDeletes?.TrySetResult();

        public void Reset()
        {
            ReleaseDeletes();
            deleteBlocked = null;
            releaseDeletes = null;
            DeleteKeys = [];
            FailDeletes = false;
        }
    }

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Set(Instant value) => current = value;
    }
}
