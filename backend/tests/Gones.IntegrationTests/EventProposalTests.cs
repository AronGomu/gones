using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Gones.Api.Errors;
using Gones.Application.Events;
using Gones.Application.Notifications;
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
using Npgsql;
using Xunit.Abstractions;

namespace Gones.IntegrationTests;

/// <summary>
/// T16. A verified non-organizer submits a tournament proposal; it is stored as JSON (never as a
/// draft tournament, so it cannot leak into the public calendar) and every chosen approver is mailed
/// a review link carrying its own single-use token. Only the SHA-256 hash of a token reaches the
/// database.
/// </summary>
public sealed class EventProposalTests(ITestOutputHelper output) : IAsyncLifetime
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
    public async Task Approvers_requires_authentication()
    {
        using var response = await Client.GetAsync("/api/event-proposals/approvers");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Approvers_lists_organizers_and_admins()
    {
        using var response = await SendAsync(HttpMethod.Get, ApproversUrl(seed.Alpha.Id), seed.Submitter.Id, GlobalRoles.User);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var items = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ids = items.EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        Assert.Contains(seed.Organizer.Id, ids);
        Assert.Contains(seed.Admin.Id, ids);
        Assert.DoesNotContain(seed.Submitter.Id, ids);
        Assert.DoesNotContain(seed.Bystander.Id, ids);
        Assert.DoesNotContain(seed.Unverified.Id, ids);
        var roles = items.EnumerateArray().Select(item => item.GetProperty("globalRole").GetString()).Distinct().Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(new[] { GlobalRoles.Admin, GlobalRoles.Organizer }, roles);
    }

    /// <summary>
    /// T26. Publishing into an organization is consent given on its behalf, so the candidates for a
    /// proposal aimed at Alpha are Alpha's own Organizers plus the global Admins that back every
    /// organization. An Organizer whose only membership is Beta has no standing over Alpha at all.
    /// </summary>
    [Fact]
    public async Task Approvers_are_scoped_to_the_target_organization()
    {
        using var response = await SendAsync(HttpMethod.Get, ApproversUrl(seed.Alpha.Id), seed.Submitter.Id, GlobalRoles.User);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var raw = await response.Content.ReadAsStringAsync();
        output.WriteLine($"GET approvers for Alpha -> {raw}");
        var ids = JsonDocument.Parse(raw).RootElement.EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        Assert.Contains(seed.Organizer.Id, ids);
        Assert.Contains(seed.Admin.Id, ids);
        Assert.DoesNotContain(seed.BetaOrganizer.Id, ids);
        // Narrowing the list must not widen what it exposes: still an identity, never a mailbox.
        Assert.DoesNotContain("@", raw, StringComparison.Ordinal);
        Assert.DoesNotContain(seed.BetaOrganizer.Email!, raw, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// T26. The Admin fallback is what keeps every organization reachable: Gamma has no members at
    /// all, and a proposal for it still has someone who can decide it.
    /// </summary>
    [Fact]
    public async Task Global_admins_are_always_offered()
    {
        using var response = await SendAsync(HttpMethod.Get, ApproversUrl(seed.Gamma.Id), seed.Submitter.Id, GlobalRoles.User);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var raw = await response.Content.ReadAsStringAsync();
        output.WriteLine($"GET approvers for Gamma (no members) -> {raw}");
        var ids = JsonDocument.Parse(raw).RootElement.EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        Assert.NotEmpty(ids);
        Assert.Equal(new[] { seed.Admin.Id }, ids);
    }

    [Fact]
    public async Task Approvers_never_returns_emails()
    {
        using var response = await SendAsync(HttpMethod.Get, ApproversUrl(seed.Alpha.Id), seed.Submitter.Id, GlobalRoles.User);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var raw = await response.Content.ReadAsStringAsync();
        output.WriteLine($"GET /api/event-proposals/approvers -> {raw}");
        output.WriteLine($"seeded approver mailboxes: {seed.Organizer.Email} | {seed.Admin.Email}");
        var items = await response.Content.ReadFromJsonAsync<JsonElement>();
        foreach (var item in items.EnumerateArray())
        {
            var names = item.EnumerateObject().Select(property => property.Name).ToArray();
            Assert.DoesNotContain(names, name => name.Contains("email", StringComparison.OrdinalIgnoreCase));
            Assert.Equal(new[] { "globalRole", "id", "username" }, names.Order(StringComparer.Ordinal).ToArray());
        }

        Assert.DoesNotContain("@", raw, StringComparison.Ordinal);
        Assert.DoesNotContain(seed.Organizer.Email!, raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(seed.Admin.Email!, raw, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Submit_requires_a_verified_email()
    {
        using var response = await SubmitAsync(seed.Unverified.Id, GlobalRoles.User, Payload(), [seed.Organizer.Id]);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await using var database = CreateContext();
        Assert.Equal(0, await database.EventProposals.CountAsync());
    }

    [Fact]
    public async Task Submit_rejects_an_organizer()
    {
        using var organizer = await SubmitAsync(seed.Organizer.Id, GlobalRoles.Organizer, Payload(), [seed.Admin.Id]);
        using var admin = await SubmitAsync(seed.Admin.Id, GlobalRoles.Admin, Payload(), [seed.Organizer.Id]);

        Assert.Equal(HttpStatusCode.Forbidden, organizer.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, admin.StatusCode);
        await using var database = CreateContext();
        Assert.Equal(0, await database.EventProposals.CountAsync());
    }

    [Fact]
    public async Task Submit_requires_at_least_one_recipient()
    {
        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), []);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("recipientUserIds", body, StringComparison.OrdinalIgnoreCase);
        await using var database = CreateContext();
        Assert.Equal(0, await database.EventProposals.CountAsync());
    }

    [Fact]
    public async Task Submit_rejects_a_non_approver_recipient()
    {
        using var plain = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [seed.Organizer.Id, seed.Bystander.Id]);
        using var unknown = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [Guid.NewGuid()]);

        Assert.Equal(HttpStatusCode.BadRequest, plain.StatusCode);
        Assert.Contains("recipientUserIds", await plain.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Contains("recipientUserIds", await unknown.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        await using var database = CreateContext();
        Assert.Equal(0, await database.EventProposals.CountAsync());
        Assert.Equal(0, await database.EventProposalRecipients.CountAsync());
    }

    /// <summary>
    /// T26. Being a global Organizer is no longer enough to be picked: the recipient has to
    /// represent the organization the tournament would be published under. Beta's organizer is a
    /// perfectly real approver — for Beta.
    /// </summary>
    [Fact]
    public async Task Submission_rejects_an_unrelated_recipient()
    {
        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [seed.BetaOrganizer.Id]);
        using var mixed = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [seed.Organizer.Id, seed.BetaOrganizer.Id]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("recipientUserIds", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        // One unrelated name poisons the whole submission: no partial send.
        Assert.Equal(HttpStatusCode.BadRequest, mixed.StatusCode);
        await using var database = CreateContext();
        Assert.Equal(0, await database.EventProposals.CountAsync());
        Assert.Equal(0, await database.EventProposalRecipients.CountAsync());
        Assert.Equal(0, await database.NotificationOutboxRecords.CountAsync());
    }

    /// <summary>
    /// T26. The list had a floor and no ceiling, which made one request an arbitrarily large mail
    /// fan-out. The cap is refused before the lookup runs, which is what the two bodies prove.
    /// </summary>
    [Fact]
    public async Task Submission_rejects_an_oversized_recipient_list()
    {
        var oversized = Enumerable.Range(0, MaximumRecipients + 1).Select(_ => Guid.NewGuid()).ToArray();

        using var over = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), oversized);
        using var atCap = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), oversized.Take(MaximumRecipients).ToArray());

        var overBody = await over.Content.ReadAsStringAsync();
        var atCapBody = await atCap.Content.ReadAsStringAsync();
        output.WriteLine($"{oversized.Length} recipients -> {(int)over.StatusCode} {overBody}");
        output.WriteLine($"{MaximumRecipients} recipients -> {(int)atCap.StatusCode} {atCapBody}");
        Assert.Equal(HttpStatusCode.BadRequest, over.StatusCode);
        Assert.Contains("recipientUserIds", overBody, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(MaximumRecipients.ToString(System.Globalization.CultureInfo.InvariantCulture), overBody, StringComparison.Ordinal);
        // A list at the cap gets as far as the lookup and fails there instead; an oversized one is
        // turned away before it, so it can never report the lookup's verdict.
        Assert.DoesNotContain("approvers are invalid", overBody, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.BadRequest, atCap.StatusCode);
        Assert.Contains("approvers are invalid", atCapBody, StringComparison.OrdinalIgnoreCase);
        await using var database = CreateContext();
        Assert.Equal(0, await database.EventProposals.CountAsync());
    }

    /// <summary>
    /// T26, the whole point of the flow: the submitter belongs to no organization whatsoever, and
    /// the organization they propose for is one the anonymous public list offers them.
    /// </summary>
    [Fact]
    public async Task Submit_stores_normalized_manual_location_and_timezone_in_envelope()
    {
        var eventJson = JsonNode.Parse(JsonSerializer.Serialize(Payload()))!.AsObject();
        var location = eventJson["Location"]!.AsObject();
        location["StreetAddress"] = "  12 Rue de la Paix  ";
        location["PostalCode"] = "  75001  ";
        location["City"] = "  Paris  ";
        location["Country"] = "  France  ";
        location["Region"] = "  Île-de-France  ";
        location["TimeZoneId"] = "  Europe/Paris  ";

        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/event-proposals",
            seed.Submitter.Id,
            GlobalRoles.User,
            new { @event = eventJson, recipientUserIds = new[] { seed.Organizer.Id } });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        await using var database = CreateContext();
        var proposal = await database.EventProposals.AsNoTracking().SingleAsync();
        using var document = JsonDocument.Parse(proposal.PayloadJson);
        var stored = document.RootElement.GetProperty("location");
        Assert.Equal("12 Rue de la Paix", stored.GetProperty("streetAddress").GetString());
        Assert.Equal("75001", stored.GetProperty("postalCode").GetString());
        Assert.Equal("Paris", stored.GetProperty("city").GetString());
        Assert.Equal("France", stored.GetProperty("country").GetString());
        Assert.Equal("Île-de-France", stored.GetProperty("region").GetString());
        Assert.Equal("Europe/Paris", stored.GetProperty("timeZoneId").GetString());
    }

    [Fact]
    public async Task Submit_rejects_unknown_IANA_timezone_with_nested_field_error()
    {
        var eventJson = JsonNode.Parse(JsonSerializer.Serialize(Payload()))!.AsObject();
        var location = eventJson["Location"]!.AsObject();
        location["TimeZoneId"] = "Europe/Nope";

        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/event-proposals",
            seed.Submitter.Id,
            GlobalRoles.User,
            new { @event = eventJson, recipientUserIds = new[] { seed.Organizer.Id } });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("validation_failed", body.GetProperty("code").GetString());
        Assert.True(body.GetProperty("errors").TryGetProperty("event.location.timeZoneId", out _), body.ToString());
        await using var database = CreateContext();
        Assert.Equal(0, await database.EventProposals.CountAsync());
        Assert.Equal(0, await database.NotificationOutboxRecords.CountAsync());
    }

    [Fact]
    public async Task Non_member_can_submit_for_a_public_organization()
    {
        await using (var premise = CreateContext())
        {
            Assert.Equal(0, await premise.OrganizationMembers.CountAsync(member => member.UserId == seed.Submitter.Id));
        }

        // The other half — that the anonymous `GET /api/organizations` the picker now reads from
        // offers Alpha to an account with no memberships — is `OrganizationApiTests`; that endpoint
        // lives behind ADMIN_V1, which this suite deliberately leaves off.
        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [seed.Organizer.Id]);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        await using var database = CreateContext();
        var proposal = await database.EventProposals.AsNoTracking().SingleAsync();
        Assert.Equal(seed.Submitter.Id, proposal.SubmittedByUserId);
        Assert.Contains(seed.Alpha.Id.ToString("D"), proposal.PayloadJson, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(1, await database.EventProposalRecipients.CountAsync());
    }

    [Fact]
    public async Task Submit_promotes_one_image_to_proposal_ownership_and_blocks_reuse()
    {
        var first = EventImage.CreateTemporary(Guid.NewGuid(), seed.Submitter.Id, 960, 540, Now);
        var second = EventImage.CreateTemporary(Guid.NewGuid(), seed.Submitter.Id, 320, 180, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.AddRange(first, second);
            await database.SaveChangesAsync();
        }
        var payload = Payload() with
        {
            ImageId = second.Id
        };

        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, payload, [seed.Organizer.Id]);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        await using (var database = CreateContext())
        {
            var proposal = await database.EventProposals.AsNoTracking().SingleAsync();
            var images = await database.EventImages.AsNoTracking()
                .Where(image => image.ProposalId == proposal.Id)
                .ToListAsync();
            Assert.Equal(new[] { second.Id }, images.Select(image => image.Id).ToArray());
            Assert.All(images, image => Assert.Equal(EventImageState.ProposalOwned, image.State));
            Assert.All(images, image => Assert.Equal(proposal.ExpiresAt, image.ExpiresAt));
        }

        using var delete = await SendAsync(
            HttpMethod.Delete,
            $"/api/event-images/{second.Id:D}",
            seed.Submitter.Id,
            GlobalRoles.User);
        Assert.Equal(HttpStatusCode.Conflict, delete.StatusCode);
        Assert.Equal("image_state_conflict", await ProblemCode(delete));

        using var reuse = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, payload with { Title = "Reused Image Cup" }, [seed.Organizer.Id]);
        Assert.Equal(HttpStatusCode.Conflict, reuse.StatusCode);
        Assert.Equal("image_state_conflict", await ProblemCode(reuse));
        await using var verify = CreateContext();
        Assert.Equal(1, await verify.EventProposals.CountAsync());
    }

    [Fact]
    public async Task Invalid_approver_rolls_back_submission_and_keeps_images_temporary()
    {
        var image = EventImage.CreateTemporary(Guid.NewGuid(), seed.Submitter.Id, 960, 540, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.Add(image);
            await database.SaveChangesAsync();
        }
        var payload = Payload() with { ImageId = image.Id };

        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, payload, [seed.Bystander.Id]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await using var verify = CreateContext();
        Assert.Equal(0, await verify.EventProposals.CountAsync());
        var stored = await verify.EventImages.AsNoTracking().SingleAsync(item => item.Id == image.Id);
        Assert.Equal(EventImageState.Temporary, stored.State);
        Assert.Null(stored.ProposalId);
    }

    [Fact]
    public async Task Submission_rechecks_temporary_image_expiry_after_waiting_for_its_row_lock()
    {
        var image = EventImage.CreateTemporary(Guid.NewGuid(), seed.Submitter.Id, 960, 540, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.Add(image);
            await database.SaveChangesAsync();
        }
        var payload = Payload() with { ImageId = image.Id };

        await using var blocker = CreateContext();
        await using var transaction = await blocker.Database.BeginTransactionAsync();
        _ = await blocker.EventImages
            .FromSql($"SELECT * FROM event_images WHERE id = {image.Id} FOR UPDATE")
            .SingleAsync();

        var submitting = SubmitAsync(seed.Submitter.Id, GlobalRoles.User, payload, [seed.Organizer.Id]);
        await Task.Delay(TimeSpan.FromSeconds(1));
        Assert.False(submitting.IsCompleted);
        clock.Advance(EventImage.TemporaryLifetime);
        await transaction.CommitAsync();

        using var response = await submitting;

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("image_state_conflict", await ProblemCode(response));
        await using var verify = CreateContext();
        Assert.Equal(0, await verify.EventProposals.CountAsync());
        Assert.Equal(0, await verify.NotificationOutboxRecords.CountAsync());
        var stored = await verify.EventImages.AsNoTracking().SingleAsync(item => item.Id == image.Id);
        Assert.Equal(EventImageState.Temporary, stored.State);
        Assert.Null(stored.ProposalId);
        Assert.Equal(Now + EventImage.TemporaryLifetime, stored.ExpiresAt);
    }

    [Fact]
    public async Task Failure_after_image_attachment_rolls_back_proposal_outbox_and_image_state()
    {
        var image = EventImage.CreateTemporary(Guid.NewGuid(), seed.Submitter.Id, 960, 540, Now);
        await using (var database = CreateContext())
        {
            database.EventImages.Add(image);
            await database.SaveChangesAsync();
            await database.Database.ExecuteSqlRawAsync("""
                CREATE FUNCTION fail_proposal_outbox_insert() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.template_key = 'tournament-proposal' THEN
                        RAISE EXCEPTION 'injected proposal outbox failure after attachment';
                    END IF;
                    RETURN NEW;
                END $$;
                """);
            await database.Database.ExecuteSqlRawAsync("""
                CREATE TRIGGER fail_proposal_outbox_insert
                BEFORE INSERT ON notification_outbox
                FOR EACH ROW EXECUTE FUNCTION fail_proposal_outbox_insert();
                """);
        }
        var payload = Payload() with { ImageId = image.Id };

        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, payload, [seed.Organizer.Id]);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        await using var verify = CreateContext();
        Assert.Equal(0, await verify.EventProposals.CountAsync());
        Assert.Equal(0, await verify.NotificationOutboxRecords.CountAsync());
        var stored = await verify.EventImages.AsNoTracking().SingleAsync(item => item.Id == image.Id);
        Assert.Equal(EventImageState.Temporary, stored.State);
        Assert.Null(stored.ProposalId);
        Assert.Equal(Now + EventImage.TemporaryLifetime, stored.ExpiresAt);
    }

    [Fact]
    public async Task Submit_stores_the_proposal()
    {
        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [seed.Organizer.Id, seed.Admin.Id]);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var proposalId = body.GetProperty("id").GetGuid();
        Assert.Equal("Pending", body.GetProperty("status").GetString());
        Assert.Equal(2, body.GetProperty("recipientCount").GetInt32());

        await using var database = CreateContext();
        var proposal = await database.EventProposals.AsNoTracking().SingleAsync();
        Assert.Equal(proposalId, proposal.Id);
        Assert.Equal(TournamentProposalStatus.Pending, proposal.Status);
        Assert.Equal(seed.Submitter.Id, proposal.SubmittedByUserId);
        Assert.Null(proposal.DecidedAt);
        Assert.Null(proposal.DecidedByUserId);
        Assert.Contains("Summer Cup", proposal.PayloadJson, StringComparison.Ordinal);

        var recipients = await database.EventProposalRecipients.AsNoTracking()
            .Where(recipient => recipient.ProposalId == proposalId)
            .ToListAsync();
        Assert.Equal(2, recipients.Count);
        Assert.Equal(
            new[] { seed.Admin.Id, seed.Organizer.Id }.Order().ToArray(),
            recipients.Select(recipient => recipient.UserId).Order().ToArray());
    }

    [Fact]
    public async Task Submit_stores_only_token_hashes()
    {
        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [seed.Organizer.Id, seed.Admin.Id]);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        await using var database = CreateContext();
        var hashes = await database.EventProposalRecipients.AsNoTracking()
            .Select(recipient => recipient.TokenHash)
            .ToListAsync();
        Assert.Equal(2, hashes.Count);
        Assert.All(hashes, hash => Assert.Matches("^[0-9a-f]{64}$", hash));
        // Distinct per recipient: the approver's identity has to be provable from the token alone.
        Assert.Equal(2, hashes.Distinct(StringComparer.Ordinal).Count());

        var tokens = await PlaintextTokensAsync();
        Assert.Equal(2, tokens.Count);
        Assert.Equal(2, tokens.Distinct(StringComparer.Ordinal).Count());
        foreach (var token in tokens)
        {
            // Casting the whole row to text covers every column at once: no column may hold the plaintext.
            var inProposals = await CountRowsContainingAsync("event_proposals", token);
            var inRecipients = await CountRowsContainingAsync("event_proposal_recipients", token);
            output.WriteLine($"plaintext={token} len={token.Length} rows_holding_plaintext: event_proposals={inProposals} event_proposal_recipients={inRecipients}");
            Assert.Equal(0, inProposals);
            Assert.Equal(0, inRecipients);
            Assert.Contains(AccountLifecycleHash(token), hashes, StringComparer.Ordinal);
        }

        foreach (var hash in hashes) output.WriteLine($"stored token_hash={hash} length={hash.Length}");
    }

    [Fact]
    public async Task Submit_enqueues_one_mail_per_recipient()
    {
        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [seed.Organizer.Id, seed.Admin.Id]);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var proposalId = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        await using var database = CreateContext();
        var mails = await database.NotificationOutboxRecords.AsNoTracking().OrderBy(record => record.DedupeKey).ToListAsync();
        Assert.Equal(2, mails.Count);
        Assert.All(mails, mail => Assert.Equal("tournament-proposal", mail.TemplateKey));
        Assert.Equal(2, mails.Select(mail => mail.DedupeKey).Distinct(StringComparer.Ordinal).Count());
        Assert.All(mails, mail => Assert.Contains(proposalId.ToString("D"), mail.DedupeKey, StringComparison.Ordinal));
        Assert.Equal(
            new[] { seed.Admin.Email!, seed.Organizer.Email! }.Order(StringComparer.OrdinalIgnoreCase).ToArray(),
            mails.Select(mail => mail.Recipient!).Order(StringComparer.OrdinalIgnoreCase).ToArray());
        Assert.Equal(
            new[] { seed.Admin.Id, seed.Organizer.Id }.Order().ToArray(),
            mails.Select(mail => mail.UserId!.Value).Order().ToArray());
        // Recipient locale drives the rendered language, not the submitter's.
        Assert.Equal(new[] { "en", "fr" }, mails.Select(mail => mail.Locale).Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public async Task Submit_mail_contains_every_field()
    {
        var payload = Payload();
        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, payload, [seed.Organizer.Id, seed.Admin.Id]);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var renderer = new NotificationTemplateRenderer();
        await using var database = CreateContext();
        var mails = await database.NotificationOutboxRecords.AsNoTracking().ToListAsync();
        Assert.Equal(2, mails.Count);
        foreach (var mail in mails)
        {
            var model = NotificationModelSerializer.Deserialize(mail.TemplateKey, mail.TemplateModelJson!);
            var rendered = renderer.Render(mail.Locale, model);
            foreach (var expected in new[]
                     {
                         payload.Title,
                         payload.Summary!,
                         payload.Location.StreetAddress,
                         payload.Location.PostalCode,
                         payload.Location.City,
                         payload.Location.Country,
                         "Europe/Paris",
                         payload.StartsAtLocal,
                         "2035-03-04T23:59:59",
                         payload.Capacity.ToString(System.Globalization.CultureInfo.InvariantCulture),
                         seed.Legacy.Name,
                         seed.SubmitterProfile.Username
                     })
            {
                Assert.Contains(expected, rendered.TextBody, StringComparison.Ordinal);
            }

            Assert.DoesNotContain("{{", rendered.TextBody, StringComparison.Ordinal);
            Assert.DoesNotContain("{{", rendered.HtmlBody, StringComparison.Ordinal);
            Assert.Contains("/event-requests/", rendered.TextBody, StringComparison.Ordinal);
            Assert.DoesNotContain("/tournament-requests/", rendered.TextBody, StringComparison.Ordinal);
            Assert.NotEmpty(rendered.Subject);
        }

        // Both locales are exercised by the two recipients, so the template exists in fr and en.
        Assert.Equal(new[] { "en", "fr" }, mails.Select(mail => mail.Locale).Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public async Task Submit_sets_a_seven_day_expiry()
    {
        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [seed.Organizer.Id]);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        await using var database = CreateContext();
        var proposal = await database.EventProposals.AsNoTracking().SingleAsync();
        Assert.Equal(Now, proposal.CreatedAt);
        Assert.Equal(proposal.CreatedAt + Duration.FromDays(7), proposal.ExpiresAt);
    }

    [Fact]
    public async Task Submit_creates_no_public_tournament()
    {
        using var before = await Client.GetAsync("/api/events/all");
        var beforeCount = (await before.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").GetArrayLength();

        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [seed.Organizer.Id]);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        using var after = await Client.GetAsync("/api/events/all");
        var afterCount = (await after.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").GetArrayLength();

        Assert.Equal(beforeCount, afterCount);
        await using var database = CreateContext();
        Assert.Equal(0, await database.Events.CountAsync());
        Assert.Equal(1, await database.EventProposals.CountAsync());
    }

    [Fact]
    public async Task Submit_is_rate_limited()
    {
        var statuses = new List<HttpStatusCode>();
        for (var attempt = 0; attempt < 11; attempt++)
        {
            using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [seed.Organizer.Id]);
            statuses.Add(response.StatusCode);
        }

        Assert.Contains(HttpStatusCode.TooManyRequests, statuses);
    }

    private Task<HttpResponseMessage> SubmitAsync(Guid userId, string role, TournamentPayload payload, IReadOnlyList<Guid> recipientUserIds) =>
        SendAsync(HttpMethod.Post, "/api/event-proposals", userId, role, new { @event = payload, recipientUserIds });

    private static string ApproversUrl(Guid organizationId) =>
        $"/api/event-proposals/approvers?organizationId={organizationId:D}";

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid userId, string role, object? body = null)
    {
        using var request = new HttpRequestMessage(method, url);
        if (body is not null) request.Content = JsonContent.Create(body);
        request.Headers.Add("X-Test-User", userId.ToString("D"));
        request.Headers.Add("X-Test-Roles", role);
        return await Client.SendAsync(request);
    }

    /// <summary>Recovers the plaintext tokens the only place they exist: inside the mailed review links.</summary>
    private async Task<IReadOnlyList<string>> PlaintextTokensAsync()
    {
        await using var database = CreateContext();
        var models = await database.NotificationOutboxRecords.AsNoTracking()
            .Select(record => record.TemplateModelJson!)
            .ToListAsync();
        return models
            .Select(json => JsonDocument.Parse(json).RootElement.GetProperty("reviewUrl").GetString()!)
            .Select(url => new Uri(url).Segments[^1].Trim('/'))
            .ToArray();
    }

    private async Task<long> CountRowsContainingAsync(string table, string needle)
    {
        await using var connection = new NpgsqlConnection(postgres.GetConnectionString());
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT count(*) FROM {table} AS row WHERE row::text LIKE '%' || @needle || '%'";
        command.Parameters.AddWithValue("needle", needle);
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private static string AccountLifecycleHash(string plaintext) =>
        Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(plaintext)));

    private static async Task<string?> ProblemCode(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString();

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t16-tournament-proposal-signing-key-with-more-than-32-characters");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(clock);
            });
        });

    private static async Task<SeedRows> SeedAsync(GonesDbContext database)
    {
        var submitter = User("Submitter", GlobalRoles.User, emailConfirmed: true);
        var unverified = User("Unverified", GlobalRoles.User, emailConfirmed: false);
        var bystander = User("Bystander", GlobalRoles.User, emailConfirmed: true);
        var organizer = User("Organizer", GlobalRoles.Organizer, emailConfirmed: true);
        var betaOrganizer = User("BetaOrganizer", GlobalRoles.Organizer, emailConfirmed: true);
        var admin = User("Admin", GlobalRoles.Admin, emailConfirmed: true);
        var alpha = Organization.Create("Alpha Club", "Public alpha", "https://alpha.example", "alpha@example.test", Now);
        // T26 needs three shapes of organization: one with an organizer, one with a *different*
        // organizer, and one with nobody at all.
        var beta = Organization.Create("Beta Club", "Public beta", "https://beta.example", "beta@example.test", Now);
        var gamma = Organization.Create("Gamma Club", "Public gamma", "https://gamma.example", "gamma@example.test", Now);
        var legacy = await database.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug)
            ?? TournamentFormat.CreateLegacy(Now);
        database.Users.AddRange(submitter, unverified, bystander, organizer, betaOrganizer, admin);
        database.Organizations.AddRange(alpha, beta, gamma);
        if (database.Entry(legacy).State == EntityState.Detached) database.TournamentFormats.Add(legacy);
        await database.SaveChangesAsync();

        var submitterProfile = Profile(submitter.Id, "submitter-anna", "fr");
        database.UserProfiles.AddRange(
            submitterProfile,
            Profile(unverified.Id, "unverified-ugo", "fr"),
            Profile(bystander.Id, "bystander-bea", "fr"),
            Profile(organizer.Id, "organizer-olga", "fr"),
            Profile(betaOrganizer.Id, "organizer-bruno", "fr"),
            Profile(admin.Id, "admin-adam", "en"));
        database.OrganizationMembers.AddRange(
            OrganizationMember.Create(alpha.Id, organizer.Id, OrganizationRoles.Organizer, Now),
            OrganizationMember.Create(beta.Id, betaOrganizer.Id, OrganizationRoles.Organizer, Now));
        await database.SaveChangesAsync();
        return new SeedRows(alpha, beta, gamma, submitter, submitterProfile, unverified, bystander, organizer, betaOrganizer, admin, legacy);
    }

    private static UserProfile Profile(Guid userId, string username, string language)
    {
        var profile = UserProfile.Create(userId, username, "Test", "Person", Now);
        profile.Update(username, "Test", "Person", null, null, null, null, language, false, false, false, false, false, Now.InUtc().Date, Now);
        return profile;
    }

    private static ApplicationUser User(string prefix, string role, bool emailConfirmed)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = $"{prefix}-{suffix}@example.test",
            NormalizedUserName = $"{prefix.ToUpperInvariant()}-{suffix}@EXAMPLE.TEST",
            Email = $"{prefix}-{suffix}@example.test",
            NormalizedEmail = $"{prefix.ToUpperInvariant()}-{suffix}@EXAMPLE.TEST",
            EmailConfirmed = emailConfirmed,
            SecurityStamp = Guid.NewGuid().ToString("N"),
            ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
        if (role != GlobalRoles.User) user.AssignGlobalRole(role);
        return user;
    }

    private TournamentPayload Payload() => new(
        seed.Alpha.Id,
        "Summer Cup",
        "Featured",
        "Welcome",
        new TournamentLocationPayload(
            "12 Rue de la Paix",
            "75001",
            "Paris",
            "France",
            "Auvergne-Rhône-Alpes",
            "Europe/Paris"),
        "weekly",
        "2035-03-04T10:00",
        64,
        [seed.Legacy.Id],
        null);

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options;
        return new GonesDbContext(options);
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);

    /// <summary>Mirrors <c>TournamentProposalEndpoints.MaximumRecipientCount</c>, which is internal to the API assembly.</summary>
    private const int MaximumRecipients = 10;

    private sealed record SeedRows(
        Organization Alpha,
        Organization Beta,
        Organization Gamma,
        ApplicationUser Submitter,
        UserProfile SubmitterProfile,
        ApplicationUser Unverified,
        ApplicationUser Bystander,
        ApplicationUser Organizer,
        ApplicationUser BetaOrganizer,
        ApplicationUser Admin,
        TournamentFormat Legacy);

    private sealed record TournamentPayload(
        Guid OrganizationId,
        string Title,
        string? Summary,
        string? BodyMarkdown,
        TournamentLocationPayload Location,
        string EventType,
        string StartsAtLocal,
        int Capacity,
        IReadOnlyList<Guid> FormatIds,
        Guid? ImageId);


    private sealed record TournamentLocationPayload(
        string StreetAddress,
        string PostalCode,
        string City,
        string Country,
        string Region,
        string TimeZoneId);

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Advance(Duration duration) => current += duration;
    }
}
