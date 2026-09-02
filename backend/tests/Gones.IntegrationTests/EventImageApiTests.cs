using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Application.Events;
using Gones.Domain.Calendar;
using Gones.Infrastructure.EventProviders;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodaTime;
using Npgsql;

namespace Gones.IntegrationTests;

public sealed class EventImageApiTests : IAsyncLifetime
{
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);
    private readonly PostgreSqlTestContainer postgres = new();
    private readonly MutableClock clock = new(Now);
    private readonly RecordingObjectStore objects = new();
    private readonly FakeProcessor processor = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;
    private ApplicationUser owner = null!;
    private ApplicationUser other = null!;
    private ApplicationUser unverified = null!;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            owner = User(true);
            other = User(true);
            unverified = User(false);
            database.Users.AddRange(owner, other, unverified);
            await database.SaveChangesAsync();
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
    public async Task Upload_requires_verified_auth_exact_file_field_and_enforces_5_MiB()
    {
        using var anonymous = await Client.PostAsync("/api/event-images", Multipart("file", [1, 2, 3]));
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var notVerified = await UploadAsync(unverified.Id, Multipart("file", [1, 2, 3]));
        Assert.Equal(HttpStatusCode.Forbidden, notVerified.StatusCode);
        Assert.Equal("email_verification_required", await ProblemCode(notVerified));

        using var wrongField = await UploadAsync(owner.Id, Multipart("image", [1, 2, 3]));
        Assert.Equal(HttpStatusCode.BadRequest, wrongField.StatusCode);
        Assert.Equal("image_invalid", await ProblemCode(wrongField));

        using var oversized = await UploadAsync(owner.Id, Multipart("file", new byte[EventImageUploadLimits.MaximumBytes + 1]));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, oversized.StatusCode);
        Assert.Equal("image_too_large", await ProblemCode(oversized));
    }

    [Fact]
    public async Task Processor_rejections_map_to_exact_problem_codes_without_rows_or_objects()
    {
        var cases = new (Exception Failure, HttpStatusCode Status, string Code)[]
        {
            (new EventImageInvalidException(), HttpStatusCode.BadRequest, "image_invalid"),
            (new EventImageTooManyPixelsException(), HttpStatusCode.BadRequest, "image_too_many_pixels"),
            (new EventImageAnimatedException(), HttpStatusCode.BadRequest, "image_animated"),
            (new EventImageTypeUnsupportedException(), HttpStatusCode.UnsupportedMediaType, "image_type_unsupported")
        };
        foreach (var item in cases)
        {
            processor.Failure = item.Failure;
            using var response = await UploadAsync(owner.Id, Multipart("file", [1, 2, 3]));
            Assert.Equal(item.Status, response.StatusCode);
            Assert.Equal(item.Code, await ProblemCode(response));
        }
        processor.Failure = null;
        await using var database = CreateContext();
        Assert.Empty(await database.EventImages.ToListAsync());
        Assert.Empty(objects.Keys);
    }

    [Fact]
    public async Task Upload_writes_ordered_variants_before_row_and_returns_temporary_contract()
    {
        using var response = await UploadAsync(owner.Id, Multipart("file", [1, 2, 3]));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = body.GetProperty("id").GetGuid();
        Assert.Equal("Temporary", body.GetProperty("state").GetString());
        Assert.Equal(960, body.GetProperty("width").GetInt32());
        Assert.Equal(540, body.GetProperty("height").GetInt32());
        Assert.Equal(Now + Duration.FromHours(24), InstantPattern(body.GetProperty("expiresAt").GetString()!));
        Assert.Equal(new[] { 320, 960 }, body.GetProperty("variants").EnumerateArray().Select(item => item.GetProperty("width").GetInt32()));
        Assert.Equal(
            new[] { $"event-images/{id:D}/320.webp", $"event-images/{id:D}/960.webp" },
            objects.PutKeys);

        await using var database = CreateContext();
        var stored = await database.EventImages.SingleAsync();
        Assert.Equal(id, stored.Id);
        Assert.Equal(owner.Id, stored.UploadedByUserId);
        Assert.Equal(EventImageState.Temporary, stored.State);
    }

    [Fact]
    public async Task Upload_compensates_objects_when_storage_or_database_commit_fails()
    {
        objects.FailPutNumber = 2;
        using var storageFailure = await UploadAsync(owner.Id, Multipart("file", [1, 2, 3]));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, storageFailure.StatusCode);
        Assert.Empty(objects.Keys);
        Assert.Equal(objects.PutKeys, objects.DeleteKeys);
        await using (var database = CreateContext()) Assert.Empty(await database.EventImages.ToListAsync());

        objects.Reset();
        await using (var database = CreateContext())
        {
            await database.Database.ExecuteSqlRawAsync(
                "CREATE FUNCTION fail_event_image_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced event image insert failure'; END $$;");
            await database.Database.ExecuteSqlRawAsync(
                "CREATE TRIGGER fail_event_image_insert BEFORE INSERT ON event_images FOR EACH ROW EXECUTE FUNCTION fail_event_image_insert();");
        }
        using var databaseFailure = await UploadAsync(owner.Id, Multipart("file", [1, 2, 3]));
        Assert.Equal(HttpStatusCode.InternalServerError, databaseFailure.StatusCode);
        Assert.Empty(objects.Keys);
    }

    [Fact]
    public async Task Temporary_variant_is_owner_only_no_store_while_EventOwned_is_anonymous_immutable()
    {
        var temporary = EventImage.CreateTemporary(Guid.NewGuid(), owner.Id, 960, 540, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.Add(temporary);
            await database.SaveChangesAsync();
        }
        objects.Seed(EventImageObjectKeys.Variant(temporary.Id, 320), [8, 9]);

        using var anonymous = await Client.GetAsync($"/api/event-images/{temporary.Id:D}/variants/320");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var foreign = await GetAsync(other.Id, temporary.Id, 320);
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        using var ownerRead = await GetAsync(owner.Id, temporary.Id, 320);
        Assert.Equal(HttpStatusCode.OK, ownerRead.StatusCode);
        Assert.Equal("no-store", ownerRead.Headers.CacheControl?.ToString());
        Assert.Equal("image/webp", ownerRead.Content.Headers.ContentType?.MediaType);

        var eventOwnedId = Guid.NewGuid();
        await InsertOwnedStateAsync(eventOwnedId, EventImageState.EventOwned, eventId: Guid.NewGuid());
        objects.Seed(EventImageObjectKeys.Variant(eventOwnedId, 320), [4, 2]);
        using var publicRead = await Client.GetAsync($"/api/event-images/{eventOwnedId:D}/variants/320");
        Assert.Equal(HttpStatusCode.OK, publicRead.StatusCode);
        Assert.Equal("public, max-age=31536000, immutable", publicRead.Headers.CacheControl?.ToString());
        Assert.Equal(Gones.Api.Events.EventImageEndpoints.EventOwnedVariantETag(eventOwnedId, 320), publicRead.Headers.ETag?.Tag);
        using var repeatedPublicRead = await Client.GetAsync($"/api/event-images/{eventOwnedId:D}/variants/320");
        Assert.Equal(publicRead.Headers.ETag?.Tag, repeatedPublicRead.Headers.ETag?.Tag);
        Assert.Equal(await publicRead.Content.ReadAsByteArrayAsync(), await repeatedPublicRead.Content.ReadAsByteArrayAsync());

        var proposalOwnedId = Guid.NewGuid();
        await InsertOwnedStateAsync(proposalOwnedId, EventImageState.ProposalOwned, proposalId: Guid.NewGuid());
        using var proposalRead = await GetAsync(owner.Id, proposalOwnedId, 320);
        Assert.Equal(HttpStatusCode.NotFound, proposalRead.StatusCode);
    }

    [Fact]
    public async Task Variant_missing_object_is_404_while_storage_outage_is_503()
    {
        var image = EventImage.CreateTemporary(Guid.NewGuid(), owner.Id, 320, 180, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.Add(image);
            await database.SaveChangesAsync();
        }

        using var missing = await GetAsync(owner.Id, image.Id, 320);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

        objects.FailReads = true;
        using var outage = await GetAsync(owner.Id, image.Id, 320);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, outage.StatusCode);
        Assert.Equal("image_storage_unavailable", await ProblemCode(outage));
    }

    [Fact]
    public async Task Delete_conflicts_for_foreign_expired_or_owned_image_without_deleting_objects()
    {
        var foreign = EventImage.CreateTemporary(Guid.NewGuid(), other.Id, 320, 180, Now);
        var expired = EventImage.CreateTemporary(Guid.NewGuid(), owner.Id, 320, 180, Now - Duration.FromHours(24));
        await using (var database = CreateContext())
        {
            database.EventImages.AddRange(foreign, expired);
            await database.SaveChangesAsync();
        }
        objects.Seed(EventImageObjectKeys.Variant(foreign.Id, 320), [1]);
        objects.Seed(EventImageObjectKeys.Variant(expired.Id, 320), [2]);
        var attachedId = Guid.NewGuid();
        await InsertOwnedStateAsync(attachedId, EventImageState.EventOwned, eventId: Guid.NewGuid());
        objects.Seed(EventImageObjectKeys.Variant(attachedId, 320), [3]);

        using var foreignDelete = await DeleteAsync(owner.Id, foreign.Id);
        using var expiredDelete = await DeleteAsync(owner.Id, expired.Id);
        using var attachedDelete = await DeleteAsync(owner.Id, attachedId);

        Assert.All(new[] { foreignDelete, expiredDelete, attachedDelete }, response => Assert.Equal(HttpStatusCode.Conflict, response.StatusCode));
        Assert.Equal("image_state_conflict", await ProblemCode(foreignDelete));
        Assert.Equal("image_state_conflict", await ProblemCode(expiredDelete));
        Assert.Equal("image_state_conflict", await ProblemCode(attachedDelete));
        Assert.Equal(3, objects.Keys.Count);
    }

    [Fact]
    public async Task Delete_commits_row_first_and_keeps_failed_object_delete_durably_retryable()
    {
        var image = EventImage.CreateTemporary(Guid.NewGuid(), owner.Id, 960, 540, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.Add(image);
            await database.SaveChangesAsync();
        }
        objects.Seed(EventImageObjectKeys.Variant(image.Id, 320), [1]);
        objects.Seed(EventImageObjectKeys.Variant(image.Id, 960), [2]);
        objects.FailDeletes = true;

        using var response = await DeleteAsync(owner.Id, image.Id);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await using (var database = CreateContext())
        {
            Assert.False(await database.EventImages.AnyAsync(item => item.Id == image.Id));
            var retries = await database.EventImageObjectDeletions.Where(item => item.ImageId == image.Id).ToListAsync();
            Assert.Equal(2, retries.Count);
            Assert.All(retries, retry =>
            {
                Assert.Equal(1, retry.Attempts);
                Assert.Equal(nameof(EventImageStorageUnavailableException), retry.LastError);
                Assert.True(retry.NextAttemptAt > Now);
            });
        }

        objects.FailDeletes = false;
        clock.Advance(Duration.FromMinutes(15));
        await using (var scope = factory!.Services.CreateAsyncScope())
        {
            Assert.Equal(2, await scope.ServiceProvider.GetRequiredService<EventImageCleanupService>().ProcessDueObjectDeletionsAsync(CancellationToken.None));
        }
        await using (var database = CreateContext()) Assert.Empty(await database.EventImageObjectDeletions.ToListAsync());
        Assert.Empty(objects.Keys);
    }

    [Fact]
    public async Task Delete_returns_204_when_post_commit_cleanup_claim_fails()
    {
        var image = EventImage.CreateTemporary(Guid.NewGuid(), owner.Id, 960, 540, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.Add(image);
            await database.SaveChangesAsync();
            await database.Database.ExecuteSqlRawAsync(
                "CREATE FUNCTION fail_event_image_deletion_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced deletion retry update failure'; END $$;");
            await database.Database.ExecuteSqlRawAsync(
                "CREATE TRIGGER fail_event_image_deletion_update BEFORE UPDATE ON event_image_object_deletions FOR EACH ROW EXECUTE FUNCTION fail_event_image_deletion_update();");
        }

        using var response = await DeleteAsync(owner.Id, image.Id);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await using var verify = CreateContext();
        Assert.False(await verify.EventImages.AnyAsync(item => item.Id == image.Id));
        Assert.Equal(2, await verify.EventImageObjectDeletions.CountAsync(item => item.ImageId == image.Id));
    }

    [Fact]
    public async Task Sweep_removes_only_expired_temporary_rows_and_objects()
    {
        var expired = EventImage.CreateTemporary(Guid.NewGuid(), owner.Id, 320, 180, Now - Duration.FromHours(24));
        var live = EventImage.CreateTemporary(Guid.NewGuid(), owner.Id, 320, 180, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.AddRange(expired, live);
            await database.SaveChangesAsync();
        }
        objects.Seed(EventImageObjectKeys.Variant(expired.Id, 320), [1]);
        objects.Seed(EventImageObjectKeys.Variant(live.Id, 320), [2]);

        await using (var scope = factory!.Services.CreateAsyncScope())
        {
            var result = await scope.ServiceProvider.GetRequiredService<EventImageCleanupService>().SweepExpiredAsync(CancellationToken.None);
            Assert.Equal(1, result);
        }

        await using var verify = CreateContext();
        Assert.False(await verify.EventImages.AnyAsync(item => item.Id == expired.Id));
        Assert.True(await verify.EventImages.AnyAsync(item => item.Id == live.Id));
        Assert.DoesNotContain(EventImageObjectKeys.Variant(expired.Id, 320), objects.Keys);
        Assert.Contains(EventImageObjectKeys.Variant(live.Id, 320), objects.Keys);
    }

    [Fact]
    public async Task Migration_enforces_state_shape_and_alt_text_length()
    {
        await using var database = CreateContext();
        var invalidState = await Assert.ThrowsAsync<PostgresException>(() => database.Database.ExecuteSqlInterpolatedAsync($$"""
            INSERT INTO event_images (id, uploaded_by_user_id, state, event_id, proposal_id, sort_order, alt_text, width, height, created_at, expires_at)
            VALUES ({{Guid.NewGuid()}}, {{owner.Id}}, 'Temporary', {{Guid.NewGuid()}}, NULL, NULL, NULL, 320, 180, {{Now}}, {{Now + Duration.FromHours(24)}})
            """));
        Assert.Equal(PostgresErrorCodes.CheckViolation, invalidState.SqlState);

        var longAltText = await Assert.ThrowsAsync<PostgresException>(() => database.Database.ExecuteSqlInterpolatedAsync($$"""
            INSERT INTO event_images (id, uploaded_by_user_id, state, event_id, proposal_id, sort_order, alt_text, width, height, created_at, expires_at)
            VALUES ({{Guid.NewGuid()}}, {{owner.Id}}, 'Temporary', NULL, NULL, NULL, {{new string('x', 301)}}, 320, 180, {{Now}}, {{Now + Duration.FromHours(24)}})
            """));
        Assert.Equal(PostgresErrorCodes.StringDataRightTruncation, longAltText.SqlState);
    }

    private Task<HttpResponseMessage> UploadAsync(Guid userId, HttpContent content) => SendAsync(HttpMethod.Post, "/api/event-images", userId, content);
    private Task<HttpResponseMessage> GetAsync(Guid userId, Guid imageId, int width) => SendAsync(HttpMethod.Get, $"/api/event-images/{imageId:D}/variants/{width}", userId);
    private Task<HttpResponseMessage> DeleteAsync(Guid userId, Guid imageId) => SendAsync(HttpMethod.Delete, $"/api/event-images/{imageId:D}", userId);

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid userId, HttpContent? content = null)
    {
        using var request = new HttpRequestMessage(method, url) { Content = content };
        request.Headers.Add("X-Test-User", userId.ToString("D"));
        request.Headers.Add("X-Test-Roles", "User");
        return await Client.SendAsync(request);
    }

    private static MultipartFormDataContent Multipart(string field, byte[] bytes)
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        content.Add(file, field, "image.png");
        return content;
    }

    private async Task InsertOwnedStateAsync(Guid id, EventImageState state, Guid? eventId = null, Guid? proposalId = null)
    {
        await using var database = CreateContext();
        await database.Database.ExecuteSqlRawAsync("ALTER TABLE event_images DISABLE TRIGGER ALL");
        try
        {
            await database.Database.ExecuteSqlInterpolatedAsync($$"""
                INSERT INTO event_images (id, uploaded_by_user_id, state, event_id, proposal_id, sort_order, alt_text, width, height, created_at, expires_at)
                VALUES ({{id}}, {{owner.Id}}, {{state.ToString()}}, {{eventId}}, {{proposalId}}, 0, NULL, 320, 180, {{Now}}, {{(state == EventImageState.EventOwned ? null : Now + Duration.FromHours(24))}})
                """);
        }
        finally
        {
            await database.Database.ExecuteSqlRawAsync("ALTER TABLE event_images ENABLE TRIGGER ALL");
        }
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "event-image-test-signing-key-with-more-than-32-characters");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.RemoveAll<IEventImageObjectStore>();
                services.RemoveAll<IEventImageProcessor>();
                services.AddSingleton<IClock>(clock);
                services.AddSingleton<IEventImageObjectStore>(objects);
                services.AddSingleton<IEventImageProcessor>(processor);
            });
        });

    private static ApplicationUser User(bool verified) => new()
    {
        Id = Guid.NewGuid(),
        UserName = $"image-{Guid.NewGuid():N}@example.test",
        NormalizedUserName = $"IMAGE-{Guid.NewGuid():N}@EXAMPLE.TEST",
        Email = $"image-{Guid.NewGuid():N}@example.test",
        NormalizedEmail = $"IMAGE-{Guid.NewGuid():N}@EXAMPLE.TEST",
        EmailConfirmed = verified,
        SecurityStamp = Guid.NewGuid().ToString("N"),
        ConcurrencyStamp = Guid.NewGuid().ToString("N")
    };

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options;
        return new GonesDbContext(options);
    }

    private static async Task<string?> ProblemCode(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString();

    private static Instant InstantPattern(string value) => NodaTime.Text.InstantPattern.ExtendedIso.Parse(value).Value;
    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Advance(Duration duration) => current += duration;
    }

    private sealed class FakeProcessor : IEventImageProcessor
    {
        public Exception? Failure { get; set; }

        public Task<ProcessedEventImage> ProcessAsync(Stream source, string contentType, CancellationToken cancellationToken) =>
            Failure is not null
                ? Task.FromException<ProcessedEventImage>(Failure)
                : Task.FromResult(new ProcessedEventImage(960, 540,
                [
                    new ProcessedEventImageVariant(320, 180, new byte[] { 3, 2, 0 }),
                    new ProcessedEventImageVariant(960, 540, new byte[] { 9, 6, 0 })
                ]));
    }

    private sealed class RecordingObjectStore : IEventImageObjectStore
    {
        private readonly ConcurrentDictionary<string, byte[]> objects = new(StringComparer.Ordinal);
        private int puts;
        public int? FailPutNumber { get; set; }
        public bool FailDeletes { get; set; }
        public bool FailReads { get; set; }
        public IReadOnlyList<string> PutKeys { get; private set; } = [];
        public IReadOnlyList<string> DeleteKeys { get; private set; } = [];
        public IReadOnlyCollection<string> Keys => objects.Keys.ToArray();

        public async Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken)
        {
            puts++;
            PutKeys = [.. PutKeys, key];
            using var buffer = new MemoryStream();
            await content.CopyToAsync(buffer, cancellationToken);
            objects[key] = buffer.ToArray();
            if (puts == FailPutNumber) throw new EventImageStorageUnavailableException();
        }

        public Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken) =>
            FailReads
                ? Task.FromException<Stream>(new EventImageStorageUnavailableException())
                : objects.TryGetValue(key, out var value)
                    ? Task.FromResult<Stream>(new MemoryStream(value, writable: false))
                    : Task.FromException<Stream>(new KeyNotFoundException());

        public Task DeleteAsync(string key, CancellationToken cancellationToken)
        {
            DeleteKeys = [.. DeleteKeys, key];
            if (FailDeletes) throw new EventImageStorageUnavailableException();
            objects.TryRemove(key, out _);
            return Task.CompletedTask;
        }

        public void Seed(string key, byte[] value) => objects[key] = value;

        public void Reset()
        {
            objects.Clear();
            PutKeys = [];
            DeleteKeys = [];
            puts = 0;
            FailPutNumber = null;
            FailDeletes = false;
            FailReads = false;
        }
    }
}
