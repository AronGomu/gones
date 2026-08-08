using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Testcontainers.PostgreSql;

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
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
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
        await PromoteToAdminAsync(account.UserId);
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
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);
        var body = await registration.Content.ReadFromJsonAsync<JsonElement>();
        var userId = body.GetProperty("id").GetGuid();
        var token = await LoginAsync(email);
        return new TestAccount(userId, email, username, token);
    }

    private async Task PromoteToAdminAsync(Guid userId)
    {
        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.Id == userId);
        user.AssignGlobalRole(GlobalRoles.Admin);
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        await database.SaveChangesAsync();
    }

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
