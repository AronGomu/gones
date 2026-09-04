using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// Covers <c>DELETE /api/users/me</c>: the hard account deletion described in
/// <c>docs/adr/0025-hard-account-deletion.md</c>. The endpoint is destructive by design, so every
/// case here builds and deletes its own throwaway account inside a disposable Postgres container.
/// </summary>
public sealed class AccountDeletionTests : IAsyncLifetime
{
    private const string SigningKey = "t6-account-deletion-integration-signing-key-32chars";
    private const string Password = "valid-password-value";
    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext()) await database.Database.MigrateAsync();
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", SigningKey);
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT", "1000");
        });
        client = factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Delete_me_requires_authentication()
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/users/me")
        {
            Content = JsonContent.Create(new { currentPassword = Password })
        };

        using var response = await Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Delete_me_rejects_a_wrong_password()
    {
        var account = await CreateAccountAsync("wrong-password");

        using var response = await DeleteAccountAsync(account.AccessToken, new { currentPassword = "not-the-right-password" });
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

        // A wrong password must never surface as 401: the endpoint would otherwise tell an attacker
        // apart "bad password" from "not signed in".
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(NamesCurrentPassword(problem), $"Problem did not name currentPassword: {problem}");
        await using var database = CreateContext();
        Assert.True(await database.Users.AnyAsync(item => item.Id == account.UserId));
    }

    [Fact]
    public async Task Delete_me_rejects_an_empty_password()
    {
        var account = await CreateAccountAsync("empty-password");

        using var response = await DeleteAccountAsync(account.AccessToken, new { currentPassword = string.Empty });
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(NamesCurrentPassword(problem), $"Problem did not name currentPassword: {problem}");
        await using var database = CreateContext();
        Assert.True(await database.Users.AnyAsync(item => item.Id == account.UserId));
    }

    [Fact]
    public async Task Delete_me_removes_the_account()
    {
        var account = await CreateAccountAsync("removed");

        using var response = await DeleteAccountAsync(account.AccessToken, new { currentPassword = Password });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        using var afterwards = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me", account.AccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, afterwards.StatusCode);
        await using var database = CreateContext();
        Assert.Equal(0, await database.UserProfiles.CountAsync(item => item.UserId == account.UserId));
        Assert.False(await database.Users.AnyAsync(item => item.Id == account.UserId));
        Assert.Equal(0, await database.RefreshSessions.CountAsync(item => item.UserId == account.UserId));
        Assert.Equal(0, await database.AccountActionTokens.CountAsync(item => item.UserId == account.UserId));
        Assert.Equal(0, await database.ExternalIdentities.CountAsync(item => item.UserId == account.UserId));
    }

    [Fact]
    public async Task Delete_me_clears_the_refresh_cookie()
    {
        var account = await CreateAccountAsync("cookie");

        using var response = await DeleteAccountAsync(account.AccessToken, new { currentPassword = Password });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var setCookie = response.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("gones_refresh=", StringComparison.Ordinal));
        Assert.StartsWith("gones_refresh=;", setCookie, StringComparison.Ordinal);
        Assert.Contains("expires=", setCookie, StringComparison.OrdinalIgnoreCase);
        var expiry = ParseCookieExpiry(setCookie);
        Assert.True(expiry < DateTimeOffset.UtcNow, $"Refresh cookie expiry is not in the past: {setCookie}");
    }

    [Fact]
    public async Task Delete_me_nulls_the_audit_actor()
    {
        var account = await CreateAccountAsync("audit");
        using var patch = await SendAuthorizedAsync(HttpMethod.Patch, "/api/users/me", account.AccessToken, new
        {
            username = account.Username,
            firstName = "Alice",
            lastName = "Martin",
            locationCountry = (string?)null,
            locationRegion = (string?)null,
            locationCity = "Lyon",
            birthDate = (string?)null,
            preferredLanguage = "fr",
            isFirstNamePublic = false,
            isLastNamePublic = false,
            isLocationPublic = false,
            isBirthDatePublic = false,
            isPreferredLanguagePublic = false,
            currentPassword = (string?)null
        });
        Assert.Equal(HttpStatusCode.OK, patch.StatusCode);

        var entityId = account.UserId.ToString("D");
        await using (var before = CreateContext())
        {
            Assert.True(await before.AuditRecords.AnyAsync(item => item.Action == "profile.changed" && item.ActorId == account.UserId));
        }

        using var response = await DeleteAccountAsync(account.AccessToken, new { currentPassword = Password });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await using var database = CreateContext();
        var history = await database.AuditRecords.AsNoTracking()
            .Where(item => item.EntityType == "user" && item.EntityId == entityId)
            .ToListAsync();
        Assert.Contains(history, item => item.Action == "profile.changed");
        Assert.All(history, item => Assert.Null(item.ActorId));
        Assert.Equal(0, await database.AuditRecords.CountAsync(item => item.ActorId == account.UserId));
        var deleted = Assert.Single(history, item => item.Action == "account.deleted");
        Assert.Null(deleted.ActorId);
        Assert.Equal(entityId, deleted.EntityId);
    }

    [Fact]
    public async Task Delete_me_refuses_the_last_admin()
    {
        var account = await CreateAccountAsync("last-admin");
        await PromoteAsync(account.UserId, GlobalRoles.Admin);
        var adminToken = await LoginAsync(account.Email);
        await using (var database = CreateContext())
        {
            Assert.Equal(1, await database.Users.CountAsync(item => item.GlobalRole == GlobalRoles.Admin));
        }

        using var response = await DeleteAccountAsync(adminToken, new { currentPassword = Password });
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("lastAdmin", problem.GetProperty("code").GetString());
        await using var afterwards = CreateContext();
        Assert.True(await afterwards.Users.AnyAsync(item => item.Id == account.UserId));
        Assert.Equal(1, await afterwards.UserProfiles.CountAsync(item => item.UserId == account.UserId));
    }

    /// <summary>
    /// Organizer-side columns still reference <c>asp_net_users</c> with <c>DeleteBehavior.Restrict</c>.
    /// The endpoint has to refuse before it touches anything, rather than let the raw foreign-key
    /// violation surface as a 500.
    /// </summary>
    [Fact]
    public async Task Delete_is_refused_when_the_account_created_a_tournament()
    {
        var organizer = await CreateOrganizerAsync("owns-tournament");
        await using (var seed = CreateContext()) await SeedTournamentAsync(seed, organizer.UserId);

        using var response = await DeleteAccountAsync(organizer.AccessToken, new { currentPassword = Password });
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("account_owns_records", problem.GetProperty("code").GetString());
        Assert.Contains("scheduled_tournaments.created_by_user_id", Relations(problem));
        await using var afterwards = CreateContext();
        Assert.True(await afterwards.Users.AnyAsync(item => item.Id == organizer.UserId));
        Assert.Equal(1, await afterwards.UserProfiles.CountAsync(item => item.UserId == organizer.UserId));
    }

    [Fact]
    public async Task Delete_is_refused_when_the_account_changed_a_registration_status()
    {
        var organizer = await CreateOrganizerAsync("changed-status");
        var owner = await CreateAccountAsync("tournament-owner");
        var participant = await CreateAccountAsync("participant");
        await using (var seed = CreateContext())
        {
            var tournament = await SeedTournamentAsync(seed, owner.UserId);
            var attempt = EventRegistrationAttempt.Register(tournament.Id, participant.UserId, participant.UserId, SeedNow);
            attempt.RemoveByOrganizer(organizer.UserId, SeedNow);
            seed.EventRegistrationAttempts.Add(attempt);
            await seed.SaveChangesAsync();
        }

        using var response = await DeleteAccountAsync(organizer.AccessToken, new { currentPassword = Password });
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("account_owns_records", problem.GetProperty("code").GetString());
        Assert.Contains("tournament_registration_attempts.status_changed_by_user_id", Relations(problem));
        // The organizer neither created the tournament nor filed the attempt, so nothing else may be named.
        Assert.DoesNotContain("scheduled_tournaments.created_by_user_id", Relations(problem));
        Assert.DoesNotContain("tournament_registration_attempts.registered_by_user_id", Relations(problem));
        await using var afterwards = CreateContext();
        Assert.True(await afterwards.Users.AnyAsync(item => item.Id == organizer.UserId));
    }

    [Fact]
    public async Task Delete_is_refused_when_the_account_blocked_a_member()
    {
        // The last-admin guard runs before the ownership pre-flight, so reaching the pre-flight at all
        // needs a second administrator. Both are demoted at the end so this test leaves the global
        // admin count exactly as it found it, whichever order xUnit picked.
        var admin = await CreateAccountAsync("blocking-admin");
        var second = await CreateAccountAsync("standby-admin");
        var member = await CreateAccountAsync("blocked-member");
        await PromoteAsync(admin.UserId, GlobalRoles.Admin);
        await PromoteAsync(second.UserId, GlobalRoles.Admin);
        var adminToken = await LoginAsync(admin.Email);
        await using (var seed = CreateContext())
        {
            var organizationId = await SeedOrganizationAsync(seed);
            seed.OrganizationBlockedUsers.Add(
                OrganizationBlockedUser.Block(organizationId, member.UserId, "Repeated no-show", admin.UserId, SeedNow));
            await seed.SaveChangesAsync();
        }

        try
        {
            using var response = await DeleteAccountAsync(adminToken, new { currentPassword = Password });
            var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
            Assert.Equal("account_owns_records", problem.GetProperty("code").GetString());
            Assert.Contains("organization_blocked_users.blocked_by_user_id", Relations(problem));
            await using var afterwards = CreateContext();
            Assert.True(await afterwards.Users.AnyAsync(item => item.Id == admin.UserId));
            Assert.Equal(1, await afterwards.UserProfiles.CountAsync(item => item.UserId == admin.UserId));
        }
        finally
        {
            await PromoteAsync(admin.UserId, GlobalRoles.User);
            await PromoteAsync(second.UserId, GlobalRoles.User);
        }
    }

    /// <summary>
    /// A refusal must cost the caller nothing: the deletion is abandoned before any session is revoked
    /// and before the refresh cookie is cleared.
    /// </summary>
    [Fact]
    public async Task Refused_deletion_leaves_the_session_usable()
    {
        var organizer = await CreateOrganizerAsync("session-intact");
        await using (var seed = CreateContext()) await SeedTournamentAsync(seed, organizer.UserId);

        using var response = await DeleteAccountAsync(organizer.AccessToken, new { currentPassword = Password });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.False(
            response.Headers.TryGetValues("Set-Cookie", out var cookies)
            && cookies.Any(value => value.StartsWith("gones_refresh=;", StringComparison.Ordinal)),
            "Refused deletion cleared the refresh cookie.");
        using var afterwards = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me", organizer.AccessToken);
        Assert.Equal(HttpStatusCode.OK, afterwards.StatusCode);
        await using var database = CreateContext();
        // RevokeAllAsync sits after the pre-flight, so every session the organizer had is still live.
        Assert.Equal(0, await database.RefreshSessions.CountAsync(item => item.UserId == organizer.UserId && item.RevokedAt != null));
        Assert.NotEqual(0, await database.RefreshSessions.CountAsync(item => item.UserId == organizer.UserId && item.RevokedAt == null));
    }

    /// <summary>
    /// Ownership is privileged information. Someone who cannot produce the password must not learn
    /// whether the account holds organizer records.
    /// </summary>
    [Fact]
    public async Task Wrong_password_is_rejected_before_the_ownership_check()
    {
        var organizer = await CreateOrganizerAsync("password-first");
        await using (var seed = CreateContext()) await SeedTournamentAsync(seed, organizer.UserId);

        using var response = await DeleteAccountAsync(organizer.AccessToken, new { currentPassword = "not-the-right-password" });
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(NamesCurrentPassword(problem), $"Problem did not name currentPassword: {problem}");
        Assert.Empty(Relations(problem));
        await using var afterwards = CreateContext();
        Assert.True(await afterwards.Users.AnyAsync(item => item.Id == organizer.UserId));
    }

    /// <summary>
    /// The rows a participant owns still go with the account. Registering yourself sets
    /// <c>registered_by_user_id</c> to your own id, and that must not read as a blocking relation.
    /// </summary>
    [Fact]
    public async Task Plain_user_deletion_still_succeeds()
    {
        var account = await CreateAccountAsync("plain-user");
        var owner = await CreateAccountAsync("plain-user-host");
        await using (var seed = CreateContext())
        {
            var tournament = await SeedTournamentAsync(seed, owner.UserId);
            seed.EventRegistrationAttempts.Add(
                EventRegistrationAttempt.Register(tournament.Id, account.UserId, account.UserId, SeedNow));
            await seed.SaveChangesAsync();
        }

        using var response = await DeleteAccountAsync(account.AccessToken, new { currentPassword = Password });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await using var afterwards = CreateContext();
        Assert.False(await afterwards.Users.AnyAsync(item => item.Id == account.UserId));
        Assert.Equal(0, await afterwards.EventRegistrationAttempts.CountAsync(item => item.UserId == account.UserId));
    }

    /// <summary>
    /// The append-only guard on <c>audit_records</c> was narrowed so a hard deletion can drop the
    /// actor reference. Nothing else about the table may have become writable.
    /// </summary>
    [Fact]
    public async Task Audit_records_stay_append_only_apart_from_the_actor_reference()
    {
        var account = await CreateAccountAsync("guard");
        await using var database = CreateContext();
        var entityId = account.UserId.ToString("D");

        var contentChange = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => database.Database.ExecuteSqlRawAsync(
            "UPDATE audit_records SET action = 'tampered' WHERE entity_id = {0}", entityId));
        var actorSwap = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => database.Database.ExecuteSqlRawAsync(
            "UPDATE audit_records SET actor_id = NULL, action = 'tampered' WHERE entity_id = {0}", entityId));
        var removal = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => database.Database.ExecuteSqlRawAsync(
            "DELETE FROM audit_records WHERE entity_id = {0}", entityId));

        Assert.Equal("55000", contentChange.SqlState);
        Assert.Equal("55000", actorSwap.SqlState);
        Assert.Equal("55000", removal.SqlState);
        Assert.Equal(1, await database.Database.ExecuteSqlRawAsync(
            "UPDATE audit_records SET actor_id = NULL WHERE entity_id = {0} AND action = 'auth.register.succeeded'", entityId));
    }

    private static IReadOnlyList<string> Relations(JsonElement problem) =>
        problem.TryGetProperty("relations", out var relations) && relations.ValueKind == JsonValueKind.Array
            ? [.. relations.EnumerateArray().Select(item => item.GetString() ?? string.Empty)]
            : [];

    private static bool NamesCurrentPassword(JsonElement problem) =>
        problem.TryGetProperty("errors", out var errors)
        && errors.EnumerateObject().Any(property =>
            string.Equals(property.Name, "currentPassword", StringComparison.OrdinalIgnoreCase)
            && property.Value.GetArrayLength() > 0);

    private static DateTimeOffset ParseCookieExpiry(string setCookie)
    {
        var segment = setCookie.Split(';')
            .Select(part => part.Trim())
            .Single(part => part.StartsWith("expires=", StringComparison.OrdinalIgnoreCase));
        return DateTimeOffset.Parse(segment["expires=".Length..], System.Globalization.CultureInfo.InvariantCulture);
    }

    private async Task<TestAccount> CreateAccountAsync(string label)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"{label}-{suffix}@example.test";
        var username = $"D{suffix}"[..12];
        using var registration = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            username,
            password = Password,
            firstName = "Alice",
            lastName = "Martin"
        });
        Assert.Equal(HttpStatusCode.Accepted, registration.StatusCode);
        await using var database = CreateContext();
        var userId = (await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant())).Id;
        var token = await LoginAsync(email);
        return new TestAccount(userId, email, username, token);
    }

    /// <summary>
    /// A fresh registration is always a plain <c>User</c>. Organizer-side fixtures need the role
    /// assigned out of band, and the stamp rotation means the caller has to sign in again.
    /// </summary>
    private async Task<TestAccount> CreateOrganizerAsync(string label)
    {
        var account = await CreateAccountAsync(label);
        await PromoteAsync(account.UserId, GlobalRoles.Organizer);
        return account with { AccessToken = await LoginAsync(account.Email) };
    }

    private async Task PromoteAsync(Guid userId, string role)
    {
        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.Id == userId);
        user.AssignGlobalRole(role);
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        await database.SaveChangesAsync();
    }

    /// <summary>
    /// No HTTP path creates an organizer-owned row for an arbitrary throwaway account, so the
    /// blocking fixtures are seeded straight into the database.
    /// </summary>
    private static async Task<Guid> SeedOrganizationAsync(GonesDbContext database)
    {
        var organization = Organization.Create($"Club {Guid.NewGuid():N}", null, null, null, SeedNow);
        database.Organizations.Add(organization);
        await database.SaveChangesAsync();
        return organization.Id;
    }

    private static async Task<Event> SeedTournamentAsync(GonesDbContext database, Guid createdByUserId)
    {
        var organizationId = await SeedOrganizationAsync(database);
        var legacy = await database.TournamentFormats.SingleOrDefaultAsync(format => format.Slug == TournamentFormat.LegacySlug);
        if (legacy is null)
        {
            legacy = TournamentFormat.CreateLegacy(SeedNow);
            database.TournamentFormats.Add(legacy);
            await database.SaveChangesAsync();
        }

        var tournament = Event.Create(organizationId, createdByUserId, Draft(), [legacy], SeedNow);
        database.Events.Add(tournament);
        await database.SaveChangesAsync();
        return tournament;
    }

    private static ScheduledTournamentDraft Draft() => new(
        Title: "Legacy Cup",
        Slug: $"cup-{Guid.NewGuid():N}",
        Summary: "Prizes",
        BodyMarkdown: "Welcome",
        StreetAddress: "12 Rue de la Paix",
        PostalCode: "69001",
        City: "Lyon",
        Country: "France",
        Region: "Auvergne-Rhône-Alpes",
        TimeZoneId: "Europe/Paris",
        StartsAtLocal: new LocalDateTime(2026, 8, 2, 10, 0),
        EndsAtLocal: new LocalDateTime(2026, 8, 2, 18, 0),
        Capacity: 64);

    private static readonly Instant SeedNow = Instant.FromUtc(2026, 8, 1, 12, 0);

    private async Task<string> LoginAsync(string email)
    {
        using var response = await Client.PostAsJsonAsync("/api/auth/login", new { email, password = Password, deviceLabel = "t6-test" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("accessToken").GetString() ?? throw new InvalidOperationException("No access token returned.");
    }

    private Task<HttpResponseMessage> DeleteAccountAsync(string token, object body) =>
        SendAuthorizedAsync(HttpMethod.Delete, "/api/users/me", token, body);

    private async Task<HttpResponseMessage> SendAuthorizedAsync(HttpMethod method, string path, string token, object? body = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await Client.SendAsync(request);
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Test client is not initialized.");

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options;
        return new GonesDbContext(options);
    }

    private sealed record TestAccount(Guid UserId, string Email, string Username, string AccessToken);
}
