using System.Text.Json;
using Gones.Api.Events;
using Gones.Domain.Calendar;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Npgsql;

namespace Gones.IntegrationTests;

public sealed class EventImageMigrationTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);

    public Task InitializeAsync() => postgres.StartAsync();
    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Previous_schema_duplicates_and_v2_envelope_migrate_to_singular_v3_with_cleanup()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync("20260902070415_DirectEventPublication");
        var user = User();
        var organization = Organization.Create("Migration Club", null, null, null, Now);
        database.Users.Add(user);
        database.Organizations.Add(organization);
        await database.SaveChangesAsync();

        var eventId = Guid.Parse("10000000-0000-0000-0000-000000000001");
        var proposalId = Guid.Parse("20000000-0000-0000-0000-000000000001");
        var formatId = Guid.Parse("30000000-0000-0000-0000-000000000001");
        var eventFirst = Guid.Parse("40000000-0000-0000-0000-000000000001");
        var eventExtra = Guid.Parse("40000000-0000-0000-0000-000000000002");
        var proposalFirst = Guid.Parse("50000000-0000-0000-0000-000000000001");
        var proposalExtra = Guid.Parse("50000000-0000-0000-0000-000000000002");
        var payload = JsonSerializer.Serialize(new
        {
            version = 2,
            payloadHash = "old",
            envelopeHash = "old",
            @event = new
            {
                organizationId = organization.Id,
                title = "Migration Cup",
                summary = "Summary",
                bodyMarkdown = "Body",
                location = new { streetAddress = "1 Street", postalCode = "69001", city = "Lyon", country = "France", region = "Rhône", timeZoneId = "Europe/Paris" },
                eventType = "weekly",
                startsAtLocal = "2035-03-04T10:00",
                capacity = 32,
                formatIds = new[] { formatId },
                images = new[] { new { imageId = proposalFirst, altText = "First" }, new { imageId = proposalExtra, altText = "Extra" } }
            },
            location = new { streetAddress = "1 Street", postalCode = "69001", city = "Lyon", country = "France", region = "Rhône", timeZoneId = "Europe/Paris" }
        });

        await database.Database.ExecuteSqlInterpolatedAsync($$"""
            INSERT INTO tournament_formats (id, name, slug, sort_order, created_at, updated_at, deleted_at, version)
            VALUES ({{formatId}}, 'Migration', 'migration', 1, {{Now}}, {{Now}}, NULL, 1);
            INSERT INTO events
                (id, organization_id, title, slug, summary, body_markdown, live_tournament_url, archive_tournament_url,
                 street_address, postal_code, city, country, region, event_type, time_zone_id,
                 venue_start_date, venue_start_time, venue_end_date, venue_end_time, starts_at_utc, ends_at_utc,
                 capacity, status, created_by_user_id, created_at, updated_at, deleted_at, deleted_by_user_id,
                 deleted_reason, normalized_search_text, provider_place_id, latitude, longitude, version)
            VALUES
                ({{eventId}}, {{organization.Id}}, 'Migration Cup', 'migration-cup', 'Summary', 'Body', NULL, NULL,
                 '1 Street', '69001', 'Lyon', 'France', 'Rhône', 'Weekly', 'Europe/Paris',
                 DATE '2035-03-04', TIME '10:00', DATE '2035-03-04', TIME '23:59:59',
                 TIMESTAMPTZ '2035-03-04 09:00:00Z', TIMESTAMPTZ '2035-03-04 22:59:59Z',
                 32, 'Published', {{user.Id}}, {{Now}}, {{Now}}, NULL, NULL, NULL,
                 'migration cup', 'migration-place', 0, 0, 1);
            INSERT INTO event_proposals
                (id, submitted_by_user_id, payload_json, status, created_at, expires_at, decided_at, decided_by_user_id, rejection_reason, version)
            VALUES ({{proposalId}}, {{user.Id}}, {{payload}}::jsonb, 'Pending', {{Now}}, {{Now + Duration.FromDays(7)}}, NULL, NULL, NULL, 1);
            INSERT INTO event_images
                (id, uploaded_by_user_id, state, event_id, proposal_id, sort_order, alt_text, width, height, created_at, expires_at)
            VALUES
                ({{eventExtra}}, {{user.Id}}, 'EventOwned', {{eventId}}, NULL, 1, 'Extra', 960, 540, {{Now}}, NULL),
                ({{eventFirst}}, {{user.Id}}, 'EventOwned', {{eventId}}, NULL, 0, 'First', 960, 540, {{Now}}, NULL),
                ({{proposalExtra}}, {{user.Id}}, 'ProposalOwned', NULL, {{proposalId}}, 1, 'Extra', 960, 540, {{Now}}, {{Now + Duration.FromDays(7)}}),
                ({{proposalFirst}}, {{user.Id}}, 'ProposalOwned', NULL, {{proposalId}}, 0, 'First', 960, 540, {{Now}}, {{Now + Duration.FromDays(7)}});
            """);

        database.ChangeTracker.Clear();
        await database.Database.MigrateAsync();

        var retained = await database.EventImages.AsNoTracking().OrderBy(image => image.Id).Select(image => image.Id).ToListAsync();
        Assert.Equal(new[] { eventFirst, proposalFirst }, retained);
        var deletedKeys = await database.EventImageObjectDeletions.AsNoTracking().Select(item => item.ObjectKey).OrderBy(key => key).ToListAsync();
        Assert.Equal(new[]
        {
            $"event-images/{eventExtra:D}/320.webp", $"event-images/{eventExtra:D}/960.webp",
            $"event-images/{proposalExtra:D}/320.webp", $"event-images/{proposalExtra:D}/960.webp"
        }.OrderBy(key => key), deletedKeys);

        var storedJson = await database.EventProposals.AsNoTracking().Where(item => item.Id == proposalId).Select(item => item.PayloadJson).SingleAsync();
        var envelope = JsonSerializer.Deserialize<EventProposalEnvelope>(storedJson, EventProposalEndpoints.PayloadJsonOptions)!;
        Assert.Equal(EventProposalEnvelope.CurrentVersion, envelope.Version);
        Assert.Equal(proposalFirst, envelope.Event.ImageId);
        Assert.DoesNotContain("\"images\"", storedJson, StringComparison.Ordinal);
        Assert.Equal(EventPublicationService.PayloadHash(envelope.Event), envelope.PayloadHash);
        Assert.True(envelope.HasValidIntegrity());

        var duplicate = EventImage.CreateTemporary(Guid.NewGuid(), user.Id, 320, 180, Now);
        duplicate.AttachToEvent(eventId, user.Id, Now);
        database.EventImages.Add(duplicate);
        var conflict = await Assert.ThrowsAsync<DbUpdateException>(() => database.SaveChangesAsync());
        Assert.Equal(PostgresErrorCodes.UniqueViolation, ((PostgresException)conflict.InnerException!).SqlState);
    }

    [Fact]
    public async Task Missing_or_malformed_v2_image_arrays_remain_invalid_without_promoting_proposal_images()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync("20260902070415_DirectEventPublication");
        var user = User();
        database.Users.Add(user);
        await database.SaveChangesAsync();

        var missingProposalId = Guid.Parse("60000000-0000-0000-0000-000000000001");
        var malformedProposalId = Guid.Parse("60000000-0000-0000-0000-000000000002");
        var malformedArrayProposalId = Guid.Parse("60000000-0000-0000-0000-000000000003");
        var missingImageId = Guid.Parse("70000000-0000-0000-0000-000000000001");
        var malformedImageId = Guid.Parse("70000000-0000-0000-0000-000000000002");
        var malformedArrayImageId = Guid.Parse("70000000-0000-0000-0000-000000000003");
        var location = new { streetAddress = "1 Street", postalCode = "69001", city = "Lyon", country = "France", region = "Rhône", timeZoneId = "Europe/Paris" };
        var eventWithoutImages = new
        {
            organizationId = Guid.Parse("80000000-0000-0000-0000-000000000001"),
            title = "Missing Images Cup",
            summary = (string?)null,
            bodyMarkdown = (string?)null,
            location,
            eventType = "weekly",
            startsAtLocal = "2035-03-04T10:00",
            capacity = 32,
            formatIds = new[] { Guid.Parse("90000000-0000-0000-0000-000000000001") }
        };
        var missingPayload = JsonSerializer.Serialize(new
        {
            version = 2,
            payloadHash = "old",
            envelopeHash = "old",
            @event = eventWithoutImages,
            location
        });
        var malformedPayload = JsonSerializer.Serialize(new
        {
            version = 2,
            payloadHash = "old",
            envelopeHash = "old",
            @event = new
            {
                eventWithoutImages.organizationId,
                eventWithoutImages.title,
                eventWithoutImages.summary,
                eventWithoutImages.bodyMarkdown,
                eventWithoutImages.location,
                eventWithoutImages.eventType,
                eventWithoutImages.startsAtLocal,
                eventWithoutImages.capacity,
                eventWithoutImages.formatIds,
                images = new { imageId = malformedImageId }
            },
            location
        });
        var malformedArrayPayload = JsonSerializer.Serialize(new
        {
            version = 2,
            payloadHash = "old",
            envelopeHash = "old",
            @event = new
            {
                eventWithoutImages.organizationId,
                eventWithoutImages.title,
                eventWithoutImages.summary,
                eventWithoutImages.bodyMarkdown,
                eventWithoutImages.location,
                eventWithoutImages.eventType,
                eventWithoutImages.startsAtLocal,
                eventWithoutImages.capacity,
                eventWithoutImages.formatIds,
                images = new[] { new { imageId = "not-a-guid", altText = "Malformed" } }
            },
            location
        });

        await database.Database.ExecuteSqlInterpolatedAsync($$"""
            INSERT INTO event_proposals
                (id, submitted_by_user_id, payload_json, status, created_at, expires_at, decided_at, decided_by_user_id, rejection_reason, version)
            VALUES
                ({{missingProposalId}}, {{user.Id}}, {{missingPayload}}::jsonb, 'Pending', {{Now}}, {{Now + Duration.FromDays(7)}}, NULL, NULL, NULL, 1),
                ({{malformedProposalId}}, {{user.Id}}, {{malformedPayload}}::jsonb, 'Pending', {{Now}}, {{Now + Duration.FromDays(7)}}, NULL, NULL, NULL, 1),
                ({{malformedArrayProposalId}}, {{user.Id}}, {{malformedArrayPayload}}::jsonb, 'Pending', {{Now}}, {{Now + Duration.FromDays(7)}}, NULL, NULL, NULL, 1);
            INSERT INTO event_images
                (id, uploaded_by_user_id, state, event_id, proposal_id, sort_order, alt_text, width, height, created_at, expires_at)
            VALUES
                ({{missingImageId}}, {{user.Id}}, 'ProposalOwned', NULL, {{missingProposalId}}, 0, 'Missing', 320, 180, {{Now}}, {{Now + Duration.FromDays(7)}}),
                ({{malformedImageId}}, {{user.Id}}, 'ProposalOwned', NULL, {{malformedProposalId}}, 0, 'Malformed', 320, 180, {{Now}}, {{Now + Duration.FromDays(7)}}),
                ({{malformedArrayImageId}}, {{user.Id}}, 'ProposalOwned', NULL, {{malformedArrayProposalId}}, 0, 'Malformed array', 320, 180, {{Now}}, {{Now + Duration.FromDays(7)}});
            """);

        database.ChangeTracker.Clear();
        await database.Database.MigrateAsync();

        var storedPayloads = await database.EventProposals.AsNoTracking()
            .OrderBy(item => item.Id)
            .Select(item => item.PayloadJson)
            .ToListAsync();
        Assert.All(storedPayloads, storedJson =>
        {
            using var document = JsonDocument.Parse(storedJson);
            Assert.Equal(2, document.RootElement.GetProperty("version").GetInt32());
            var envelope = JsonSerializer.Deserialize<EventProposalEnvelope>(storedJson, EventProposalEndpoints.PayloadJsonOptions)!;
            Assert.NotEqual(EventProposalEnvelope.CurrentVersion, envelope.Version);
            Assert.False(envelope.HasValidIntegrity());
        });

        var retainedImages = await database.EventImages.AsNoTracking()
            .OrderBy(image => image.Id)
            .Select(image => new { image.Id, image.State, image.EventId, image.ProposalId })
            .ToListAsync();
        Assert.Equal(new[] { missingImageId, malformedImageId, malformedArrayImageId }, retainedImages.Select(image => image.Id));
        Assert.All(retainedImages, image =>
        {
            Assert.Equal(EventImageState.ProposalOwned, image.State);
            Assert.Null(image.EventId);
            Assert.NotNull(image.ProposalId);
        });
        Assert.Empty(await database.Events.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task Empty_v2_images_are_deleted_and_mismatched_first_image_remains_invalid()
    {
        await using var database = CreateContext();
        await database.Database.MigrateAsync("20260902070415_DirectEventPublication");
        var user = User();
        database.Users.Add(user);
        await database.SaveChangesAsync();

        var emptyProposalId = Guid.Parse("a0000000-0000-0000-0000-000000000001");
        var mismatchedProposalId = Guid.Parse("a0000000-0000-0000-0000-000000000002");
        var emptyFirst = Guid.Parse("b0000000-0000-0000-0000-000000000001");
        var emptyExtra = Guid.Parse("b0000000-0000-0000-0000-000000000002");
        var mismatchedSurvivor = Guid.Parse("c0000000-0000-0000-0000-000000000001");
        var mismatchedPayloadImage = Guid.Parse("c0000000-0000-0000-0000-000000000002");
        var location = new { streetAddress = "1 Street", postalCode = "69001", city = "Lyon", country = "France", region = "Rhône", timeZoneId = "Europe/Paris" };
        var eventFields = new
        {
            organizationId = Guid.Parse("d0000000-0000-0000-0000-000000000001"),
            title = "Migration Cup",
            summary = (string?)null,
            bodyMarkdown = (string?)null,
            location,
            eventType = "weekly",
            startsAtLocal = "2035-03-04T10:00",
            capacity = 32,
            formatIds = new[] { Guid.Parse("e0000000-0000-0000-0000-000000000001") }
        };
        var emptyPayload = JsonSerializer.Serialize(new
        {
            version = 2,
            payloadHash = "old",
            envelopeHash = "old",
            @event = new
            {
                eventFields.organizationId,
                eventFields.title,
                eventFields.summary,
                eventFields.bodyMarkdown,
                eventFields.location,
                eventFields.eventType,
                eventFields.startsAtLocal,
                eventFields.capacity,
                eventFields.formatIds,
                images = Array.Empty<object>()
            },
            location
        });
        var mismatchedPayload = JsonSerializer.Serialize(new
        {
            version = 2,
            payloadHash = "old",
            envelopeHash = "old",
            @event = new
            {
                eventFields.organizationId,
                eventFields.title,
                eventFields.summary,
                eventFields.bodyMarkdown,
                eventFields.location,
                eventFields.eventType,
                eventFields.startsAtLocal,
                eventFields.capacity,
                eventFields.formatIds,
                images = new[] { new { imageId = mismatchedPayloadImage, altText = "Conflicting" } }
            },
            location
        });

        await database.Database.ExecuteSqlInterpolatedAsync($$"""
            INSERT INTO event_proposals
                (id, submitted_by_user_id, payload_json, status, created_at, expires_at, decided_at, decided_by_user_id, rejection_reason, version)
            VALUES
                ({{emptyProposalId}}, {{user.Id}}, {{emptyPayload}}::jsonb, 'Pending', {{Now}}, {{Now + Duration.FromDays(7)}}, NULL, NULL, NULL, 1),
                ({{mismatchedProposalId}}, {{user.Id}}, {{mismatchedPayload}}::jsonb, 'Pending', {{Now}}, {{Now + Duration.FromDays(7)}}, NULL, NULL, NULL, 1);
            INSERT INTO event_images
                (id, uploaded_by_user_id, state, event_id, proposal_id, sort_order, alt_text, width, height, created_at, expires_at)
            VALUES
                ({{emptyExtra}}, {{user.Id}}, 'ProposalOwned', NULL, {{emptyProposalId}}, 1, 'Extra', 2000, 1125, {{Now}}, {{Now + Duration.FromDays(7)}}),
                ({{emptyFirst}}, {{user.Id}}, 'ProposalOwned', NULL, {{emptyProposalId}}, 0, 'First', 200, 112, {{Now}}, {{Now + Duration.FromDays(7)}}),
                ({{mismatchedPayloadImage}}, {{user.Id}}, 'ProposalOwned', NULL, {{mismatchedProposalId}}, 1, 'Conflicting', 960, 540, {{Now}}, {{Now + Duration.FromDays(7)}}),
                ({{mismatchedSurvivor}}, {{user.Id}}, 'ProposalOwned', NULL, {{mismatchedProposalId}}, 0, 'Survivor', 320, 180, {{Now}}, {{Now + Duration.FromDays(7)}});
            """);

        database.ChangeTracker.Clear();
        await database.Database.MigrateAsync();

        var emptyStoredJson = await database.EventProposals.AsNoTracking()
            .Where(item => item.Id == emptyProposalId)
            .Select(item => item.PayloadJson)
            .SingleAsync();
        var emptyEnvelope = JsonSerializer.Deserialize<EventProposalEnvelope>(emptyStoredJson, EventProposalEndpoints.PayloadJsonOptions)!;
        Assert.Equal(EventProposalEnvelope.CurrentVersion, emptyEnvelope.Version);
        Assert.Null(emptyEnvelope.Event.ImageId);
        Assert.True(emptyEnvelope.HasValidIntegrity());
        Assert.DoesNotContain("\"images\"", emptyStoredJson, StringComparison.Ordinal);
        Assert.Empty(await database.EventImages.AsNoTracking().Where(image => image.ProposalId == emptyProposalId).ToListAsync());

        var emptyDeletedKeys = await database.EventImageObjectDeletions.AsNoTracking()
            .Where(item => item.ImageId == emptyFirst || item.ImageId == emptyExtra)
            .Select(item => item.ObjectKey)
            .OrderBy(key => key)
            .ToListAsync();
        Assert.Equal(new[]
        {
            $"event-images/{emptyFirst:D}/200.webp",
            $"event-images/{emptyExtra:D}/320.webp",
            $"event-images/{emptyExtra:D}/960.webp",
            $"event-images/{emptyExtra:D}/1600.webp"
        }.OrderBy(key => key), emptyDeletedKeys);

        var mismatchedStoredJson = await database.EventProposals.AsNoTracking()
            .Where(item => item.Id == mismatchedProposalId)
            .Select(item => item.PayloadJson)
            .SingleAsync();
        using var mismatchedDocument = JsonDocument.Parse(mismatchedStoredJson);
        Assert.Equal(2, mismatchedDocument.RootElement.GetProperty("version").GetInt32());
        Assert.False(JsonSerializer.Deserialize<EventProposalEnvelope>(mismatchedStoredJson, EventProposalEndpoints.PayloadJsonOptions)!.HasValidIntegrity());
        var retainedMismatch = await database.EventImages.AsNoTracking()
            .Where(image => image.ProposalId == mismatchedProposalId)
            .Select(image => image.Id)
            .SingleAsync();
        Assert.Equal(mismatchedSurvivor, retainedMismatch);
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);

    private static ApplicationUser User() => new()
    {
        Id = Guid.NewGuid(), UserName = "migration@example.test", NormalizedUserName = "MIGRATION@EXAMPLE.TEST",
        Email = "migration@example.test", NormalizedEmail = "MIGRATION@EXAMPLE.TEST", EmailConfirmed = true,
        SecurityStamp = Guid.NewGuid().ToString("N"), ConcurrencyStamp = Guid.NewGuid().ToString("N")
    };
}
