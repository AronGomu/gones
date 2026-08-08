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

public sealed class OAuthApiTests : IAsyncLifetime
{
    private static readonly string SigningKey = $"c11-oauth-{new string('x', 32)}";
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
            builder.UseSetting("GONES_AUTH_PROVIDER", "Fake");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", SigningKey);
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("GONES_OAUTH_CALLBACK_ORIGIN", "https://oauth.example");
            builder.UseSetting("GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT", "1000");
        });
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = false });
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Callback_rejects_missing_or_mismatched_state_and_correlation()
    {
        var started = await StartAsync("google", "complete", NewSubject(), "verified@example.test");
        using var missingCorrelation = await Client.GetAsync(started.CallbackPath);
        Assert.Equal(HttpStatusCode.BadRequest, missingCorrelation.StatusCode);
        Assert.Equal("invalid_oauth_state", await ProblemCodeAsync(missingCorrelation));

        var second = await StartAsync("google", "complete", NewSubject(), "verified2@example.test");
        using var wrongState = await SendWithCookieAsync(HttpMethod.Get, ReplaceQuery(second.CallbackPath, "state", "wrong"), second.Cookie);
        Assert.Equal(HttpStatusCode.BadRequest, wrongState.StatusCode);
        Assert.Equal("invalid_oauth_state", await ProblemCodeAsync(wrongState));

        var oneTime = await StartAsync("google", "complete", NewSubject(), "one-time@example.test");
        using var accepted = await SendWithCookieAsync(HttpMethod.Get, oneTime.CallbackPath, oneTime.Cookie);
        using var replay = await SendWithCookieAsync(HttpMethod.Get, oneTime.CallbackPath, oneTime.Cookie);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);
        Assert.Equal("invalid_oauth_state", await ProblemCodeAsync(replay));
    }

    [Fact]
    public async Task Browser_callback_redirects_to_fixed_profile_path_with_fresh_session()
    {
        var started = await StartAsync("google", "complete", NewSubject(), $"browser-{Guid.NewGuid():N}@example.test");

        using var callback = await SendNavigationWithCookieAsync(started.CallbackPath, started.Cookie);

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("https://app.example/profile", callback.Headers.Location?.ToString());
        Assert.DoesNotContain("accessToken", callback.Headers.Location?.ToString(), StringComparison.OrdinalIgnoreCase);
        using var refreshed = await RefreshAsync(CookieFrom(callback, "gones_refresh"));
        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
    }

    [Fact]
    public async Task Browser_incomplete_callback_redirects_with_only_opaque_completion_ticket()
    {
        var email = $"browser-incomplete-{Guid.NewGuid():N}@example.test";
        var started = await StartAsync("facebook", "incomplete", NewSubject(), email);

        using var callback = await SendNavigationWithCookieAsync(started.CallbackPath, started.Cookie, addHostileRedirectHeaders: true);

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        var location = Assert.IsType<Uri>(callback.Headers.Location);
        Assert.Equal("app.example", location.Host);
        Assert.Equal("/auth/complete-profile", location.AbsolutePath);
        var query = System.Web.HttpUtility.ParseQueryString(location.Query);
        Assert.False(string.IsNullOrWhiteSpace(query["ticket"]));
        Assert.Single(query.AllKeys);
        Assert.DoesNotContain(email, location.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("facebook", location.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("accessToken", location.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("http://app.example")]
    [InlineData("https://app.example/path")]
    public async Task Missing_or_invalid_public_origin_fails_closed(string? publicOrigin)
    {
        await using var invalidFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Fake");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", SigningKey);
            builder.UseSetting("GONES_OAUTH_CALLBACK_ORIGIN", "https://oauth.example");
            if (publicOrigin is not null) builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", publicOrigin);
        });

        var exception = await Assert.ThrowsAnyAsync<Exception>(async () =>
        {
            using var invalidClient = invalidFactory.CreateClient();
            using var response = await invalidClient.GetAsync("/health/live");
        });
        Assert.Contains("GONES_PUBLIC_APP_ORIGIN must be an HTTPS origin", exception.ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("google")]
    [InlineData("facebook")]
    public async Task Complete_provider_profile_creates_new_account_without_persisting_tokens(string provider)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"oauth-{provider}-{suffix}@example.test";
        var started = await StartAsync(provider, "complete", $"subject-{suffix}", email);

        using var callback = await SendWithCookieAsync(HttpMethod.Get, started.CallbackPath, started.Cookie);
        var body = await callback.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, callback.StatusCode);
        Assert.Equal("authenticated", body.GetProperty("status").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("accessToken").GetString()));
        await using var database = CreateContext();
        var identity = await database.ExternalIdentities.SingleAsync(item => item.Provider == provider);
        Assert.Equal(email, identity.ProviderEmail);
        Assert.DoesNotContain("token", string.Join('|', database.Model.FindEntityType(typeof(ExternalIdentity))!.GetProperties().Select(item => item.Name)), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Incomplete_profile_uses_one_time_completion_ticket()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var started = await StartAsync("google", "incomplete", $"incomplete-{suffix}", $"incomplete-{suffix}@example.test");
        using var callback = await SendWithCookieAsync(HttpMethod.Get, started.CallbackPath, started.Cookie);
        var callbackBody = await callback.Content.ReadFromJsonAsync<JsonElement>();
        var ticket = callbackBody.GetProperty("completionTicket").GetString();
        Assert.Equal("completion_required", callbackBody.GetProperty("status").GetString());

        var completion = new { completionTicket = ticket, email = $"incomplete-{suffix}@example.test", username = $"OAuth{suffix[..8]}", firstName = "Alice", lastName = "Martin", deviceLabel = "OAuth test" };
        using var completed = await Client.PostAsJsonAsync("/api/auth/oauth/complete", completion);
        using var replay = await Client.PostAsJsonAsync("/api/auth/oauth/complete", completion);

        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);
        Assert.Equal("invalid_oauth_ticket", await ProblemCodeAsync(replay));
    }

    [Theory]
    [InlineData("missing_email")]
    [InlineData("unverified_email")]
    public async Task Missing_or_unverified_provider_email_requires_Gones_verification_before_registration(string scenario)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"verify-oauth-{suffix}@example.test";
        var started = await StartAsync("google", scenario, $"verify-{suffix}", email);
        using var callback = await SendWithCookieAsync(HttpMethod.Get, started.CallbackPath, started.Cookie);
        var callbackBody = await callback.Content.ReadFromJsonAsync<JsonElement>();
        var ticket = callbackBody.GetProperty("completionTicket").GetString();

        using var completion = await Client.PostAsJsonAsync("/api/auth/oauth/complete", new
        {
            completionTicket = ticket,
            email,
            username = $"Verify{suffix[..8]}",
            firstName = "Alice",
            lastName = "Martin"
        });
        var completionBody = await completion.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.Accepted, completion.StatusCode);
        Assert.Equal("email_verification_required", completionBody.GetProperty("status").GetString());
        await using (var beforeVerification = CreateContext())
        {
            Assert.False(await beforeVerification.Users.AnyAsync(item => item.NormalizedEmail == email.ToUpperInvariant()));
        }

        var verificationToken = await LatestOAuthVerificationTokenAsync(email);
        using var verified = await Client.PostAsJsonAsync("/api/auth/oauth/verify-email", new { token = verificationToken, deviceLabel = "OAuth verification" });
        Assert.Equal(HttpStatusCode.OK, verified.StatusCode);
        await using var afterVerification = CreateContext();
        Assert.True(await afterVerification.Users.Where(item => item.NormalizedEmail == email.ToUpperInvariant()).Select(item => item.EmailConfirmed).SingleAsync());
    }

    [Fact]
    public async Task Existing_email_is_never_auto_linked()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"existing-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Existing{suffix[..8]}");
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);
        var started = await StartAsync("google", "complete", $"collision-{suffix}", email);

        using var callback = await SendWithCookieAsync(HttpMethod.Get, started.CallbackPath, started.Cookie);

        Assert.Equal(HttpStatusCode.Conflict, callback.StatusCode);
        Assert.Equal("existing_email_requires_link", await ProblemCodeAsync(callback));
        await using var database = CreateContext();
        Assert.False(await database.ExternalIdentities.AnyAsync(item => item.ProviderSubject == $"collision-{suffix}"));
    }

    [Fact]
    public async Task Authenticated_user_can_link_then_unlink_without_a_password_and_sessions_are_revoked()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"link-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Link{suffix[..8]}");
        var login = await LoginAsync(email);

        using var linkStart = await SendAuthorizedFakeAsync(HttpMethod.Post, "/api/users/me/external-identities/google/start", login.AccessToken,
            "complete", $"linked-{suffix}", email);
        Assert.Equal(HttpStatusCode.OK, linkStart.StatusCode);
        var startBody = await linkStart.Content.ReadFromJsonAsync<JsonElement>();
        var authorizationUrl = new Uri(startBody.GetProperty("authorizationUrl").GetString()!);
        var cookie = CookieFrom(linkStart);
        var callbackPath = await AuthorizeAsync(authorizationUrl);
        using var linked = await SendWithCookieAsync(HttpMethod.Get, callbackPath, cookie);
        Assert.Equal(HttpStatusCode.NoContent, linked.StatusCode);

        using var oldRefresh = await RefreshAsync(login.Cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, oldRefresh.StatusCode);

        var secondLogin = await LoginAsync(email);
        using var unlinked = await SendAuthorizedAsync(HttpMethod.Delete, "/api/users/me/external-identities/google", secondLogin.AccessToken);
        Assert.Equal(HttpStatusCode.NoContent, unlinked.StatusCode);
        using var secondOldRefresh = await RefreshAsync(secondLogin.Cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, secondOldRefresh.StatusCode);

        await using var database = CreateContext();
        var audits = await database.AuditRecords.Where(item => item.Action.StartsWith("auth.external_identity")).Select(item => item.RedactedDiff).ToListAsync();
        Assert.All(audits, audit =>
        {
            Assert.Contains("google", audit, StringComparison.Ordinal);
            Assert.DoesNotContain(email, audit, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("token", audit, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public async Task Browser_link_callback_redirects_to_profile_with_replacement_session()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"browser-link-{suffix}@example.test";
        using var registration = await RegisterAsync(email, $"Browser{suffix[..8]}");
        var login = await LoginAsync(email);
        using var linkStart = await SendAuthorizedFakeAsync(HttpMethod.Post, "/api/users/me/external-identities/google/start", login.AccessToken,
            "complete", $"browser-linked-{suffix}", email);
        Assert.Equal(HttpStatusCode.OK, linkStart.StatusCode);
        var startBody = await linkStart.Content.ReadFromJsonAsync<JsonElement>();
        var callbackPath = await AuthorizeAsync(new Uri(startBody.GetProperty("authorizationUrl").GetString()!));

        using var linked = await SendNavigationWithCookieAsync(callbackPath, CookieFrom(linkStart));

        Assert.Equal(HttpStatusCode.Redirect, linked.StatusCode);
        Assert.Equal("https://app.example/profile", linked.Headers.Location?.ToString());
        using var oldRefresh = await RefreshAsync(login.Cookie);
        using var replacementRefresh = await RefreshAsync(CookieFrom(linked, "gones_refresh"));
        Assert.Equal(HttpStatusCode.Unauthorized, oldRefresh.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replacementRefresh.StatusCode);
    }

    [Fact]
    public async Task Unlink_refuses_final_login_method()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var subject = $"only-{suffix}";
        var started = await StartAsync("google", "complete", subject, $"only-{suffix}@example.test");
        using var callback = await SendWithCookieAsync(HttpMethod.Get, started.CallbackPath, started.Cookie);
        var body = await callback.Content.ReadFromJsonAsync<JsonElement>();
        var accessToken = body.GetProperty("accessToken").GetString()!;

        using var rejected = await SendAuthorizedAsync(HttpMethod.Delete, "/api/users/me/external-identities/google", accessToken);

        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
        Assert.Equal("last_login_method", await ProblemCodeAsync(rejected));
        await using var database = CreateContext();
        Assert.True(await database.ExternalIdentities.AnyAsync(item => item.ProviderSubject == subject));
    }

    [Fact]
    public async Task Link_start_rejects_an_anonymous_caller()
    {
        var suffix = Guid.NewGuid().ToString("N");

        using var anonymous = await SendAnonymousFakeAsync(HttpMethod.Post, "/api/users/me/external-identities/google/start",
            "complete", $"anonymous-{suffix}", $"anonymous-{suffix}@example.test");

        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.False(anonymous.Headers.Contains("Set-Cookie"));
    }

    [Fact]
    public async Task External_only_account_can_link_and_unlink_when_another_method_remains()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var google = await StartAsync("google", "complete", $"google-{suffix}", $"external-{suffix}@example.test");
        using var signedIn = await SendWithCookieAsync(HttpMethod.Get, google.CallbackPath, google.Cookie);
        var body = await signedIn.Content.ReadFromJsonAsync<JsonElement>();
        var accessToken = body.GetProperty("accessToken").GetString()!;

        using var linkStart = await SendAuthorizedFakeAsync(HttpMethod.Post, "/api/users/me/external-identities/facebook/start", accessToken,
            "complete", $"facebook-{suffix}", $"facebook-{suffix}@example.test");
        Assert.Equal(HttpStatusCode.OK, linkStart.StatusCode);
        var startBody = await linkStart.Content.ReadFromJsonAsync<JsonElement>();
        var callbackPath = await AuthorizeAsync(new Uri(startBody.GetProperty("authorizationUrl").GetString()!));
        using var linked = await SendWithCookieAsync(HttpMethod.Get, callbackPath, CookieFrom(linkStart));
        Assert.Equal(HttpStatusCode.NoContent, linked.StatusCode);

        using var unlinked = await SendAuthorizedAsync(HttpMethod.Delete, "/api/users/me/external-identities/google", accessToken);
        Assert.Equal(HttpStatusCode.NoContent, unlinked.StatusCode);
        await using var database = CreateContext();
        Assert.Equal(["facebook"], await database.ExternalIdentities.Select(item => item.Provider).ToArrayAsync());
    }

    [Fact]
    public async Task Existing_identity_updates_changed_provider_email_metadata_without_changing_account_email()
    {
        var suffix = Guid.NewGuid().ToString("N");
        var subject = $"changed-{suffix}";
        var original = $"original-{suffix}@example.test";
        var changed = $"changed-{suffix}@example.test";
        var first = await StartAsync("google", "complete", subject, original);
        using var firstCallback = await SendWithCookieAsync(HttpMethod.Get, first.CallbackPath, first.Cookie);
        Assert.Equal(HttpStatusCode.OK, firstCallback.StatusCode);
        using var collidingRegistration = await RegisterAsync(changed, $"Collision{suffix[..8]}");
        Assert.Equal(HttpStatusCode.Created, collidingRegistration.StatusCode);

        var second = await StartAsync("google", "complete", subject, changed);
        using var secondCallback = await SendWithCookieAsync(HttpMethod.Get, second.CallbackPath, second.Cookie);
        Assert.Equal(HttpStatusCode.OK, secondCallback.StatusCode);

        await using var database = CreateContext();
        var identity = await database.ExternalIdentities.SingleAsync(item => item.ProviderSubject == subject);
        var user = await database.Users.SingleAsync(item => item.Id == identity.UserId);
        Assert.Equal(changed, identity.ProviderEmail);
        Assert.Equal(original, user.Email);
    }

    [Fact]
    public async Task External_identity_has_provider_subject_unique_index()
    {
        await using var database = CreateContext();
        var indexes = await SqlListAsync(database, "SELECT indexdef FROM pg_indexes WHERE tablename = 'external_identities'");
        Assert.Contains(indexes, value => value.Contains("UNIQUE", StringComparison.Ordinal) && value.Contains("provider", StringComparison.Ordinal) && value.Contains("provider_subject", StringComparison.Ordinal));
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Test client is not initialized.");

    private async Task<StartedFlow> StartAsync(string provider, string scenario, string subject, string email)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/auth/oauth/{provider}/start");
        request.Headers.Add("X-Gones-Fake-OAuth-Scenario", scenario);
        request.Headers.Add("X-Gones-Fake-OAuth-Subject", subject);
        request.Headers.Add("X-Gones-Fake-OAuth-Email", email);
        using var start = await Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Redirect, start.StatusCode);
        var cookie = CookieFrom(start);
        var callback = await AuthorizeAsync(start.Headers.Location!);
        return new StartedFlow(cookie, callback);
    }

    private async Task<string> AuthorizeAsync(Uri authorizationUrl)
    {
        using var authorize = await Client.GetAsync(authorizationUrl.PathAndQuery);
        Assert.Equal(HttpStatusCode.Redirect, authorize.StatusCode);
        return authorize.Headers.Location!.PathAndQuery;
    }

    private Task<HttpResponseMessage> RegisterAsync(string email, string username) => Client.PostAsJsonAsync("/api/auth/register", new
    {
        email,
        username,
        password = "valid-password-value",
        firstName = "Alice",
        lastName = "Martin"
    });

    private async Task<LoginSessionResult> LoginAsync(string email)
    {
        using var response = await Client.PostAsJsonAsync("/api/auth/login", new { email, password = "valid-password-value", deviceLabel = "OAuth link test" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return new LoginSessionResult(body.GetProperty("accessToken").GetString()!, CookieFrom(response));
    }

    private Task<HttpResponseMessage> RefreshAsync(string cookie) => SendWithCookieAsync(HttpMethod.Post, "/api/auth/refresh", cookie);

    private async Task<HttpResponseMessage> SendAuthorizedAsync(HttpMethod method, string path, string token, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await Client.SendAsync(request);
    }

    private async Task<HttpResponseMessage> SendAuthorizedFakeAsync(HttpMethod method, string path, string token, string scenario, string subject, string email, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Add("X-Gones-Fake-OAuth-Scenario", scenario);
        request.Headers.Add("X-Gones-Fake-OAuth-Subject", subject);
        request.Headers.Add("X-Gones-Fake-OAuth-Email", email);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await Client.SendAsync(request);
    }

    private async Task<HttpResponseMessage> SendAnonymousFakeAsync(HttpMethod method, string path, string scenario, string subject, string email)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Add("X-Gones-Fake-OAuth-Scenario", scenario);
        request.Headers.Add("X-Gones-Fake-OAuth-Subject", subject);
        request.Headers.Add("X-Gones-Fake-OAuth-Email", email);
        return await Client.SendAsync(request);
    }

    private async Task<HttpResponseMessage> SendWithCookieAsync(HttpMethod method, string path, string cookie)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Add("Cookie", cookie);
        return await Client.SendAsync(request);
    }

    private async Task<HttpResponseMessage> SendNavigationWithCookieAsync(string path, string cookie, bool addHostileRedirectHeaders = false)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Cookie", cookie);
        request.Headers.Add("Sec-Fetch-Mode", "navigate");
        request.Headers.Add("Sec-Fetch-Dest", "document");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/html"));
        if (addHostileRedirectHeaders)
        {
            request.Headers.Referrer = new Uri("https://evil.example/redirect");
            request.Headers.Add("Origin", "https://evil.example");
            request.Headers.Add("X-Forwarded-Host", "evil.example");
        }
        return await Client.SendAsync(request);
    }

    private static string CookieFrom(HttpResponseMessage response, string? name = null)
    {
        var values = response.Headers.GetValues("Set-Cookie");
        var value = name is null ? values.Single() : values.Single(item => item.StartsWith($"{name}=", StringComparison.Ordinal));
        return value.Split(';', 2)[0];
    }

    private async Task<string> LatestOAuthVerificationTokenAsync(string recipient)
    {
        await using var database = CreateContext();
        var model = await database.NotificationOutboxRecords.Where(item => item.Recipient == recipient).OrderByDescending(item => item.CreatedAt).Select(item => item.TemplateModelJson).FirstAsync();
        using var document = JsonDocument.Parse(model!);
        var url = new Uri(document.RootElement.GetProperty("actionUrl").GetString()!);
        return System.Web.HttpUtility.ParseQueryString(url.Query)["token"]!;
    }

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options;
        return new GonesDbContext(options);
    }

    private static string NewSubject() => $"subject-{Guid.NewGuid():N}";

    private static string ReplaceQuery(string path, string key, string value)
    {
        var uri = new Uri($"https://oauth.example{path}");
        var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
        query[key] = value;
        return $"{uri.AbsolutePath}?{query}";
    }

    private static async Task<string> ProblemCodeAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("code").GetString() ?? string.Empty;
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

    private sealed record StartedFlow(string Cookie, string CallbackPath);
    private sealed record LoginSessionResult(string AccessToken, string Cookie);
}
