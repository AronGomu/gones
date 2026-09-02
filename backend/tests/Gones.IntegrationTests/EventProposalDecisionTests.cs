using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Gones.Api.Events;
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
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodaTime;
using Xunit.Abstractions;

namespace Gones.IntegrationTests;

/// <summary>
/// T17. The mailed review link is the credential: presenting its token returns the submitted event,
/// approving publishes it as a public tournament with the submitter as owner, and refusing records a
/// reason and mails it back. A8 — one decision consumes the whole proposal, so every sibling
/// recipient's token stops working the moment anyone decides.
/// </summary>
public sealed class EventProposalDecisionTests(ITestOutputHelper output) : IAsyncLifetime
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
    public async Task Get_by_token_returns_the_payload()
    {
        var proposal = await SeedProposalAsync();

        using var response = await Client.GetAsync(ReviewUrl(proposal.OrganizerToken));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        output.WriteLine($"GET by-token -> {body}");
        Assert.Equal(proposal.Id, body.GetProperty("id").GetGuid());
        Assert.Equal("Pending", body.GetProperty("status").GetString());
        Assert.Equal(seed.SubmitterProfile.Username, body.GetProperty("submittedByUsername").GetString());
        Assert.Equal("organizer-olga", body.GetProperty("approverUsername").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("expiresAt").GetString()));

        var tournament = body.GetProperty("event");
        var expected = Payload();
        Assert.Equal(expected.Title, tournament.GetProperty("title").GetString());
        Assert.Equal(expected.Summary, tournament.GetProperty("summary").GetString());
        Assert.Equal(expected.BodyMarkdown, tournament.GetProperty("bodyMarkdown").GetString());
        Assert.False(tournament.TryGetProperty("bodyHtml", out _));
        Assert.Equal("<p>Welcome</p>", body.GetProperty("bodyHtml").GetString());
        var location = tournament.GetProperty("location");
        Assert.Equal(expected.Location.StreetAddress, location.GetProperty("streetAddress").GetString());
        Assert.Equal(expected.Location.PostalCode, location.GetProperty("postalCode").GetString());
        Assert.Equal(expected.Location.City, location.GetProperty("city").GetString());
        Assert.Equal(expected.Location.Country, location.GetProperty("country").GetString());
        Assert.Equal(expected.Location.Region, location.GetProperty("region").GetString());
        Assert.False(tournament.TryGetProperty("timeZoneId", out _));
        Assert.Equal(expected.StartsAtLocal, tournament.GetProperty("startsAtLocal").GetString());
        Assert.False(tournament.TryGetProperty("endsAtLocal", out _));
        Assert.Equal(expected.Capacity, tournament.GetProperty("capacity").GetInt32());
        Assert.Equal(
            new[] { seed.Legacy.Id },
            tournament.GetProperty("formatIds").EnumerateArray().Select(item => item.GetGuid()).ToArray());
    }

    [Fact]
    public async Task Get_by_token_returns_display_names()
    {
        var extra = TournamentFormat.Create("Doubles", "doubles", sortOrder: 1, Now);
        await using (var database = CreateContext())
        {
            database.TournamentFormats.Add(extra);
            await database.SaveChangesAsync();
        }
        var proposal = await SeedProposalAsync(extra);

        using var response = await Client.GetAsync(ReviewUrl(proposal.OrganizerToken));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        output.WriteLine($"GET by-token (display names) -> {body}");
        Assert.Equal(seed.Alpha.Name, body.GetProperty("organizationName").GetString());
        Assert.Equal(
            new[] { extra.Name },
            body.GetProperty("formatNames").EnumerateArray().Select(item => item.GetString()).ToArray());
    }

    [Fact]
    public async Task Get_by_token_tolerates_a_deleted_organization()
    {
        var proposal = await SeedProposalAsync();
        await using (var database = CreateContext())
        {
            var organization = await database.Organizations.SingleAsync(item => item.Id == seed.Alpha.Id);
            organization.SoftDelete(Now);
            await database.SaveChangesAsync();
        }

        using var response = await Client.GetAsync(ReviewUrl(proposal.OrganizerToken));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        output.WriteLine($"GET by-token (deleted org) -> {body}");
        Assert.Equal(string.Empty, body.GetProperty("organizationName").GetString());
        Assert.Equal(proposal.Id, body.GetProperty("id").GetGuid());
        Assert.Equal("Pending", body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Get_by_token_exposes_no_new_personal_data()
    {
        var proposal = await SeedProposalAsync();

        using var response = await Client.GetAsync(ReviewUrl(proposal.OrganizerToken));
        var raw = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        output.WriteLine($"GET by-token (raw) -> {raw}");
        Assert.DoesNotContain("@", raw, StringComparison.Ordinal);
        var body = JsonDocument.Parse(raw).RootElement;
        Assert.False(body.TryGetProperty("email", out _));
        Assert.False(body.TryGetProperty("userId", out _));
        Assert.False(body.TryGetProperty("submittedByUserId", out _));
        Assert.False(body.TryGetProperty("tokenHash", out _));
    }

    [Fact]
    public async Task Get_by_token_is_anonymous()
    {
        var proposal = await SeedProposalAsync();

        // No Authorization header and no test-user header: the token alone is the credential.
        using var request = new HttpRequestMessage(HttpMethod.Get, ReviewUrl(proposal.OrganizerToken));
        using var response = await Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Null(request.Headers.Authorization);
    }

    [Fact]
    public async Task Get_by_token_rejects_an_unknown_token()
    {
        await SeedProposalAsync();

        using var response = await Client.GetAsync(ReviewUrl(NewToken()));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Get_by_token_accepts_one_millisecond_before_expiry()
    {
        var proposal = await SeedProposalAsync();
        clock.Advance(EventProposal.Lifetime - Duration.FromMilliseconds(1));

        using var response = await Client.GetAsync(ReviewUrl(proposal.OrganizerToken));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Get_by_token_rejects_at_exact_expiry()
    {
        var proposal = await SeedProposalAsync();
        clock.Advance(EventProposal.Lifetime);

        using var expired = await Client.GetAsync(ReviewUrl(proposal.OrganizerToken));
        using var unknown = await Client.GetAsync(ReviewUrl(NewToken()));

        Assert.Equal(HttpStatusCode.NotFound, expired.StatusCode);
        var expiredBody = await expired.Content.ReadAsStringAsync();
        var unknownBody = await unknown.Content.ReadAsStringAsync();
        output.WriteLine($"expired -> {expiredBody}");
        output.WriteLine($"unknown -> {unknownBody}");
        // An expired link must not confirm that a proposal ever existed: same code, no identifiers.
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(
            JsonDocument.Parse(unknownBody).RootElement.GetProperty("code").GetString(),
            JsonDocument.Parse(expiredBody).RootElement.GetProperty("code").GetString());
        Assert.DoesNotContain(proposal.Id.ToString("D"), expiredBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Summer Cup", expiredBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(seed.SubmitterProfile.Username, expiredBody, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Legacy_proposal_missing_new_fields_conflicts_without_creating_Event()
    {
        var proposal = await SeedProposalAsync(legacyPayload: true);
        using var review = await Client.GetAsync(ReviewUrl(proposal.OrganizerToken));
        Assert.Equal(HttpStatusCode.Conflict, review.StatusCode);
        using var approve = await Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);
        Assert.Equal(HttpStatusCode.Conflict, approve.StatusCode);
        await using var database = CreateContext();
        Assert.Equal(0, await database.Events.CountAsync());
    }

    [Fact]
    public async Task Envelope_hash_binds_every_location_claim_version_and_payload_identity_and_approval_rejects_tampering()
    {
        var proposal = await SeedProposalAsync();
        EventProposalEnvelope baseline;
        await using (var database = CreateContext())
        {
            var stored = await database.EventProposals.AsNoTracking().SingleAsync(item => item.Id == proposal.Id);
            baseline = JsonSerializer.Deserialize<EventProposalEnvelope>(stored.PayloadJson, PayloadJsonOptions)!;
        }

        var location = baseline.Location;
        var mutations = new Dictionary<string, EventProposalEnvelope>
        {
            ["version"] = baseline with { Version = baseline.Version + 1 },
            ["payloadHash"] = baseline with { PayloadHash = new string('0', baseline.PayloadHash.Length) },
            ["payload"] = baseline with { Event = baseline.Event with { Title = "Mutated Cup" } },
            ["placeId"] = baseline with { Location = location with { PlaceId = "mutated-place" } },
            ["streetAddress"] = baseline with { Location = location with { StreetAddress = "99 Mutated Street" } },
            ["postalCode"] = baseline with { Location = location with { PostalCode = "99999" } },
            ["city"] = baseline with { Location = location with { City = "Mutated City" } },
            ["country"] = baseline with { Location = location with { Country = "Mutated Country" } },
            ["region"] = baseline with { Location = location with { Region = "Mutated Region" } },
            ["latitude"] = baseline with { Location = location with { Latitude = location.Latitude + 1m } },
            ["longitude"] = baseline with { Location = location with { Longitude = location.Longitude + 1m } },
            ["timeZoneId"] = baseline with { Location = location with { TimeZoneId = "UTC" } },
            ["expiresAt"] = baseline with { Location = location with { ExpiresAt = location.ExpiresAt + Duration.FromMinutes(1) } }
        };
        Assert.All(mutations, mutation => Assert.False(mutation.Value.HasValidIntegrity(), mutation.Key));

        await using (var database = CreateContext())
        {
            var tamperedJson = JsonSerializer.Serialize(mutations["timeZoneId"], PayloadJsonOptions);
            await database.EventProposals
                .Where(item => item.Id == proposal.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.PayloadJson, tamperedJson));
        }

        using var response = await Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        await using var verify = CreateContext();
        Assert.Equal(0, await verify.Events.CountAsync());
    }

    [Fact]
    public async Task Approve_publishes_the_tournament()
    {
        var proposal = await SeedProposalAsync();

        using var response = await Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        output.WriteLine($"POST approve -> {body}");
        Assert.Equal(proposal.Id, body.GetProperty("proposalId").GetGuid());
        Assert.Equal("Approved", body.GetProperty("status").GetString());
        var slug = body.GetProperty("slug").GetString();
        Assert.False(string.IsNullOrWhiteSpace(slug));

        using var detail = await Client.GetAsync($"/api/events/{slug}");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        var published = await detail.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Summer Cup", published.GetProperty("title").GetString());
        Assert.Equal("Auvergne-Rhône-Alpes", published.GetProperty("venue").GetProperty("region").GetString());
        Assert.Equal("weekly", published.GetProperty("eventType").GetString());

        // Ownership and audit reflect who proposed it, not who approved it.
        await using var database = CreateContext();
        var tournament = await database.Events.AsNoTracking().SingleAsync();
        Assert.Equal(slug, tournament.Slug);
        Assert.Equal(seed.Submitter.Id, tournament.CreatedByUserId);
        Assert.Equal(seed.Alpha.Id, tournament.OrganizationId);
        Assert.Equal("Auvergne-Rhône-Alpes", tournament.Region);
        Assert.Equal(CalendarEventType.Weekly, tournament.EventType);
    }

    [Fact]
    public async Task Approve_uses_submission_validated_location_after_client_token_expires()
    {
        var proposal = await SeedProposalAsync();
        clock.Advance(EventLocationTokenService.Lifetime + Duration.FromMinutes(1));

        using var response = await Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var database = CreateContext();
        var published = await database.Events.AsNoTracking().SingleAsync();
        Assert.Equal("google-place-id", published.ProviderPlaceId);
        Assert.Equal("Europe/Paris", published.TimeZoneId);
    }

    [Fact]
    public async Task Approve_marks_the_proposal_decided()
    {
        var proposal = await SeedProposalAsync();

        using var response = await Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var database = CreateContext();
        var stored = await database.EventProposals.AsNoTracking().SingleAsync();
        Assert.Equal(TournamentProposalStatus.Approved, stored.Status);
        Assert.Equal(seed.Organizer.Id, stored.DecidedByUserId);
        Assert.Equal(Now, stored.DecidedAt);
        Assert.Null(stored.RejectionReason);
    }

    [Fact]
    public async Task Approve_records_an_audit_row()
    {
        var proposal = await SeedProposalAsync();

        using var response = await Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var database = CreateContext();
        var audit = await database.AuditRecords.AsNoTracking()
            .Where(record => record.Action == "tournament-proposal.approved")
            .SingleAsync();
        output.WriteLine($"audit diff -> {audit.RedactedDiff}");
        Assert.Equal("tournament_proposal", audit.EntityType);
        Assert.Equal(proposal.Id.ToString("D"), audit.EntityId);
        Assert.Equal(seed.Organizer.Id, audit.ActorId);
        var tournamentId = await database.Events.AsNoTracking().Select(item => item.Id).SingleAsync();
        Assert.Contains(seed.Organizer.Id.ToString("D"), audit.RedactedDiff, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(tournamentId.ToString("D"), audit.RedactedDiff, StringComparison.OrdinalIgnoreCase);
        // Audit storage stays free of submitted content.
        Assert.DoesNotContain("Summer Cup", audit.RedactedDiff, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(seed.Submitter.Email!, audit.RedactedDiff, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Approve_twice_conflicts()
    {
        var proposal = await SeedProposalAsync();

        using var first = await Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);
        // A8: the second call uses the *other* recipient's token, not a replay of the first one.
        Assert.NotEqual(proposal.OrganizerToken, proposal.AdminToken);
        using var sibling = await Client.PostAsync(ReviewUrl(proposal.AdminToken) + "/approve", null);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, sibling.StatusCode);
        output.WriteLine($"sibling token approve -> {(int)sibling.StatusCode} {await sibling.Content.ReadAsStringAsync()}");

        using var all = await Client.GetAsync("/api/events/all");
        var items = (await all.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());

        await using var database = CreateContext();
        Assert.Equal(1, await database.Events.CountAsync());
        var stored = await database.EventProposals.AsNoTracking().SingleAsync();
        Assert.Equal(TournamentProposalStatus.Approved, stored.Status);
        // The first decider owns the decision; the sibling never overwrote it.
        Assert.Equal(seed.Organizer.Id, stored.DecidedByUserId);
        Assert.Equal(1, await database.AuditRecords.CountAsync(record => record.Action == "tournament-proposal.approved"));
    }

    /// <summary>
    /// T26. A review link lives for seven days, so authority has to be re-read when it is used, not
    /// only when it was mailed. An approver demoted to a plain account publishes nothing.
    /// </summary>
    [Fact]
    public async Task Demoted_approver_cannot_publish()
    {
        var proposal = await SeedProposalAsync();
        await using (var database = CreateContext())
        {
            var organizer = await database.Users.SingleAsync(user => user.Id == seed.Organizer.Id);
            organizer.AssignGlobalRole(GlobalRoles.User);
            await database.SaveChangesAsync();
        }

        using var review = await Client.GetAsync(ReviewUrl(proposal.OrganizerToken));
        using var approve = await Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);

        output.WriteLine($"demoted approver -> GET {(int)review.StatusCode}, POST approve {(int)approve.StatusCode}");
        // A spent link and a link whose holder lost their standing fail identically: neither may
        // confirm that a proposal is sitting there waiting.
        Assert.Equal(HttpStatusCode.NotFound, review.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, approve.StatusCode);
        await using var stored = CreateContext();
        Assert.Equal(0, await stored.Events.CountAsync());
        Assert.Equal(TournamentProposalStatus.Pending, (await stored.EventProposals.AsNoTracking().SingleAsync()).Status);
    }

    /// <summary>
    /// T26. Same rule from the other side: the role survived, the membership did not. The global
    /// Admin on the same proposal keeps their standing, because the fallback is not collateral.
    /// </summary>
    [Fact]
    public async Task Approver_who_lost_membership_cannot_publish()
    {
        var proposal = await SeedProposalAsync();
        await using (var database = CreateContext())
        {
            var membership = await database.OrganizationMembers
                .SingleAsync(member => member.OrganizationId == seed.Alpha.Id && member.UserId == seed.Organizer.Id);
            database.OrganizationMembers.Remove(membership);
            await database.SaveChangesAsync();
        }

        using var approve = await Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);
        using var adminReview = await Client.GetAsync(ReviewUrl(proposal.AdminToken));

        output.WriteLine($"de-membered organizer approve -> {(int)approve.StatusCode}; global admin review -> {(int)adminReview.StatusCode}");
        Assert.Equal(HttpStatusCode.NotFound, approve.StatusCode);
        Assert.Equal(HttpStatusCode.OK, adminReview.StatusCode);
        await using var stored = CreateContext();
        Assert.Equal(0, await stored.Events.CountAsync());
        Assert.Equal(TournamentProposalStatus.Pending, (await stored.EventProposals.AsNoTracking().SingleAsync()).Status);
    }

    /// <summary>
    /// T11. Approving publishes without going through <c>POST /api/events</c>, so the Draft gate
    /// has to sit on the publish itself rather than on the endpoint. Emptying the organization leaves
    /// only the global-Admin recipient able to decide, and even that decision is refused: there is no
    /// organizer left to own the tournament.
    /// </summary>
    [Fact]
    public async Task Approving_a_proposal_for_a_draft_organization_is_refused()
    {
        var proposal = await SeedProposalAsync();
        await using (var database = CreateContext())
        {
            var memberships = await database.OrganizationMembers
                .Where(member => member.OrganizationId == seed.Alpha.Id)
                .ToListAsync();
            database.OrganizationMembers.RemoveRange(memberships);
            await database.SaveChangesAsync();
        }

        using var approve = await Client.PostAsync(ReviewUrl(proposal.AdminToken) + "/approve", null);

        output.WriteLine($"draft-org approve -> {(int)approve.StatusCode} {await approve.Content.ReadAsStringAsync()}");
        Assert.Equal(HttpStatusCode.Conflict, approve.StatusCode);
        var problem = await approve.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("organization_is_draft", problem.GetProperty("code").GetString());

        await using var stored = CreateContext();
        Assert.Equal(0, await stored.Events.CountAsync());
        Assert.Equal(TournamentProposalStatus.Pending, (await stored.EventProposals.AsNoTracking().SingleAsync()).Status);
    }

    /// <summary>
    /// T26. The race made deterministic: an outside transaction holds the proposal's row lock, so
    /// approve stalls wherever it first needs that row, and the refusal commits while it waits.
    /// Publishing before the lock leaves a live, registerable tournament hanging off a rejected
    /// proposal with nothing to take it down; publishing after it leaves nothing at all.
    /// </summary>
    [Fact]
    public async Task Approve_racing_reject_publishes_nothing()
    {
        var proposal = await SeedProposalAsync();

        await using var blocker = CreateContext();
        await using var transaction = await blocker.Database.BeginTransactionAsync();
        var held = (await blocker.EventProposals
            .FromSql($"SELECT * FROM event_proposals WHERE id = {proposal.Id} FOR UPDATE")
            .ToListAsync()).Single();

        var approving = Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);
        await Task.Delay(TimeSpan.FromSeconds(3));
        held.Reject(seed.Admin.Id, Reason, clock.GetCurrentInstant());
        await blocker.SaveChangesAsync();
        await transaction.CommitAsync();

        using var response = await approving;

        output.WriteLine($"approve losing the race -> {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        await using var stored = CreateContext();
        var decided = await stored.EventProposals.AsNoTracking().SingleAsync();
        Assert.Equal(TournamentProposalStatus.Rejected, decided.Status);
        Assert.Equal(seed.Admin.Id, decided.DecidedByUserId);
        Assert.Equal(0, await stored.Events.CountAsync());
        using var all = await Client.GetAsync("/api/events/all");
        Assert.Equal(0, (await all.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Reject_requires_a_reason()
    {
        var proposal = await SeedProposalAsync();

        using var response = await RejectAsync(proposal.OrganizerToken, string.Empty);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("reason", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        await using var database = CreateContext();
        Assert.Equal(TournamentProposalStatus.Pending, (await database.EventProposals.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Reject_caps_the_reason_length()
    {
        var proposal = await SeedProposalAsync();

        using var oversized = await RejectAsync(proposal.OrganizerToken, new string('x', 2001));
        // The stored column is varchar(EventProposal.MaximumRejectionReasonLength): anything
        // above it must be refused by validation, never by an unhandled domain throw.
        using var aboveColumn = await RejectAsync(
            proposal.OrganizerToken,
            new string('y', EventProposal.MaximumRejectionReasonLength + 1));

        Assert.Equal(HttpStatusCode.BadRequest, oversized.StatusCode);
        Assert.Contains("reason", await oversized.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.BadRequest, aboveColumn.StatusCode);
        Assert.Contains("reason", await aboveColumn.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        await using var database = CreateContext();
        Assert.Equal(TournamentProposalStatus.Pending, (await database.EventProposals.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Reject_marks_the_proposal_rejected()
    {
        var proposal = await SeedProposalAsync();

        using var response = await RejectAsync(proposal.OrganizerToken, Reason);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await using var database = CreateContext();
        var stored = await database.EventProposals.AsNoTracking().SingleAsync();
        Assert.Equal(TournamentProposalStatus.Rejected, stored.Status);
        Assert.Equal(Reason, stored.RejectionReason);
        Assert.Equal(seed.Organizer.Id, stored.DecidedByUserId);
        Assert.Equal(Now, stored.DecidedAt);
        var audit = await database.AuditRecords.AsNoTracking()
            .Where(record => record.Action == "tournament-proposal.rejected")
            .SingleAsync();
        Assert.Equal(proposal.Id.ToString("D"), audit.EntityId);
        Assert.Equal(seed.Organizer.Id, audit.ActorId);
        // The reason is user-supplied content: it belongs in the mail, never in audit storage.
        Assert.DoesNotContain(Reason, audit.RedactedDiff, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Reject_mails_the_submitter()
    {
        var proposal = await SeedProposalAsync();

        using var response = await RejectAsync(proposal.OrganizerToken, Reason);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        await using var database = CreateContext();
        var mail = await database.NotificationOutboxRecords.AsNoTracking().SingleAsync();
        Assert.Equal("tournament-proposal-rejected", mail.TemplateKey);
        Assert.Equal(seed.Submitter.Email, mail.Recipient);
        Assert.Equal(seed.Submitter.Id, mail.UserId);
        Assert.Equal("fr", mail.Locale);
        Assert.Contains(proposal.Id.ToString("D"), mail.DedupeKey, StringComparison.Ordinal);

        var rendered = new NotificationTemplateRenderer()
            .Render(mail.Locale, NotificationModelSerializer.Deserialize(mail.TemplateKey, mail.TemplateModelJson!));
        output.WriteLine($"rejection mail ({mail.Locale}) -> {rendered.Subject}\n{rendered.TextBody}");
        Assert.Contains(Reason, rendered.TextBody, StringComparison.Ordinal);
        Assert.Contains(Reason, rendered.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("Summer Cup", rendered.TextBody, StringComparison.Ordinal);
        Assert.Contains(seed.SubmitterProfile.Username, rendered.TextBody, StringComparison.Ordinal);
        Assert.Contains("organizer-olga", rendered.TextBody, StringComparison.Ordinal);
        // ADR 0038 deleted /calendar with no redirect, so the calendar link is the live Event list.
        Assert.Contains("https://app.example/events", rendered.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("/calendar", rendered.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("/calendar", rendered.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("{{", rendered.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("{{", rendered.HtmlBody, StringComparison.Ordinal);
        Assert.NotEmpty(rendered.Subject);
    }

    [Fact]
    public async Task Reject_publishes_nothing()
    {
        var proposal = await SeedProposalAsync();
        using var before = await Client.GetAsync("/api/events/all");
        var beforeCount = (await before.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").GetArrayLength();

        using var response = await RejectAsync(proposal.OrganizerToken, Reason);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        using var after = await Client.GetAsync("/api/events/all");
        var afterCount = (await after.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").GetArrayLength();

        output.WriteLine($"/api/events/all items before={beforeCount} after={afterCount}");
        Assert.Equal(beforeCount, afterCount);
        await using var database = CreateContext();
        Assert.Equal(0, await database.Events.CountAsync());
    }

    [Fact]
    public async Task Reject_after_approve_conflicts()
    {
        var proposal = await SeedProposalAsync();

        using var approve = await Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);
        using var reject = await RejectAsync(proposal.AdminToken, Reason);

        Assert.Equal(HttpStatusCode.OK, approve.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, reject.StatusCode);
        await using var database = CreateContext();
        var stored = await database.EventProposals.AsNoTracking().SingleAsync();
        Assert.Equal(TournamentProposalStatus.Approved, stored.Status);
        Assert.Null(stored.RejectionReason);
        Assert.Equal(0, await database.NotificationOutboxRecords.CountAsync());
    }

    [Fact]
    public async Task Decision_is_rate_limited()
    {
        var statuses = new List<HttpStatusCode>();
        var attempted = new List<string>();
        for (var attempt = 0; attempt < 21; attempt++)
        {
            // Every attempt guesses a *different* token, which is what a real attacker does. The
            // bucket must key on the route, not on the path, or each guess would get its own budget.
            var guess = NewToken();
            attempted.Add(guess);
            using var response = await Client.GetAsync(ReviewUrl(guess));
            statuses.Add(response.StatusCode);
        }

        output.WriteLine($"statuses -> {string.Join(",", statuses.Select(status => (int)status))}");
        Assert.Contains(HttpStatusCode.TooManyRequests, statuses);

        // Per ADR 0017 the rejection audit is best-effort and only the auth surface earns a durable row,
        // so this review-link route is metered but never audited: a token-guessing flood must not append
        // permanently retained rows. The redaction guard below is consequently vacuous — there is no row
        // left for it to inspect — and is kept only to record the invariant it once proved ("name the
        // route, never the token that was presented"). Do not read it as live coverage.
        await using var database = CreateContext();
        var audits = await database.AuditRecords.AsNoTracking()
            .Where(record => record.Action.EndsWith("rate_limited"))
            .Select(record => record.Action)
            .ToListAsync();
        output.WriteLine($"rate-limit audit actions -> {string.Join(",", audits.Distinct(StringComparer.Ordinal))}");
        Assert.Empty(audits);
        foreach (var action in audits)
        {
            Assert.DoesNotContain(attempted, guess => action.Contains(guess, StringComparison.Ordinal));
        }
    }

    private Task<HttpResponseMessage> RejectAsync(string token, string reason)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, ReviewUrl(token) + "/reject")
        {
            Content = JsonContent.Create(new { reason })
        };
        return SendAndDisposeAsync(request);
    }

    private async Task<HttpResponseMessage> SendAndDisposeAsync(HttpRequestMessage request)
    {
        using (request) return await Client.SendAsync(request);
    }

    private static string ReviewUrl(string token) =>
        $"/api/event-proposals/by-token/{Uri.EscapeDataString(token)}";

    /// <summary>
    /// Seeds a pending proposal straight into the database with both recipients' plaintext tokens in
    /// hand. Going through <c>POST /api/event-proposals</c> would burn the shared IP rate-limit
    /// budget these tests need for the decision calls, and would never hand back a sibling token.
    /// </summary>
    private async Task<SeededProposal> SeedProposalAsync(TournamentFormat? extraFormat = null, bool legacyPayload = false)
    {
        var organizerToken = NewToken();
        var adminToken = NewToken();
        var payload = Payload(extraFormat);
        var proposalJson = legacyPayload
            ? JsonSerializer.Serialize(new { payload.OrganizationId, payload.Title }, PayloadJsonOptions)
            : JsonSerializer.Serialize(EventProposalEnvelope.Create(payload, ValidatedLocation(payload.Location)), PayloadJsonOptions);
        var proposal = EventProposal.Create(
            seed.Submitter.Id,
            proposalJson,
            clock.GetCurrentInstant());
        proposal.AddRecipient(seed.Organizer.Id, Sha256Hex(organizerToken), clock.GetCurrentInstant());
        proposal.AddRecipient(seed.Admin.Id, Sha256Hex(adminToken), clock.GetCurrentInstant());

        await using var database = CreateContext();
        database.EventProposals.Add(proposal);
        await database.SaveChangesAsync();
        return new SeededProposal(proposal.Id, organizerToken, adminToken);
    }

    private static string NewToken() => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    private static string Sha256Hex(string plaintext) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(plaintext)));

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t17-proposal-decision-signing-key-with-more-than-32-characters");
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
        var organizer = User("Organizer", GlobalRoles.Organizer, emailConfirmed: true);
        var admin = User("Admin", GlobalRoles.Admin, emailConfirmed: true);
        var alpha = Organization.Create("Alpha Club", "Public alpha", "https://alpha.example", "alpha@example.test", Now);
        var legacy = await database.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug)
            ?? TournamentFormat.CreateLegacy(Now);
        database.Users.AddRange(submitter, organizer, admin);
        database.Organizations.Add(alpha);
        if (database.Entry(legacy).State == EntityState.Detached) database.TournamentFormats.Add(legacy);
        await database.SaveChangesAsync();

        var submitterProfile = Profile(submitter.Id, "submitter-anna", "fr");
        database.UserProfiles.AddRange(
            submitterProfile,
            Profile(organizer.Id, "organizer-olga", "fr"),
            Profile(admin.Id, "admin-adam", "en"));
        database.OrganizationMembers.Add(OrganizationMember.Create(alpha.Id, organizer.Id, OrganizationRoles.Organizer, Now));
        await database.SaveChangesAsync();
        return new SeedRows(alpha, submitter, submitterProfile, organizer, admin, legacy);
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

    private EventPayloadRequest Payload(TournamentFormat? extraFormat = null) => new(
        seed.Alpha.Id,
        "Summer Cup",
        new EventLocationInput(
            "12 Rue de la Paix",
            "75001",
            "Paris",
            "France",
            "Auvergne-Rhône-Alpes",
            "valid-location-token"),
        PublicCalendarEventType.Weekly,
        "2035-03-04T10:00",
        64,
        [extraFormat?.Id ?? seed.Legacy.Id],
        [],
        "Featured",
        "Welcome");

    private static ValidatedEventLocation ValidatedLocation(EventLocationInput input) => new(
        "google-place-id",
        input.StreetAddress,
        input.PostalCode,
        input.City,
        input.Country,
        input.Region,
        45.764m,
        4.8357m,
        "Europe/Paris",
        Now + EventLocationTokenService.Lifetime);

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options;
        return new GonesDbContext(options);
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);
    private const string Reason = "Venue is already booked that weekend.";

    /// <summary>Uses the exact persisted-envelope options, including lossless NodaTime claims.</summary>
    private static readonly JsonSerializerOptions PayloadJsonOptions = EventProposalEndpoints.PayloadJsonOptions;

    private sealed record SeededProposal(Guid Id, string OrganizerToken, string AdminToken);

    private sealed record SeedRows(
        Organization Alpha,
        ApplicationUser Submitter,
        UserProfile SubmitterProfile,
        ApplicationUser Organizer,
        ApplicationUser Admin,
        TournamentFormat Legacy);

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Advance(Duration duration) => current += duration;
    }
}
