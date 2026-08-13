using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Gones.Api.Security;
using Gones.Domain.Identity;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class LocalIdentityApiTests : IAsyncLifetime
{
    private const string SigningKey = "c08-local-integration-signing-key-with-more-than-32-characters";
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
    public async Task Auth_routes_are_absent_when_feature_is_disabled()
    {
        await using var disabledFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing"));
        using var disabledClient = disabledFactory.CreateClient();

        using var response = await disabledClient.PostAsJsonAsync("/api/auth/login", new { email = "nobody@example.test", password = "not-a-real-password" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Register_defaults_profile_to_private_then_login_accesses_own_profile()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"private-{suffix}@example.test";
        using var register = await RegisterAsync(email, $"Player{suffix[..8]}", "valid-password-value");
        var registered = await register.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, register.StatusCode);
        Assert.Equal("fr", registered.GetProperty("preferredLanguage").GetString());
        Assert.False(registered.GetProperty("isFirstNamePublic").GetBoolean());
        Assert.False(registered.GetProperty("isLastNamePublic").GetBoolean());
        Assert.False(registered.GetProperty("isLocationPublic").GetBoolean());
        Assert.False(registered.GetProperty("isBirthDatePublic").GetBoolean());
        Assert.False(registered.GetProperty("isPreferredLanguagePublic").GetBoolean());

        using var unauthorized = await Client.GetAsync("/api/users/me");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

        var token = await LoginAsync(email, "valid-password-value");
        using var profile = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me", token);
        var body = await profile.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, profile.StatusCode);
        Assert.Equal(email, body.GetProperty("email").GetString());
        Assert.Equal("User", body.GetProperty("globalRole").GetString());
    }

    [Fact]
    public async Task Jwt_has_no_email_username_or_profile_claims()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"claims-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Claims{suffix[..8]}", "valid-password-value");
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);

        var token = await LoginAsync(email, "valid-password-value");
        using var payload = DecodeJwtPayload(token);
        var names = payload.RootElement.EnumerateObject().Select(property => property.Name).ToHashSet(StringComparer.Ordinal);

        Assert.Contains("sub", names);
        Assert.Contains("role", names);
        Assert.Contains("security_stamp", names);
        Assert.DoesNotContain("email", names);
        Assert.DoesNotContain("unique_name", names);
        Assert.DoesNotContain("username", names);
        Assert.Equal("User", payload.RootElement.GetProperty("role").GetString());
    }

    [Theory]
    [InlineData("too-short")]
    [InlineData("123456789012")]
    [InlineData("PASSWORDPASSWORD")]
    public async Task Registration_rejects_short_and_common_passwords(string password)
    {
        var suffix = Guid.NewGuid().ToString("N");
        using var response = await RegisterAsync($"password-{suffix}@example.test", $"Password{suffix[..8]}", password);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("validation_failed", await ProblemCodeAsync(response));
    }

    [Fact]
    public async Task Registration_rejects_password_over_128_but_has_no_composition_rule()
    {
        var suffix = Guid.NewGuid().ToString("N");
        using var tooLong = await RegisterAsync($"long-{suffix}@example.test", $"Long{suffix[..8]}", new string('x', 129));
        using var simple = await RegisterAsync($"simple-{suffix}@example.test", $"Simple{suffix[..8]}", "aaaaaaaaaaaa");

        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Equal(HttpStatusCode.Created, simple.StatusCode);
    }

    [Fact]
    public async Task Registration_accepts_33_character_username_and_rejects_65()
    {
        var suffix = Guid.NewGuid().ToString("N");
        using var accepted = await RegisterAsync($"username-accepted-{suffix}@example.test", new string('a', 33), "valid-password-value");
        using var rejected = await RegisterAsync($"username-rejected-{suffix}@example.test", new string('b', 65), "valid-password-value");

        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        Assert.Equal("validation_failed", await ProblemCodeAsync(rejected));
    }

    [Fact]
    public async Task Normalized_username_and_email_collisions_are_rejected()
    {
        var suffix = Guid.NewGuid().ToString("N");
        using var first = await RegisterAsync($"collision-{suffix}@example.test", $"Élodie{suffix[..5]}", "valid-password-value");
        using var usernameCollision = await RegisterAsync($"other-{suffix}@example.test", $"E\u0301LODIE{suffix[..5]}", "another-valid-password");
        using var emailCollision = await RegisterAsync($"COLLISION-{suffix}@EXAMPLE.TEST", $"Other{suffix[..8]}", "another-valid-password");

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, usernameCollision.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, emailCollision.StatusCode);
    }

    [Fact]
    public async Task Concurrent_duplicate_registration_creates_one_user_and_profile()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var username = $"Concurrent{suffix[..8]}";
        var requests = new[]
        {
            RegisterAsync($"concurrent-a-{suffix}@example.test", username, "valid-password-value"),
            RegisterAsync($"concurrent-b-{suffix}@example.test", username.ToUpperInvariant(), "another-valid-password")
        };
        using var first = await requests[0];
        using var second = await requests[1];

        Assert.Equal(1, new[] { first.StatusCode, second.StatusCode }.Count(status => status == HttpStatusCode.Created));
        Assert.Equal(1, new[] { first.StatusCode, second.StatusCode }.Count(status => status == HttpStatusCode.Conflict));
        await using var database = CreateContext();
        Assert.Equal(1, await database.UserProfiles.CountAsync(profile => profile.NormalizedUsername == username.ToUpperInvariant()));
    }

    [Fact]
    public async Task Five_failures_lock_account_for_15_minutes_and_failure_is_generic()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"lockout-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Lockout{suffix[..8]}", "valid-password-value");
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);

        string? firstFailure = null;
        for (var attempt = 0; attempt < 5; attempt++)
        {
            using var response = await Client.PostAsJsonAsync("/api/auth/login", new { email, password = "wrong-password-value" });
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            firstFailure ??= await StableProblemAsync(response);
            if (attempt > 0) Assert.Equal(firstFailure, await StableProblemAsync(response));
        }
        using var correctAfterLock = await Client.PostAsJsonAsync("/api/auth/login", new { email, password = "valid-password-value" });
        Assert.Equal(HttpStatusCode.Unauthorized, correctAfterLock.StatusCode);
        Assert.Equal(firstFailure, await StableProblemAsync(correctAfterLock));

        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant());
        Assert.Equal(0, user.AccessFailedCount);
        Assert.NotNull(user.LockoutEnd);
        Assert.InRange(user.LockoutEnd!.Value - DateTimeOffset.UtcNow, TimeSpan.FromMinutes(14), TimeSpan.FromMinutes(15.1));
    }

    [Fact]
    public async Task Account_rate_limit_is_independent_per_normalized_account()
    {
        using var limiter = new AuthAccountRateLimiter(5);
        for (var attempt = 0; attempt < 5; attempt++) Assert.True(await limiter.TryAcquireAsync("login", "Player@Example.test", CancellationToken.None));

        Assert.False(await limiter.TryAcquireAsync("login", "player@example.test", CancellationToken.None));
        Assert.True(await limiter.TryAcquireAsync("login", "other@example.test", CancellationToken.None));
    }

    [Fact]
    public async Task Login_is_limited_to_five_attempts_per_15_minutes()
    {
        await using var limitedFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", SigningKey);
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
        });
        using var limitedClient = limitedFactory.CreateClient();
        var email = $"limited-{Guid.NewGuid():N}@example.test";
        for (var attempt = 0; attempt < 5; attempt++)
        {
            using var accepted = await limitedClient.PostAsJsonAsync("/api/auth/login", new { email, password = "wrong-password-value" });
            Assert.Equal(HttpStatusCode.Unauthorized, accepted.StatusCode);
        }

        using var rejected = await limitedClient.PostAsJsonAsync("/api/auth/login", new { email, password = "wrong-password-value" });

        Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
        Assert.Equal("rate_limited", await ProblemCodeAsync(rejected));
        await using var database = CreateContext();
        Assert.True(await database.AuditRecords.AnyAsync(record => record.Action == "auth.login.rate_limited"));
    }

    [Fact]
    public async Task Unknown_and_wrong_password_logins_return_same_generic_failure()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"generic-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Generic{suffix[..8]}", "valid-password-value");
        using var unknown = await Client.PostAsJsonAsync("/api/auth/login", new { email = $"missing-{suffix}@example.test", password = "wrong-password-value" });
        using var wrong = await Client.PostAsJsonAsync("/api/auth/login", new { email, password = "wrong-password-value" });

        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.Equal(await StableProblemAsync(unknown), await StableProblemAsync(wrong));
    }

    [Fact]
    public async Task Username_change_requires_current_password_but_other_profile_changes_do_not()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"patch-{suffix}@example.test";
        var username = $"Patch{suffix[..8]}";
        using var registration = await RegisterAsync(email, username, "valid-password-value");
        var token = await LoginAsync(email, "valid-password-value");
        var ordinaryPatch = ProfilePatch(username, city: "Brussels", birthDate: "1990-04-17", currentPassword: null);
        using var ordinary = await SendAuthorizedAsync(HttpMethod.Patch, "/api/users/me", token, ordinaryPatch);
        var renamed = $"Renamed{suffix[..8]}";
        using var noPassword = await SendAuthorizedAsync(HttpMethod.Patch, "/api/users/me", token, ProfilePatch(renamed, null, null, null));
        using var wrongPassword = await SendAuthorizedAsync(HttpMethod.Patch, "/api/users/me", token, ProfilePatch(renamed, null, null, "wrong-password-value"));
        using var correctPassword = await SendAuthorizedAsync(HttpMethod.Patch, "/api/users/me", token, ProfilePatch(renamed, null, null, "valid-password-value"));

        Assert.Equal(HttpStatusCode.OK, ordinary.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, noPassword.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.OK, correctPassword.StatusCode);
        var body = await correctPassword.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(renamed, body.GetProperty("username").GetString());
    }

    [Fact]
    public async Task Patch_me_round_trips_the_new_shape()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"shape-{suffix}@example.test";
        var username = $"Shape{suffix[..8]}";
        using var registration = await RegisterAsync(email, username, "valid-password-value");
        var token = await LoginAsync(email, "valid-password-value");

        using var patched = await SendAuthorizedAsync(HttpMethod.Patch, "/api/users/me", token,
            ProfilePatch(username, "France", "Rhône", "Lyon", "1990-04-17", null));
        Assert.Equal(HttpStatusCode.OK, patched.StatusCode);
        var patchedBody = await patched.Content.ReadFromJsonAsync<JsonElement>();

        using var reloaded = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me", token);
        Assert.Equal(HttpStatusCode.OK, reloaded.StatusCode);
        var reloadedBody = await reloaded.Content.ReadFromJsonAsync<JsonElement>();

        foreach (var (name, expected) in new[]
        {
            ("locationCountry", "France"),
            ("locationRegion", "Rhône"),
            ("locationCity", "Lyon"),
            ("birthDate", "1990-04-17")
        })
        {
            Assert.Equal(expected, patchedBody.GetProperty(name).GetString());
            Assert.Equal(expected, reloadedBody.GetProperty(name).GetString());
        }

        Assert.False(reloadedBody.GetProperty("isBirthDatePublic").GetBoolean());
        Assert.False(reloadedBody.TryGetProperty("location", out _));
        Assert.False(reloadedBody.TryGetProperty("birthYear", out _));

        using var futureBirthDate = await SendAuthorizedAsync(HttpMethod.Patch, "/api/users/me", token,
            ProfilePatch(username, null, null, null, "2999-01-01", null));
        Assert.Equal(HttpStatusCode.BadRequest, futureBirthDate.StatusCode);
        Assert.Equal("validation_failed", await ProblemCodeAsync(futureBirthDate));
    }

    [Fact]
    public async Task Audit_diffs_and_metrics_path_do_not_persist_credentials_or_raw_pii()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"audit-{suffix}@example.test";
        var username = $"Audit{suffix[..8]}";
        const string password = "audit-password-value";
        using var registration = await RegisterAsync(email, username, password);
        var token = await LoginAsync(email, password);
        using var patch = await SendAuthorizedAsync(HttpMethod.Patch, "/api/users/me", token, ProfilePatch(username, "Secret Place", "1991-02-03", null));
        using var failed = await Client.PostAsJsonAsync("/api/auth/login", new { email, password = "wrong-password-value" });
        Assert.Equal(HttpStatusCode.Unauthorized, failed.StatusCode);

        await using var database = CreateContext();
        var auditText = string.Join('\n', await database.AuditRecords
            .Where(record => record.Action.StartsWith("auth.") || record.Action == "profile.changed")
            .Select(record => record.RedactedDiff)
            .ToListAsync());
        Assert.DoesNotContain(email, auditText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(username, auditText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(password, auditText, StringComparison.Ordinal);
        Assert.DoesNotContain("Secret Place", auditText, StringComparison.Ordinal);
        Assert.DoesNotContain("wrong-password-value", auditText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Login_issues_fifteen_minute_access_and_host_only_secure_refresh_cookie()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"session-cookie-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Cookie{suffix[..8]}", "valid-password-value");

        var login = await LoginWithSessionAsync(email, "valid-password-value", "Firefox on Linux");
        using var payload = DecodeJwtPayload(login.AccessToken);
        var issuedAt = payload.RootElement.GetProperty("iat").GetInt64();
        var expiresAt = payload.RootElement.GetProperty("exp").GetInt64();

        Assert.Equal(AccessTokenIssuer.Lifetime.TotalSeconds, expiresAt - issuedAt);
        Assert.Contains("secure", login.SetCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", login.SetCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", login.SetCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api/auth", login.SetCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("domain=", login.SetCookie, StringComparison.OrdinalIgnoreCase);

        await using var database = CreateContext();
        var session = await database.RefreshSessions.SingleAsync(item => item.UserId == login.UserId);
        var storedToken = await database.RefreshTokens.SingleAsync(item => item.SessionId == session.Id);
        var rawToken = login.Cookie[(login.Cookie.IndexOf('=') + 1)..];
        var expectedHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));
        Assert.Equal("Firefox on Linux", session.DeviceLabel);
        Assert.Equal(session.CreatedAt + Duration.FromDays(7), session.IdleExpiresAt);
        Assert.Equal(session.CreatedAt + Duration.FromDays(30), session.AbsoluteExpiresAt);
        Assert.Equal(expectedHash, storedToken.TokenHash);
        Assert.DoesNotContain(rawToken, storedToken.TokenHash, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Refresh_rotates_once_and_old_token_replay_revokes_family()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"rotation-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Rotate{suffix[..8]}", "valid-password-value");
        var login = await LoginWithSessionAsync(email, "valid-password-value", "Rotation test");

        using var rotated = await RefreshAsync(login.Cookie);
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        var replacementCookie = CookieFrom(rotated);
        Assert.NotEqual(login.Cookie, replacementCookie);

        using var replay = await RefreshAsync(login.Cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
        using var familyRejected = await RefreshAsync(replacementCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, familyRejected.StatusCode);

        await using var database = CreateContext();
        var session = await database.RefreshSessions.SingleAsync(item => item.UserId == login.UserId);
        var tokens = await database.RefreshTokens.Where(item => item.SessionId == session.Id).OrderBy(item => item.CreatedAt).ToListAsync();
        Assert.Equal(RefreshSessionRevocationReason.Replay, session.RevocationReason);
        Assert.Equal(2, tokens.Count);
        Assert.Equal(tokens[1].Id, tokens[0].ReplacedById);
        Assert.True(await database.AuditRecords.AnyAsync(item => item.Action == "auth.session.replay" && item.EntityId == session.Id.ToString("D")));
    }

    [Fact]
    public async Task Parallel_refresh_allows_one_rotation_then_replay_revokes_winning_family()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"parallel-refresh-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Parallel{suffix[..8]}", "valid-password-value");
        var login = await LoginWithSessionAsync(email, "valid-password-value", "Parallel test");

        var attempts = await Task.WhenAll(RefreshAsync(login.Cookie), RefreshAsync(login.Cookie));
        try
        {
            Assert.Equal(1, attempts.Count(item => item.StatusCode == HttpStatusCode.OK));
            Assert.Equal(1, attempts.Count(item => item.StatusCode == HttpStatusCode.Unauthorized));
            var winningCookie = CookieFrom(attempts.Single(item => item.StatusCode == HttpStatusCode.OK));
            using var rejected = await RefreshAsync(winningCookie);
            Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
        }
        finally
        {
            foreach (var attempt in attempts) attempt.Dispose();
        }
    }

    [Fact]
    public async Task Logout_clears_exact_cookie_and_revokes_current_family()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"logout-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Logout{suffix[..8]}", "valid-password-value");
        var login = await LoginWithSessionAsync(email, "valid-password-value", "Logout test");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        request.Headers.Add("Cookie", login.Cookie);

        using var logout = await Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        var cleared = logout.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("gones_refresh=", StringComparison.Ordinal));
        Assert.Contains("path=/api/auth", cleared, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", cleared, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", cleared, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cleared, StringComparison.OrdinalIgnoreCase);
        using var rejected = await RefreshAsync(login.Cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
    }

    [Fact]
    public async Task Logout_all_still_works()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"logout-all-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"All{suffix[..8]}", "valid-password-value");
        var first = await LoginWithSessionAsync(email, "valid-password-value", "Laptop");
        var second = await LoginWithSessionAsync(email, "valid-password-value", "Phone");

        using var logoutAll = await SendAuthorizedAsync(HttpMethod.Post, "/api/auth/logout-all", first.AccessToken);

        Assert.Equal(HttpStatusCode.NoContent, logoutAll.StatusCode);
        using var firstRejected = await RefreshAsync(first.Cookie);
        using var secondRejected = await RefreshAsync(second.Cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, firstRejected.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, secondRejected.StatusCode);
    }

    [Fact]
    public async Task Sessions_list_endpoint_is_gone()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"sessions-list-gone-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"ListGone{suffix[..6]}", "valid-password-value");
        var login = await LoginWithSessionAsync(email, "valid-password-value", "Sessions list");

        using var response = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me/sessions", login.AccessToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Sessions_revoke_endpoint_is_gone()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"sessions-revoke-gone-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"RevGone{suffix[..7]}", "valid-password-value");
        var login = await LoginWithSessionAsync(email, "valid-password-value", "Sessions revoke");
        await using var database = CreateContext();
        var sessionId = await database.RefreshSessions.Where(item => item.UserId == login.UserId).Select(item => item.Id).SingleAsync();

        using var response = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/users/me/sessions/{sessionId}", login.AccessToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        // The session itself is untouched: only the endpoint went, not the underlying revocation capability.
        using var stillUsable = await RefreshAsync(login.Cookie);
        Assert.Equal(HttpStatusCode.OK, stillUsable.StatusCode);
    }

    [Fact]
    public async Task Password_security_stamp_change_revokes_refresh_family()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"password-revoke-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Password{suffix[..8]}", "valid-password-value");
        var login = await LoginWithSessionAsync(email, "valid-password-value", "Password change");
        using (var scope = factory!.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await users.FindByIdAsync(login.UserId.ToString("D"));
            Assert.NotNull(user);
            var changed = await users.ChangePasswordAsync(user!, "valid-password-value", "new-valid-password-value");
            Assert.True(changed.Succeeded);
        }

        using var rejected = await RefreshAsync(login.Cookie);

        Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
        await using var database = CreateContext();
        var session = await database.RefreshSessions.SingleAsync(item => item.UserId == login.UserId);
        Assert.Equal(RefreshSessionRevocationReason.SecurityStampChanged, session.RevocationReason);
    }

    [Fact]
    public async Task Idle_expiry_rejects_refresh_and_revokes_family()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"idle-expiry-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Idle{suffix[..8]}", "valid-password-value");
        var login = await LoginWithSessionAsync(email, "valid-password-value", "Idle expiry");
        await using (var database = CreateContext())
        {
            await database.RefreshSessions.Where(item => item.UserId == login.UserId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.IdleExpiresAt, SystemClock.Instance.GetCurrentInstant() - Duration.FromMinutes(1)));
        }

        using var rejected = await RefreshAsync(login.Cookie);

        Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
        await using var verification = CreateContext();
        Assert.Equal(RefreshSessionRevocationReason.Expired,
            await verification.RefreshSessions.Where(item => item.UserId == login.UserId).Select(item => item.RevocationReason).SingleAsync());
    }

    [Fact]
    public async Task Registration_atomically_creates_24_hour_verification_and_outbox()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"verify-register-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Verify{suffix[..8]}", "valid-password-value");
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);

        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant());
        var token = await database.AccountActionTokens.SingleAsync(item => item.UserId == user.Id && item.Purpose == AccountActionPurpose.VerifyEmail);
        var outbox = await database.NotificationOutboxRecords.SingleAsync(item => item.UserId == user.Id);
        Assert.Equal(token.CreatedAt + Duration.FromHours(24), token.ExpiresAt);
        Assert.Equal(64, token.TokenHash.Length);
        Assert.Equal(user.SecurityStamp, token.SecurityStamp);
        Assert.Equal("verify-email", outbox.TemplateKey);
        Assert.DoesNotContain(token.TokenHash, outbox.TemplateModelJson!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Registration_and_resend_verification_preserve_safe_return_url_in_outbox_action()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"verify-return-{suffix}@example.test";
        const string returnUrl = "/calendar?month=2035-03&view=list&register=lyon-legacy";
        using var registration = await RegisterAsync(email, $"Return{suffix[..8]}", "valid-password-value", returnUrl);
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);

        var registrationAction = await LatestActionUrlAsync(email);
        Assert.Equal(returnUrl, System.Web.HttpUtility.ParseQueryString(registrationAction.Query)["returnUrl"]);
        Assert.Contains("returnUrl=%2Fcalendar%3Fmonth%3D2035-03%26view%3Dlist%26register%3Dlyon-legacy", registrationAction.OriginalString, StringComparison.OrdinalIgnoreCase);

        using var resend = await Client.PostAsJsonAsync("/api/auth/resend-verification", new { email, returnUrl });
        Assert.Equal(HttpStatusCode.Accepted, resend.StatusCode);
        var resendAction = await LatestActionUrlAsync(email);
        Assert.Equal(returnUrl, System.Web.HttpUtility.ParseQueryString(resendAction.Query)["returnUrl"]);
    }

    [Theory]
    [InlineData("https://evil.test/calendar?register=lyon-legacy")]
    [InlineData("/calendar\nSet-Cookie: stolen=true")]
    public async Task Unsafe_return_url_is_absent_from_verification_email(string returnUrl)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"verify-unsafe-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Unsafe{suffix[..8]}", "valid-password-value", returnUrl);
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);

        var action = await LatestActionUrlAsync(email);
        Assert.Null(System.Web.HttpUtility.ParseQueryString(action.Query)["returnUrl"]);
        Assert.DoesNotContain("evil.test", action.OriginalString, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Set-Cookie", action.OriginalString, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Verification_rejects_expired_and_superseded_tokens_then_accepts_latest_once()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"verify-latest-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Latest{suffix[..8]}", "valid-password-value");
        var firstToken = await LatestActionTokenAsync(email);

        using var resend = await Client.PostAsJsonAsync("/api/auth/resend-verification", new { email });
        Assert.Equal(HttpStatusCode.Accepted, resend.StatusCode);
        var latestToken = await LatestActionTokenAsync(email);
        Assert.NotEqual(firstToken, latestToken);

        using var superseded = await Client.PostAsJsonAsync("/api/auth/verify-email", new { token = firstToken });
        Assert.Equal(HttpStatusCode.BadRequest, superseded.StatusCode);
        using var accepted = await Client.PostAsJsonAsync("/api/auth/verify-email", new { token = latestToken });
        Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
        using var replay = await Client.PostAsJsonAsync("/api/auth/verify-email", new { token = latestToken });
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);

        var expiredEmail = $"verify-expired-{suffix}@example.test";
        using var expiredRegistration = await RegisterAsync(expiredEmail, $"Expired{suffix[..8]}", "valid-password-value");
        var expiredToken = await LatestActionTokenAsync(expiredEmail);
        await using (var database = CreateContext())
        {
            var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(expiredToken)));
            await database.AccountActionTokens.Where(item => item.TokenHash == hash)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.ExpiresAt, SystemClock.Instance.GetCurrentInstant()));
        }
        using var expired = await Client.PostAsJsonAsync("/api/auth/verify-email", new { token = expiredToken });
        Assert.Equal(HttpStatusCode.BadRequest, expired.StatusCode);
    }

    [Fact]
    public async Task Forgot_response_is_generic_and_reset_is_single_use_and_revokes_sessions()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"reset-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Reset{suffix[..8]}", "valid-password-value");
        var login = await LoginWithSessionAsync(email, "valid-password-value", "Reset session");

        using var known = await Client.PostAsJsonAsync("/api/auth/forgot-password", new { email });
        using var unknown = await Client.PostAsJsonAsync("/api/auth/forgot-password", new { email = $"missing-{suffix}@example.test" });
        Assert.Equal(HttpStatusCode.Accepted, known.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, unknown.StatusCode);
        Assert.Equal(await known.Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());

        var resetToken = await LatestActionTokenAsync(email);
        using var reset = await Client.PostAsJsonAsync("/api/auth/reset-password", new { token = resetToken, password = "new-valid-password-value" });
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);
        using var replay = await Client.PostAsJsonAsync("/api/auth/reset-password", new { token = resetToken, password = "another-valid-password" });
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);
        using var revoked = await RefreshAsync(login.Cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
        _ = await LoginAsync(email, "new-valid-password-value");

        await using var database = CreateContext();
        Assert.Contains(RefreshSessionRevocationReason.PasswordReset,
            await database.RefreshSessions.Where(item => item.UserId == login.UserId).Select(item => item.RevocationReason).ToListAsync());
    }

    [Fact]
    public async Task Email_change_requires_password_reverifies_and_records_protected_history()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"change-old-{suffix}@example.test";
        var newEmail = $"change-new-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Change{suffix[..8]}", "valid-password-value");
        var accessToken = await LoginAsync(email, "valid-password-value");
        var initialVerification = await LatestActionTokenAsync(email);
        using var verified = await Client.PostAsJsonAsync("/api/auth/verify-email", new { token = initialVerification });
        Assert.Equal(HttpStatusCode.NoContent, verified.StatusCode);

        using var requested = await SendAuthorizedAsync(HttpMethod.Post, "/api/users/me/email-change", accessToken,
            new { newEmail, currentPassword = "valid-password-value" });
        Assert.Equal(HttpStatusCode.Accepted, requested.StatusCode);
        await using (var database = CreateContext())
        {
            Assert.False(await database.Users.Where(item => item.NormalizedEmail == email.ToUpperInvariant()).Select(item => item.EmailConfirmed).SingleAsync());
        }

        var changeToken = await LatestActionTokenAsync(newEmail);
        using var confirmed = await Client.PostAsJsonAsync("/api/auth/confirm-email-change", new { token = changeToken });
        Assert.Equal(HttpStatusCode.NoContent, confirmed.StatusCode);
        _ = await LoginAsync(newEmail, "valid-password-value");

        using var unauthorized = await Client.GetAsync("/api/users/me/email-history");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        using var history = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me/email-history", accessToken);
        Assert.Equal(HttpStatusCode.OK, history.StatusCode);
        var items = await history.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(email, items[0].GetProperty("email").GetString());

        await using var auditDatabase = CreateContext();
        var auditText = string.Join('\n', await auditDatabase.AuditRecords
            .Where(item => item.Action.StartsWith("auth.email"))
            .Select(item => item.RedactedDiff)
            .ToListAsync());
        Assert.DoesNotContain(email, auditText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(newEmail, auditText, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Pending_email_change_cannot_be_reverified_by_old_or_resent_link()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"change-pending-{suffix}@example.test";
        var targetEmail = $"change-pending-target-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Pending{suffix[..8]}", "valid-password-value");
        var oldVerificationToken = await LatestActionTokenAsync(email);
        var accessToken = await LoginAsync(email, "valid-password-value");

        using var requested = await SendAuthorizedAsync(HttpMethod.Post, "/api/users/me/email-change", accessToken,
            new { newEmail = targetEmail, currentPassword = "valid-password-value" });
        Assert.Equal(HttpStatusCode.Accepted, requested.StatusCode);
        using var oldVerification = await Client.PostAsJsonAsync("/api/auth/verify-email", new { token = oldVerificationToken });
        Assert.Equal(HttpStatusCode.BadRequest, oldVerification.StatusCode);
        using var resend = await Client.PostAsJsonAsync("/api/auth/resend-verification", new { email });
        Assert.Equal(HttpStatusCode.Accepted, resend.StatusCode);

        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant());
        Assert.False(user.EmailConfirmed);
        Assert.False(await database.AccountActionTokens.AnyAsync(item => item.UserId == user.Id
            && item.Purpose == AccountActionPurpose.VerifyEmail
            && item.ConsumedAt == null
            && item.SupersededAt == null));
    }

    [Fact]
    public async Task Email_change_confirmation_rechecks_normalized_uniqueness_before_commit()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var ownerEmail = $"change-owner-{suffix}@example.test";
        var targetEmail = $"change-target-{suffix}@example.test";
        using var ownerRegistration = await RegisterAsync(ownerEmail, $"Owner{suffix[..8]}", "valid-password-value");
        var ownerToken = await LoginAsync(ownerEmail, "valid-password-value");
        using var requested = await SendAuthorizedAsync(HttpMethod.Post, "/api/users/me/email-change", ownerToken,
            new { newEmail = targetEmail.ToUpperInvariant(), currentPassword = "valid-password-value" });
        Assert.Equal(HttpStatusCode.Accepted, requested.StatusCode);
        var changeToken = await LatestActionTokenAsync(targetEmail.ToUpperInvariant());

        using var collision = await RegisterAsync(targetEmail, $"Collision{suffix[..8]}", "another-valid-password");
        Assert.Equal(HttpStatusCode.Created, collision.StatusCode);
        using var confirmation = await Client.PostAsJsonAsync("/api/auth/confirm-email-change", new { token = changeToken });
        Assert.Equal(HttpStatusCode.Conflict, confirmation.StatusCode);

        await using var database = CreateContext();
        Assert.True(await database.Users.AnyAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant()));
        Assert.Equal(1, await database.Users.CountAsync(item => item.NormalizedEmail == targetEmail.ToUpperInvariant()));
    }

    [Fact]
    public async Task Resend_rate_limit_is_account_keyed_and_returns_retry_after()
    {
        await using var limitedFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", SigningKey);
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT", "2");
        });
        using var limitedClient = limitedFactory.CreateClient();
        var first = $"rate-first-{Guid.NewGuid():N}@example.test";
        var second = $"rate-second-{Guid.NewGuid():N}@example.test";
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var accepted = await limitedClient.PostAsJsonAsync("/api/auth/resend-verification", new { email = first });
            Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
        }
        using var rejected = await limitedClient.PostAsJsonAsync("/api/auth/resend-verification", new { email = first });
        Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
        Assert.True(rejected.Headers.RetryAfter?.Delta > TimeSpan.Zero);

        using var otherAccount = await limitedClient.PostAsJsonAsync("/api/auth/resend-verification", new { email = second });
        Assert.Equal(HttpStatusCode.TooManyRequests, otherAccount.StatusCode); // shared IP partition is independent from account partition
    }

    [Fact]
    public async Task Email_history_redaction_is_bounded_and_idempotent()
    {
        var now = SystemClock.Instance.GetCurrentInstant();
        await using (var database = CreateContext())
        {
            var users = await database.Users.Take(1).ToListAsync();
            if (users.Count == 0)
            {
                var suffix = Guid.NewGuid().ToString("N");
                using var registration = await RegisterAsync($"retention-{suffix}@example.test", $"Retention{suffix[..8]}", "valid-password-value");
                users = await database.Users.Take(1).ToListAsync();
            }
            for (var index = 0; index < UserEmailHistoryRedactor.BatchSize + 1; index++)
            {
                database.UserEmailHistories.Add(UserEmailHistory.Create(users[0].Id, $"old-{index}@example.test", now - Duration.FromDays(800)));
            }
            await database.SaveChangesAsync();
        }

        await using var firstDatabase = CreateContext();
        var firstRedactor = new UserEmailHistoryRedactor(firstDatabase, SystemClock.Instance);
        Assert.Equal(UserEmailHistoryRedactor.BatchSize, await firstRedactor.RedactBatchAsync(CancellationToken.None));
        Assert.Equal(1, await firstRedactor.RedactBatchAsync(CancellationToken.None));
        Assert.Equal(0, await firstRedactor.RedactBatchAsync(CancellationToken.None));
    }

    [Fact]
    public async Task Database_has_unique_normalized_username_and_email_indexes()
    {
        await using var database = CreateContext();
        var indexDefinitions = await SqlListAsync(database, "SELECT indexdef FROM pg_indexes WHERE tablename IN ('asp_net_users', 'user_profiles')");

        Assert.Contains(indexDefinitions, value => value.Contains("UNIQUE", StringComparison.Ordinal) && value.Contains("normalized_email", StringComparison.Ordinal));
        Assert.Contains(indexDefinitions, value => value.Contains("UNIQUE", StringComparison.Ordinal) && value.Contains("normalized_username", StringComparison.Ordinal));
    }

    private async Task<Uri> LatestActionUrlAsync(string recipient)
    {
        await using var database = CreateContext();
        var modelJson = await database.NotificationOutboxRecords
            .Where(item => item.Recipient == recipient)
            .OrderByDescending(item => item.CreatedAt)
            .Select(item => item.TemplateModelJson)
            .FirstAsync();
        using var model = JsonDocument.Parse(modelJson ?? throw new InvalidOperationException("Action notification was scrubbed."));
        return new Uri(model.RootElement.GetProperty("actionUrl").GetString()!);
    }

    private async Task<string> LatestActionTokenAsync(string recipient)
    {
        var actionUrl = await LatestActionUrlAsync(recipient);
        return System.Web.HttpUtility.ParseQueryString(actionUrl.Query)["token"]!;
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Test client is not initialized.");

    private Task<HttpResponseMessage> RegisterAsync(string email, string username, string password, string? returnUrl = null) => Client.PostAsJsonAsync("/api/auth/register", new
    {
        email,
        username,
        password,
        firstName = "Alice",
        lastName = "Martin",
        returnUrl
    });

    private async Task<string> LoginAsync(string email, string password) =>
        (await LoginWithSessionAsync(email, password, null)).AccessToken;

    private async Task<LoginSessionResult> LoginWithSessionAsync(string email, string password, string? deviceLabel)
    {
        using var response = await Client.PostAsJsonAsync("/api/auth/login", new { email, password, deviceLabel });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var accessToken = body.GetProperty("accessToken").GetString() ?? throw new InvalidOperationException("No access token returned.");
        using var payload = DecodeJwtPayload(accessToken);
        var userId = payload.RootElement.GetProperty("sub").GetGuid();
        var setCookie = response.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("gones_refresh=", StringComparison.Ordinal));
        return new LoginSessionResult(userId, accessToken, setCookie.Split(';', 2)[0], setCookie);
    }

    private Task<HttpResponseMessage> RefreshAsync(string cookie)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        request.Headers.Add("Cookie", cookie);
        return Client.SendAsync(request);
    }

    private static string CookieFrom(HttpResponseMessage response) => response.Headers.GetValues("Set-Cookie")
        .Single(value => value.StartsWith("gones_refresh=", StringComparison.Ordinal)).Split(';', 2)[0];

    private async Task<HttpResponseMessage> SendAuthorizedAsync(HttpMethod method, string path, string token, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await Client.SendAsync(request);
    }

    private static object ProfilePatch(string username, string? city, string? birthDate, string? currentPassword) =>
        ProfilePatch(username, null, null, city, birthDate, currentPassword);

    private static object ProfilePatch(
        string username,
        string? country,
        string? region,
        string? city,
        string? birthDate,
        string? currentPassword) => new
    {
        username,
        firstName = "Alice",
        lastName = "Martin",
        locationCountry = country,
        locationRegion = region,
        locationCity = city,
        birthDate,
        preferredLanguage = "fr",
        isFirstNamePublic = false,
        isLastNamePublic = false,
        isLocationPublic = false,
        isBirthDatePublic = false,
        isPreferredLanguagePublic = false,
        currentPassword
    };

    private static JsonDocument DecodeJwtPayload(string token)
    {
        var payload = token.Split('.')[1].Replace('-', '+').Replace('_', '/');
        payload = payload.PadRight(payload.Length + ((4 - payload.Length % 4) % 4), '=');
        return JsonDocument.Parse(Convert.FromBase64String(payload));
    }

    private static async Task<string> ProblemCodeAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("code").GetString() ?? string.Empty;
    }

    private static async Task<string> StableProblemAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return $"{body.GetProperty("code").GetString()}|{body.GetProperty("detail").GetString()}";
    }

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options;
        return new GonesDbContext(options);
    }

    private sealed record LoginSessionResult(Guid UserId, string AccessToken, string Cookie, string SetCookie);

    private static async Task<IReadOnlyList<string>> SqlListAsync(GonesDbContext database, string sql)
    {
        await database.Database.OpenConnectionAsync();
        await using var command = database.Database.GetDbConnection().CreateCommand();
        command.CommandText = sql;
        await using var reader = await command.ExecuteReaderAsync();
        var values = new List<string>();
        while (await reader.ReadAsync()) values.Add(reader.GetString(0));
        return values;
    }
}
