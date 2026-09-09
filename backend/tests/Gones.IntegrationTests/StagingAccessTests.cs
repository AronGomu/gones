using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text;
using System.Security.Cryptography;
using Microsoft.AspNetCore.WebUtilities;
using Gones.Domain.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class StagingAccessTests : IAsyncLifetime
{
    private const string Owner = "owner@example.test";
    private const string Tester = "tester@example.test";
    private const string Other = "other@example.test";
    private const string Password = "valid-password-value";
    private readonly PostgreSqlTestContainer postgres = new();
    private readonly MutableClock clock = new(Instant.FromUnixTimeSeconds(SystemClock.Instance.GetCurrentInstant().ToUnixTimeSeconds() - 300));
    private readonly string directory = Path.Combine(Directory.GetCurrentDirectory(), ".tmp", $"staging-access-{Guid.NewGuid():N}");
    private WebApplicationFactory<Program>? factory;
    private HttpClient client = null!;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var db = Db()) await db.Database.MigrateAsync();
        Directory.CreateDirectory(directory);
        await ApplyAsync([Owner, Tester, Other]);
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
        foreach (var path in Directory.GetFiles(directory)) File.Delete(path);
        Directory.Delete(directory);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("duplicate")]
    [InlineData("fractional")]
    [InlineData("exponent")]
    [InlineData("overflow")]
    [InlineData("string")]
    [InlineData("before")]
    [InlineData("equal")]
    [InlineData("after")]
    public async Task Staging_signed_JWT_cutoff_requires_one_canonical_numeric_iat(string shape)
    {
        using var registration = await RegisterAsync(Tester, "Tester");
        await using var db = Db();
        var user = await db.Users.SingleAsync();
        var seconds = clock.GetCurrentInstant().ToUnixTimeSeconds();
        var iat = shape switch
        {
            "missing" => "",
            "duplicate" => $"\"iat\":{seconds},\"iat\":{seconds},",
            "fractional" => $"\"iat\":{seconds}.0,",
            "exponent" => $"\"iat\":{seconds}e0,",
            "overflow" => "\"iat\":9999999999999999999999999,",
            "string" => $"\"iat\":\"{seconds}\",",
            "before" => $"\"iat\":{seconds - 1},",
            "after" => $"\"iat\":{seconds + 1},",
            _ => $"\"iat\":{seconds},"
        };
        var payload = $"{{{iat}\"sub\":\"{user.Id:D}\",\"role\":\"User\",\"security_stamp\":\"{user.SecurityStamp}\",\"iss\":\"gones\",\"aud\":\"gones-api\",\"exp\":{seconds + 900}}}";
        var signed = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes("{\"alg\":\"HS256\",\"typ\":\"JWT\"}")) + "." + WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(payload));
        var token = signed + "." + WebEncoders.Base64UrlEncode(HMACSHA256.HashData(Encoding.UTF8.GetBytes("staging-fixture-signing-key-at-least-32-characters"), Encoding.UTF8.GetBytes(signed)));
        using var response = await SendAsync(HttpMethod.Get, "/api/users/me", token);
        Assert.Equal(shape is "equal" or "after" ? HttpStatusCode.OK : HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Staging_refresh_replacement_after_cutoff_does_not_renew_old_family()
    {
        using var registration = await RegisterAsync(Tester, "Tester");
        await using var db = Db();
        var user = await db.Users.SingleAsync();
        var oldFamily = RefreshSession.Create(user.Id, user.SecurityStamp!, "Fixture", clock.GetCurrentInstant() - Duration.FromSeconds(1));
        var plaintext = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var freshReplacement = RefreshToken.Create(oldFamily.Id, Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(plaintext))), clock.GetCurrentInstant() + Duration.FromSeconds(1));
        db.RefreshSessions.Add(oldFamily);
        db.RefreshTokens.Add(freshReplacement);
        await db.SaveChangesAsync();
        using var response = await SendAsync(HttpMethod.Post, "/api/auth/refresh", cookie: "gones_refresh=" + plaintext);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        db.ChangeTracker.Clear();
        Assert.Single(await db.RefreshTokens.ToListAsync());
        Assert.True((await db.RefreshTokens.SingleAsync()).IsActive);
    }

    [Fact]
    public async Task Staging_denied_registration_and_generic_actions_have_no_account_side_effects()
    {
        using var registration = await RegisterAsync("blocked@example.test", "Blocked");
        using var resend = await client.PostAsJsonAsync("/api/auth/resend-verification", new { email = "blocked@example.test" });
        using var forgot = await client.PostAsJsonAsync("/api/auth/forgot-password", new { email = "blocked@example.test" });
        Assert.Equal(HttpStatusCode.Accepted, registration.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, resend.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, forgot.StatusCode);
        await using var db = Db();
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Empty(await db.UserProfiles.ToListAsync());
        Assert.Empty(await db.AccountActionTokens.ToListAsync());
        Assert.Empty(await db.NotificationOutboxRecords.ToListAsync());
    }

    [Fact]
    public async Task Staging_applied_revocation_blocks_login_JWT_refresh_actions_then_reinvite_keeps_old_credentials_invalid()
    {
        using var registration = await RegisterAsync(Tester, "Tester");
        Assert.Equal(HttpStatusCode.Accepted, registration.StatusCode);
        var verification = await LatestTokenAsync(Tester);
        using var forgot = await client.PostAsJsonAsync("/api/auth/forgot-password", new { email = Tester });
        var reset = await LatestTokenAsync(Tester);
        var session = await LoginAsync(Tester);
        clock.Advance(Duration.FromSeconds(2));
        using var rotated = await SendAsync(HttpMethod.Post, "/api/auth/refresh", cookie: session.Cookie);
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        var rotatedCookie = Cookie(rotated, "gones_refresh");
        await ApplyAsync([Owner]);
        using var login = await client.PostAsJsonAsync("/api/auth/login", new { email = Tester, password = Password });
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        await AssertOldCredentialsDeniedAsync(session.Token, rotatedCookie, verification, reset);
        await using (var db = Db())
        {
            Assert.Single(await db.Users.ToListAsync());
            Assert.Single(await db.RefreshSessions.ToListAsync());
            Assert.Equal(2, await db.RefreshTokens.CountAsync());
            Assert.All(await db.AccountActionTokens.ToListAsync(), token => Assert.Null(token.ConsumedAt));
        }
        await ApplyAsync([Owner, Tester]);
        await AssertOldCredentialsDeniedAsync(session.Token, rotatedCookie, verification, reset);
        var fresh = await LoginAsync(Tester);
        using var me = await SendAsync(HttpMethod.Get, "/api/users/me", fresh.Token);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task Staging_email_change_requires_both_addresses_and_old_change_does_not_block_fresh_resend()
    {
        using var registration = await RegisterAsync(Tester, "Tester");
        var verify = await LatestTokenAsync(Tester);
        using var verified = await client.PostAsJsonAsync("/api/auth/verify-email", new { token = verify });
        Assert.Equal(HttpStatusCode.NoContent, verified.StatusCode);
        var session = await LoginAsync(Tester);
        using var blocked = await SendAsync(HttpMethod.Post, "/api/users/me/email-change", session.Token,
            body: new { newEmail = "blocked@example.test", currentPassword = Password });
        Assert.Equal(HttpStatusCode.BadRequest, blocked.StatusCode);
        await using (var db = Db())
        {
            Assert.True((await db.Users.SingleAsync()).EmailConfirmed);
            Assert.Empty(await db.UserEmailHistories.ToListAsync());
            Assert.Single(await db.AccountActionTokens.ToListAsync());
        }
        using var change = await SendAsync(HttpMethod.Post, "/api/users/me/email-change", session.Token,
            body: new { newEmail = Other, currentPassword = Password });
        Assert.Equal(HttpStatusCode.Accepted, change.StatusCode);
        var oldChange = await LatestTokenAsync(Other);
        var before = await OutboxCountAsync();
        using var suppressed = await client.PostAsJsonAsync("/api/auth/resend-verification", new { email = Tester });
        Assert.Equal(before, await OutboxCountAsync());
        await ApplyAsync([Owner, Tester, Other]);
        using var old = await client.PostAsJsonAsync("/api/auth/confirm-email-change", new { token = oldChange });
        Assert.Equal(HttpStatusCode.BadRequest, old.StatusCode);
        using var resend = await client.PostAsJsonAsync("/api/auth/resend-verification", new { email = Tester });
        Assert.Equal(before + 1, await OutboxCountAsync());
        var freshVerify = await LatestTokenAsync(Tester);
        using var confirmed = await client.PostAsJsonAsync("/api/auth/verify-email", new { token = freshVerify });
        Assert.Equal(HttpStatusCode.NoContent, confirmed.StatusCode);
        var fresh = await LoginAsync(Tester);
        using var freshChange = await SendAsync(HttpMethod.Post, "/api/users/me/email-change", fresh.Token,
            body: new { newEmail = Other, currentPassword = Password });
        using var completed = await client.PostAsJsonAsync("/api/auth/confirm-email-change", new { token = await LatestTokenAsync(Other) });
        Assert.Equal(HttpStatusCode.NoContent, completed.StatusCode);
        using var stillSignedIn = await SendAsync(HttpMethod.Get, "/api/users/me", fresh.Token);
        Assert.Equal(HttpStatusCode.OK, stillSignedIn.StatusCode);
    }

    [Theory]
    [InlineData("complete")]
    [InlineData("incomplete")]
    public async Task Staging_OAuth_uninvited_profile_cannot_create_user_session_or_link(string scenario)
    {
        var flow = await StartAsync(scenario, "subject-blocked", "blocked@example.test");
        using var response = await SendAsync(HttpMethod.Get, flow.Path, cookie: flow.Cookie);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await using var db = Db();
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Empty(await db.ExternalIdentities.ToListAsync());
        Assert.Empty(await db.RefreshSessions.ToListAsync());
    }

    [Fact]
    public async Task Staging_OAuth_completion_and_verification_preserve_original_attempt_cutoff()
    {
        var flow = await StartAsync("incomplete", "subject-incomplete", Tester);
        using var response = await SendAsync(HttpMethod.Get, flow.Path, cookie: flow.Cookie);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var ticket = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("completionTicket").GetString();
        using var denied = await CompleteAsync(ticket!, "blocked@example.test");
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        using var complete = await CompleteAsync(ticket!, Other);
        Assert.Equal(HttpStatusCode.Accepted, complete.StatusCode);
        var verification = await LatestTokenAsync(Other);
        await ApplyAsync([Owner, Tester, Other]);
        using var verify = await client.PostAsJsonAsync("/api/auth/oauth/verify-email", new { token = verification });
        Assert.Equal(HttpStatusCode.BadRequest, verify.StatusCode);
        using var oldCompletion = await CompleteAsync(ticket!, Other);
        Assert.Equal(HttpStatusCode.BadRequest, oldCompletion.StatusCode);
        await using var db = Db();
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Empty(await db.ExternalIdentities.ToListAsync());
    }

    [Fact]
    public async Task Staging_OAuth_pending_completion_before_cutoff_is_denied_without_mutation()
    {
        var flow = await StartAsync("incomplete", "subject-pending-completion", Tester);
        using var response = await SendAsync(HttpMethod.Get, flow.Path, cookie: flow.Cookie);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var ticket = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("completionTicket").GetString();
        Assert.False(string.IsNullOrWhiteSpace(ticket));
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(ticket!)));
        await using var db = Db();
        var pending = await db.OAuthAttempts.AsNoTracking().SingleAsync();
        Assert.Equal(OAuthAttemptStatus.AwaitingCompletion, pending.Status);
        Assert.NotNull(pending.CompletionHash);
        Assert.Equal(hash, pending.CompletionHash);
        Assert.True(pending.CanComplete(hash, clock.GetCurrentInstant()));
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Empty(await db.ExternalIdentities.ToListAsync());
        Assert.Empty(await db.RefreshSessions.ToListAsync());
        Assert.Empty(await db.NotificationOutboxRecords.ToListAsync());

        await ApplyAsync([Owner, Tester, Other]);
        var current = await db.OAuthAttempts.AsNoTracking().SingleAsync();
        Assert.True(current.CreatedAt < clock.GetCurrentInstant());
        Assert.Equal(OAuthAttemptStatus.AwaitingCompletion, current.Status);
        Assert.NotNull(current.CompletionHash);
        Assert.Equal(hash, current.CompletionHash);
        Assert.True(current.ExpiresAt > clock.GetCurrentInstant());
        Assert.True(current.CanComplete(hash, clock.GetCurrentInstant()));
        using var denied = await CompleteAsync(ticket!, Tester);
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        Assert.Equal("invalid_oauth_ticket", (await denied.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.False(denied.Headers.Contains("Set-Cookie"));
        var unchanged = await db.OAuthAttempts.AsNoTracking().SingleAsync();
        Assert.Equal(OAuthAttemptStatus.AwaitingCompletion, unchanged.Status);
        Assert.Equal(pending.CompletionHash, unchanged.CompletionHash);
        Assert.Equal(pending.CreatedAt, unchanged.CreatedAt);
        Assert.Equal(pending.ExpiresAt, unchanged.ExpiresAt);
        Assert.Null(unchanged.ConsumedAt);
        Assert.Null(unchanged.EmailVerificationHash);
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Empty(await db.UserProfiles.ToListAsync());
        Assert.Empty(await db.ExternalIdentities.ToListAsync());
        Assert.Empty(await db.RefreshSessions.ToListAsync());
        Assert.Empty(await db.RefreshTokens.ToListAsync());
        Assert.Empty(await db.NotificationOutboxRecords.ToListAsync());

        var fresh = await StartAsync("incomplete", "subject-fresh-completion", Tester);
        using var callback = await SendAsync(HttpMethod.Get, fresh.Path, cookie: fresh.Cookie);
        Assert.Equal(HttpStatusCode.OK, callback.StatusCode);
        var freshTicket = (await callback.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("completionTicket").GetString();
        using var completed = await CompleteAsync(freshTicket!, Tester);
        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
        Assert.Equal(Tester, (await db.Users.SingleAsync()).Email);
        Assert.Equal("subject-fresh-completion", (await db.ExternalIdentities.SingleAsync()).ProviderSubject);
        Assert.Single(await db.RefreshSessions.ToListAsync());
        Assert.Single(await db.RefreshTokens.ToListAsync());
        Assert.Empty(await db.NotificationOutboxRecords.ToListAsync());
    }

    [Fact]
    public async Task Staging_OAuth_existing_identity_uses_stored_email_not_provider_alias()
    {
        var flow = await StartAsync("complete", "same-subject", Tester);
        using var created = await SendAsync(HttpMethod.Get, flow.Path, cookie: flow.Cookie);
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var changed = await StartAsync("complete", "same-subject", "blocked@example.test");
        using var existing = await SendAsync(HttpMethod.Get, changed.Path, cookie: changed.Cookie);
        Assert.Equal(HttpStatusCode.OK, existing.StatusCode);
        await ApplyAsync([Owner]);
        var revoked = await StartAsync("complete", "same-subject", Owner);
        using var denied = await SendAsync(HttpMethod.Get, revoked.Path, cookie: revoked.Cookie);
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        await using var db = Db();
        Assert.Equal(Tester, (await db.Users.SingleAsync()).Email);
        Assert.Equal("blocked@example.test", (await db.ExternalIdentities.SingleAsync()).ProviderEmail);
        Assert.Equal(2, await db.RefreshSessions.CountAsync());
    }

    [Fact]
    public async Task Staging_OAuth_old_callback_and_link_state_cannot_mutate_after_cutover()
    {
        using var registration = await RegisterAsync(Tester, "Tester");
        var session = await LoginAsync(Tester);
        var pending = await StartAsync("complete", "new-subject", Other);
        var link = await StartAsync("complete", "link-subject", "blocked@example.test", session.Token);
        await ApplyAsync([Owner, Tester, Other]);
        using var staleCallback = await SendAsync(HttpMethod.Get, pending.Path, cookie: pending.Cookie);
        using var staleLink = await SendAsync(HttpMethod.Get, link.Path, cookie: link.Cookie);
        Assert.Equal(HttpStatusCode.BadRequest, staleCallback.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, staleLink.StatusCode);
        await using var db = Db();
        Assert.Single(await db.Users.ToListAsync());
        Assert.Empty(await db.ExternalIdentities.ToListAsync());
        Assert.All(await db.OAuthAttempts.ToListAsync(), attempt => Assert.Equal(OAuthAttemptStatus.AwaitingCallback, attempt.Status));
    }

    private async Task AssertOldCredentialsDeniedAsync(string jwt, string refresh, string verification, string reset)
    {
        using var me = await SendAsync(HttpMethod.Get, "/api/users/me", jwt);
        using var rotation = await SendAsync(HttpMethod.Post, "/api/auth/refresh", cookie: refresh);
        using var verify = await client.PostAsJsonAsync("/api/auth/verify-email", new { token = verification });
        using var password = await client.PostAsJsonAsync("/api/auth/reset-password", new { token = reset, password = Password });
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, rotation.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, verify.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, password.StatusCode);
        if (rotation.Headers.TryGetValues("Set-Cookie", out var cookies))
            Assert.All(cookies, value => Assert.StartsWith("gones_refresh=;", value, StringComparison.Ordinal));
    }

    private async Task ApplyAsync(string[] invited)
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        clock.Advance(Duration.FromSeconds(2));
        var path = Path.Combine(directory, $"{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(new
        {
            revision = Guid.NewGuid().ToString("N"), validAfterUtc = clock.GetCurrentInstant().ToString(),
            invitedEmails = invited, recipientEmails = invited
        }));
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DEPLOYMENT_ENVIRONMENT", "staging");
            builder.UseSetting("GONES_STAGING_POLICY_FILE", path);
            builder.UseSetting("GONES_BOOTSTRAP_ADMIN_EMAIL", Owner);
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Fake");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "staging-fixture-signing-key-at-least-32-characters");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("GONES_OAUTH_CALLBACK_ORIGIN", "https://oauth.example");
            builder.UseSetting("GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT", "1000");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(clock);
            });
        });
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = false });
    }

    private Task<HttpResponseMessage> RegisterAsync(string email, string username) => client.PostAsJsonAsync("/api/auth/register", new
    {
        email, username, password = Password, firstName = "Test", lastName = "Account"
    });
    private Task<HttpResponseMessage> CompleteAsync(string ticket, string email) => client.PostAsJsonAsync("/api/auth/oauth/complete", new
    {
        completionTicket = ticket, email, username = "Completion", firstName = "Test", lastName = "Account"
    });
    private async Task<(string Token, string Cookie)> LoginAsync(string email)
    {
        using var response = await client.PostAsJsonAsync("/api/auth/login", new { email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return ((await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!, Cookie(response, "gones_refresh"));
    }
    private async Task<(string Path, string Cookie)> StartAsync(string scenario, string subject, string email, string? jwt = null)
    {
        using var request = new HttpRequestMessage(jwt is null ? HttpMethod.Get : HttpMethod.Post,
            jwt is null ? "/api/auth/oauth/google/start" : "/api/users/me/external-identities/google/start");
        request.Headers.Add("X-Gones-Fake-OAuth-Scenario", scenario);
        request.Headers.Add("X-Gones-Fake-OAuth-Subject", subject);
        request.Headers.Add("X-Gones-Fake-OAuth-Email", email);
        if (jwt is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwt);
        using var start = await client.SendAsync(request);
        Assert.Equal(jwt is null ? HttpStatusCode.Redirect : HttpStatusCode.OK, start.StatusCode);
        var uri = jwt is null ? start.Headers.Location! : new Uri((await start.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("authorizationUrl").GetString()!);
        using var authorize = await client.GetAsync(uri.PathAndQuery);
        Assert.Equal(HttpStatusCode.Redirect, authorize.StatusCode);
        return (authorize.Headers.Location!.PathAndQuery, Cookie(start, "gones_oauth_correlation"));
    }
    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, string? jwt = null, string? cookie = null, object? body = null)
    {
        using var request = new HttpRequestMessage(method, path);
        if (jwt is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwt);
        if (cookie is not null) request.Headers.Add("Cookie", cookie);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await client.SendAsync(request);
    }
    private static string Cookie(HttpResponseMessage response, string name) => response.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith(name + "=", StringComparison.Ordinal)).Split(';', 2)[0];
    private async Task<string> LatestTokenAsync(string email)
    {
        await using var db = Db();
        clock.Advance(Duration.FromSeconds(1));
        var model = await db.NotificationOutboxRecords.Where(row => row.Recipient == email).OrderByDescending(row => row.CreatedAt).Select(row => row.TemplateModelJson).FirstAsync();
        using var latest = JsonDocument.Parse(model!);
        return System.Web.HttpUtility.ParseQueryString(new Uri(latest.RootElement.GetProperty("actionUrl").GetString()!).Query)["token"]!;
    }
    private async Task<int> OutboxCountAsync() { await using var db = Db(); return await db.NotificationOutboxRecords.CountAsync(); }
    private GonesDbContext Db() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);
    private sealed class MutableClock(Instant now) : IClock
    {
        public Instant GetCurrentInstant() => now;
        public void Advance(Duration duration) => now += duration;
    }
}
