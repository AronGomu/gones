using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
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
using Testcontainers.PostgreSql;
using Xunit.Abstractions;

namespace Gones.IntegrationTests;

/// <summary>
/// T16. A verified non-organizer submits a tournament proposal; it is stored as JSON (never as a
/// draft tournament, so it cannot leak into the public calendar) and every chosen approver is mailed
/// a review link carrying its own single-use token. Only the SHA-256 hash of a token reaches the
/// database.
/// </summary>
public sealed class TournamentProposalTests(ITestOutputHelper output) : IAsyncLifetime
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
    public async Task Approvers_requires_authentication()
    {
        using var response = await Client.GetAsync("/api/tournament-proposals/approvers");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Approvers_lists_organizers_and_admins()
    {
        using var response = await SendAsync(HttpMethod.Get, "/api/tournament-proposals/approvers", seed.Submitter.Id, GlobalRoles.User);

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

    [Fact]
    public async Task Approvers_never_returns_emails()
    {
        using var response = await SendAsync(HttpMethod.Get, "/api/tournament-proposals/approvers", seed.Submitter.Id, GlobalRoles.User);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var raw = await response.Content.ReadAsStringAsync();
        output.WriteLine($"GET /api/tournament-proposals/approvers -> {raw}");
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
        Assert.Equal(0, await database.TournamentProposals.CountAsync());
    }

    [Fact]
    public async Task Submit_rejects_an_organizer()
    {
        using var organizer = await SubmitAsync(seed.Organizer.Id, GlobalRoles.Organizer, Payload(), [seed.Admin.Id]);
        using var admin = await SubmitAsync(seed.Admin.Id, GlobalRoles.Admin, Payload(), [seed.Organizer.Id]);

        Assert.Equal(HttpStatusCode.Forbidden, organizer.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, admin.StatusCode);
        await using var database = CreateContext();
        Assert.Equal(0, await database.TournamentProposals.CountAsync());
    }

    [Fact]
    public async Task Submit_requires_at_least_one_recipient()
    {
        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), []);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("recipientUserIds", body, StringComparison.OrdinalIgnoreCase);
        await using var database = CreateContext();
        Assert.Equal(0, await database.TournamentProposals.CountAsync());
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
        Assert.Equal(0, await database.TournamentProposals.CountAsync());
        Assert.Equal(0, await database.TournamentProposalRecipients.CountAsync());
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
        var proposal = await database.TournamentProposals.AsNoTracking().SingleAsync();
        Assert.Equal(proposalId, proposal.Id);
        Assert.Equal(TournamentProposalStatus.Pending, proposal.Status);
        Assert.Equal(seed.Submitter.Id, proposal.SubmittedByUserId);
        Assert.Null(proposal.DecidedAt);
        Assert.Null(proposal.DecidedByUserId);
        Assert.Contains("Summer Cup", proposal.PayloadJson, StringComparison.Ordinal);

        var recipients = await database.TournamentProposalRecipients.AsNoTracking()
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
        var hashes = await database.TournamentProposalRecipients.AsNoTracking()
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
            var inProposals = await CountRowsContainingAsync("tournament_proposals", token);
            var inRecipients = await CountRowsContainingAsync("tournament_proposal_recipients", token);
            output.WriteLine($"plaintext={token} len={token.Length} rows_holding_plaintext: tournament_proposals={inProposals} tournament_proposal_recipients={inRecipients}");
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
                         payload.StreetAddress,
                         payload.PostalCode!,
                         payload.City,
                         payload.Country,
                         payload.TimeZoneId,
                         payload.StartsAtLocal,
                         payload.EndsAtLocal!,
                         payload.Capacity!.Value.ToString(System.Globalization.CultureInfo.InvariantCulture),
                         seed.Legacy.Name,
                         seed.SubmitterProfile.Username
                     })
            {
                Assert.Contains(expected, rendered.TextBody, StringComparison.Ordinal);
            }

            Assert.DoesNotContain("{{", rendered.TextBody, StringComparison.Ordinal);
            Assert.DoesNotContain("{{", rendered.HtmlBody, StringComparison.Ordinal);
            Assert.Contains("/tournament-requests/", rendered.TextBody, StringComparison.Ordinal);
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
        var proposal = await database.TournamentProposals.AsNoTracking().SingleAsync();
        Assert.Equal(Now, proposal.CreatedAt);
        Assert.Equal(proposal.CreatedAt + Duration.FromDays(7), proposal.ExpiresAt);
    }

    [Fact]
    public async Task Submit_creates_no_public_tournament()
    {
        using var before = await Client.GetAsync("/api/tournaments/all");
        var beforeCount = (await before.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").GetArrayLength();

        using var response = await SubmitAsync(seed.Submitter.Id, GlobalRoles.User, Payload(), [seed.Organizer.Id]);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        using var after = await Client.GetAsync("/api/tournaments/all");
        var afterCount = (await after.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").GetArrayLength();

        Assert.Equal(beforeCount, afterCount);
        await using var database = CreateContext();
        Assert.Equal(0, await database.ScheduledTournaments.CountAsync());
        Assert.Equal(1, await database.TournamentProposals.CountAsync());
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
        SendAsync(HttpMethod.Post, "/api/tournament-proposals", userId, role, new { tournament = payload, recipientUserIds });

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
        var admin = User("Admin", GlobalRoles.Admin, emailConfirmed: true);
        var alpha = Organization.Create("Alpha Club", "Public alpha", "https://alpha.example", "alpha@example.test", Now);
        var legacy = await database.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug)
            ?? TournamentFormat.CreateLegacy(Now);
        database.Users.AddRange(submitter, unverified, bystander, organizer, admin);
        database.Organizations.Add(alpha);
        if (database.Entry(legacy).State == EntityState.Detached) database.TournamentFormats.Add(legacy);
        await database.SaveChangesAsync();

        var submitterProfile = Profile(submitter.Id, "submitter-anna", "fr");
        database.UserProfiles.AddRange(
            submitterProfile,
            Profile(unverified.Id, "unverified-ugo", "fr"),
            Profile(bystander.Id, "bystander-bea", "fr"),
            Profile(organizer.Id, "organizer-olga", "fr"),
            Profile(admin.Id, "admin-adam", "en"));
        database.OrganizationMembers.Add(OrganizationMember.Create(alpha.Id, organizer.Id, OrganizationRoles.Organizer, Now));
        await database.SaveChangesAsync();
        return new SeedRows(alpha, submitter, submitterProfile, unverified, bystander, organizer, admin, legacy);
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
        "<p>Welcome</p>",
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

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);

    private sealed record SeedRows(
        Organization Alpha,
        ApplicationUser Submitter,
        UserProfile SubmitterProfile,
        ApplicationUser Unverified,
        ApplicationUser Bystander,
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
