using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Api.Security;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
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
        Assert.False(registered.GetProperty("isBirthYearPublic").GetBoolean());
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
        var ordinaryPatch = ProfilePatch(username, location: "Brussels", birthYear: 1990, currentPassword: null);
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
    public async Task Audit_diffs_and_metrics_path_do_not_persist_credentials_or_raw_pii()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"audit-{suffix}@example.test";
        var username = $"Audit{suffix[..8]}";
        const string password = "audit-password-value";
        using var registration = await RegisterAsync(email, username, password);
        var token = await LoginAsync(email, password);
        using var patch = await SendAuthorizedAsync(HttpMethod.Patch, "/api/users/me", token, ProfilePatch(username, "Secret Place", 1991, null));
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
    public async Task Database_has_unique_normalized_username_and_email_indexes()
    {
        await using var database = CreateContext();
        var indexDefinitions = await SqlListAsync(database, "SELECT indexdef FROM pg_indexes WHERE tablename IN ('asp_net_users', 'user_profiles')");

        Assert.Contains(indexDefinitions, value => value.Contains("UNIQUE", StringComparison.Ordinal) && value.Contains("normalized_email", StringComparison.Ordinal));
        Assert.Contains(indexDefinitions, value => value.Contains("UNIQUE", StringComparison.Ordinal) && value.Contains("normalized_username", StringComparison.Ordinal));
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Test client is not initialized.");

    private Task<HttpResponseMessage> RegisterAsync(string email, string username, string password) => Client.PostAsJsonAsync("/api/auth/register", new
    {
        email,
        username,
        password,
        firstName = "Alice",
        lastName = "Martin"
    });

    private async Task<string> LoginAsync(string email, string password)
    {
        using var response = await Client.PostAsJsonAsync("/api/auth/login", new { email, password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("accessToken").GetString() ?? throw new InvalidOperationException("No access token returned.");
    }

    private async Task<HttpResponseMessage> SendAuthorizedAsync(HttpMethod method, string path, string token, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await Client.SendAsync(request);
    }

    private static object ProfilePatch(string username, string? location, int? birthYear, string? currentPassword) => new
    {
        username,
        firstName = "Alice",
        lastName = "Martin",
        location,
        birthYear,
        preferredLanguage = "fr",
        isFirstNamePublic = false,
        isLastNamePublic = false,
        isLocationPublic = false,
        isBirthYearPublic = false,
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
