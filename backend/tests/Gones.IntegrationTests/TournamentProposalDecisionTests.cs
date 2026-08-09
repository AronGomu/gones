using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
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
using Testcontainers.PostgreSql;
using Xunit.Abstractions;

namespace Gones.IntegrationTests;

/// <summary>
/// T17. The mailed review link is the credential: presenting its token returns the submitted event,
/// approving publishes it as a public tournament with the submitter as owner, and refusing records a
/// reason and mails it back. A8 — one decision consumes the whole proposal, so every sibling
/// recipient's token stops working the moment anyone decides.
/// </summary>
public sealed class TournamentProposalDecisionTests(ITestOutputHelper output) : IAsyncLifetime
{
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
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

        var tournament = body.GetProperty("tournament");
        var expected = Payload();
        Assert.Equal(expected.Title, tournament.GetProperty("title").GetString());
        Assert.Equal(expected.Summary, tournament.GetProperty("summary").GetString());
        Assert.Equal(expected.StreetAddress, tournament.GetProperty("streetAddress").GetString());
        Assert.Equal(expected.PostalCode, tournament.GetProperty("postalCode").GetString());
        Assert.Equal(expected.City, tournament.GetProperty("city").GetString());
        Assert.Equal(expected.Country, tournament.GetProperty("country").GetString());
        Assert.Equal(expected.TimeZoneId, tournament.GetProperty("timeZoneId").GetString());
        Assert.Equal(expected.StartsAtLocal, tournament.GetProperty("startsAtLocal").GetString());
        Assert.Equal(expected.EndsAtLocal, tournament.GetProperty("endsAtLocal").GetString());
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
        // "doubles" sorts before "legacy": the response must follow the same slug order publishing uses.
        Assert.Equal(
            new[] { extra.Name, seed.Legacy.Name },
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
    public async Task Get_by_token_rejects_an_expired_token()
    {
        var proposal = await SeedProposalAsync();
        clock.Advance(TournamentProposal.Lifetime + Duration.FromMinutes(1));

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

        using var detail = await Client.GetAsync($"/api/tournaments/{slug}");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        var published = await detail.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Summer Cup", published.GetProperty("title").GetString());

        // Ownership and audit reflect who proposed it, not who approved it.
        await using var database = CreateContext();
        var tournament = await database.ScheduledTournaments.AsNoTracking().SingleAsync();
        Assert.Equal(slug, tournament.Slug);
        Assert.Equal(seed.Submitter.Id, tournament.CreatedByUserId);
        Assert.Equal(seed.Alpha.Id, tournament.OrganizationId);
    }

    [Fact]
    public async Task Approve_marks_the_proposal_decided()
    {
        var proposal = await SeedProposalAsync();

        using var response = await Client.PostAsync(ReviewUrl(proposal.OrganizerToken) + "/approve", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var database = CreateContext();
        var stored = await database.TournamentProposals.AsNoTracking().SingleAsync();
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
        var tournamentId = await database.ScheduledTournaments.AsNoTracking().Select(item => item.Id).SingleAsync();
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

        using var all = await Client.GetAsync("/api/tournaments/all");
        var items = (await all.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());

        await using var database = CreateContext();
        Assert.Equal(1, await database.ScheduledTournaments.CountAsync());
        var stored = await database.TournamentProposals.AsNoTracking().SingleAsync();
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
        Assert.Equal(0, await stored.ScheduledTournaments.CountAsync());
        Assert.Equal(TournamentProposalStatus.Pending, (await stored.TournamentProposals.AsNoTracking().SingleAsync()).Status);
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
        Assert.Equal(0, await stored.ScheduledTournaments.CountAsync());
        Assert.Equal(TournamentProposalStatus.Pending, (await stored.TournamentProposals.AsNoTracking().SingleAsync()).Status);
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
        var held = (await blocker.TournamentProposals
            .FromSql($"SELECT * FROM tournament_proposals WHERE id = {proposal.Id} FOR UPDATE")
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
        var decided = await stored.TournamentProposals.AsNoTracking().SingleAsync();
        Assert.Equal(TournamentProposalStatus.Rejected, decided.Status);
        Assert.Equal(seed.Admin.Id, decided.DecidedByUserId);
        Assert.Equal(0, await stored.ScheduledTournaments.CountAsync());
        using var all = await Client.GetAsync("/api/tournaments/all");
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
        Assert.Equal(TournamentProposalStatus.Pending, (await database.TournamentProposals.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Reject_caps_the_reason_length()
    {
        var proposal = await SeedProposalAsync();

        using var oversized = await RejectAsync(proposal.OrganizerToken, new string('x', 2001));
        // The stored column is varchar(TournamentProposal.MaximumRejectionReasonLength): anything
        // above it must be refused by validation, never by an unhandled domain throw.
        using var aboveColumn = await RejectAsync(
            proposal.OrganizerToken,
            new string('y', TournamentProposal.MaximumRejectionReasonLength + 1));

        Assert.Equal(HttpStatusCode.BadRequest, oversized.StatusCode);
        Assert.Contains("reason", await oversized.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.BadRequest, aboveColumn.StatusCode);
        Assert.Contains("reason", await aboveColumn.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        await using var database = CreateContext();
        Assert.Equal(TournamentProposalStatus.Pending, (await database.TournamentProposals.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task Reject_marks_the_proposal_rejected()
    {
        var proposal = await SeedProposalAsync();

        using var response = await RejectAsync(proposal.OrganizerToken, Reason);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await using var database = CreateContext();
        var stored = await database.TournamentProposals.AsNoTracking().SingleAsync();
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
        Assert.DoesNotContain("{{", rendered.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("{{", rendered.HtmlBody, StringComparison.Ordinal);
        Assert.NotEmpty(rendered.Subject);
    }

    [Fact]
    public async Task Reject_publishes_nothing()
    {
        var proposal = await SeedProposalAsync();
        using var before = await Client.GetAsync("/api/tournaments/all");
        var beforeCount = (await before.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").GetArrayLength();

        using var response = await RejectAsync(proposal.OrganizerToken, Reason);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        using var after = await Client.GetAsync("/api/tournaments/all");
        var afterCount = (await after.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").GetArrayLength();

        output.WriteLine($"/api/tournaments/all items before={beforeCount} after={afterCount}");
        Assert.Equal(beforeCount, afterCount);
        await using var database = CreateContext();
        Assert.Equal(0, await database.ScheduledTournaments.CountAsync());
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
        var stored = await database.TournamentProposals.AsNoTracking().SingleAsync();
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

        // The rejection path names the operation in an audit row: it must name the route, never the
        // token that was presented.
        await using var database = CreateContext();
        var audits = await database.AuditRecords.AsNoTracking()
            .Where(record => record.Action.EndsWith("rate_limited"))
            .Select(record => record.Action)
            .ToListAsync();
        output.WriteLine($"rate-limit audit actions -> {string.Join(",", audits.Distinct(StringComparer.Ordinal))}");
        Assert.NotEmpty(audits);
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
        $"/api/tournament-proposals/by-token/{Uri.EscapeDataString(token)}";

    /// <summary>
    /// Seeds a pending proposal straight into the database with both recipients' plaintext tokens in
    /// hand. Going through <c>POST /api/tournament-proposals</c> would burn the shared IP rate-limit
    /// budget these tests need for the decision calls, and would never hand back a sibling token.
    /// </summary>
    private async Task<SeededProposal> SeedProposalAsync(TournamentFormat? extraFormat = null)
    {
        var organizerToken = NewToken();
        var adminToken = NewToken();
        var proposal = TournamentProposal.Create(
            seed.Submitter.Id,
            JsonSerializer.Serialize(Payload(extraFormat), PayloadJsonOptions),
            clock.GetCurrentInstant());
        proposal.AddRecipient(seed.Organizer.Id, Sha256Hex(organizerToken), clock.GetCurrentInstant());
        proposal.AddRecipient(seed.Admin.Id, Sha256Hex(adminToken), clock.GetCurrentInstant());

        await using var database = CreateContext();
        database.TournamentProposals.Add(proposal);
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

    private TournamentPayload Payload(TournamentFormat? extraFormat = null) => new(
        seed.Alpha.Id,
        "Summer Cup",
        "Featured",
        "<p>Welcome</p>",
        "12 Rue de la Paix",
        "75001",
        "Paris",
        "France",
        "Europe/Paris",
        "2035-03-04T10:00:00",
        "2035-03-04T18:00:00",
        64,
        extraFormat is null ? [seed.Legacy.Id] : [seed.Legacy.Id, extraFormat.Id]);

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options;
        return new GonesDbContext(options);
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);
    private const string Reason = "Venue is already booked that weekend.";

    /// <summary>Matches the options T16 stores the payload with, so the round trip is symmetric.</summary>
    private static readonly JsonSerializerOptions PayloadJsonOptions = new(JsonSerializerDefaults.Web);

    private sealed record SeededProposal(Guid Id, string OrganizerToken, string AdminToken);

    private sealed record SeedRows(
        Organization Alpha,
        ApplicationUser Submitter,
        UserProfile SubmitterProfile,
        ApplicationUser Organizer,
        ApplicationUser Admin,
        TournamentFormat Legacy);

    private sealed record TournamentPayload(
        Guid OrganizationId,
        string Title,
        string? Summary,
        string? BodyHtml,
        string StreetAddress,
        string? PostalCode,
        string City,
        string Country,
        string TimeZoneId,
        string StartsAtLocal,
        string? EndsAtLocal,
        int? Capacity,
        IReadOnlyList<Guid> FormatIds);

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Advance(Duration duration) => current += duration;
    }
}
