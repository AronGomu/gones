using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

namespace Gones.IntegrationTests;

/// <summary>
/// The browser session round trip behind "stay signed in across a reload": login has to hand the
/// browser a refresh cookie it will actually store and replay, refresh has to accept that cookie on
/// its own, rotate it, and logout has to expire it. The attributes are deployment topology, so they
/// are asserted against configuration rather than against a hard-coded constant.
/// </summary>
public sealed class RefreshCookieTests : IAsyncLifetime
{
    private const string SigningKey = "c08-refresh-cookie-integration-signing-key-over-32-chars";
    private const string Password = "valid-password-value";
    private static readonly WebApplicationFactoryClientOptions ClientOptions = new() { HandleCookies = false };
    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext()) await database.Database.MigrateAsync();
        factory = CreateFactory(null, null);
        client = factory.CreateClient(ClientOptions);
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Login_issues_refresh_cookie()
    {
        var email = await RegisterAsync("issue");

        var login = await LoginAsync(Client, email);

        var cookie = SetCookieHeaderValue.Parse(login.SetCookie);
        Assert.Equal("gones_refresh", cookie.Name.Value);
        Assert.False(string.IsNullOrWhiteSpace(cookie.Value.Value));
        Assert.True(cookie.HttpOnly);
        Assert.Equal("/api/auth", cookie.Path.Value);
    }

    [Fact]
    public async Task Refresh_accepts_only_the_cookie()
    {
        var email = await RegisterAsync("cookie-only");
        var login = await LoginAsync(Client, email);

        using var refreshed = await RefreshAsync(Client, login.Cookie);

        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
        var body = await refreshed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("accessToken").GetString()));
    }

    [Fact]
    public async Task Refresh_rotates_the_cookie_value()
    {
        var email = await RegisterAsync("rotation");
        var login = await LoginAsync(Client, email);

        using var first = await RefreshAsync(Client, login.Cookie);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var firstCookie = CookieFrom(first);
        using var second = await RefreshAsync(Client, firstCookie);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        var secondCookie = CookieFrom(second);

        Assert.NotEqual(login.Cookie, firstCookie);
        Assert.NotEqual(firstCookie, secondCookie);
    }

    [Fact]
    public async Task Logout_clears_the_cookie()
    {
        var email = await RegisterAsync("logout");
        var login = await LoginAsync(Client, email);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        request.Headers.Add("Cookie", login.Cookie);

        using var logout = await Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        var cleared = SetCookieHeaderValue.Parse(SetCookieFrom(logout));
        Assert.NotNull(cleared.Expires);
        Assert.True(cleared.Expires < DateTimeOffset.UtcNow, $"Cleared cookie must expire in the past but expires at {cleared.Expires}.");
    }

    [Fact]
    public async Task Cookie_samesite_follows_configuration()
    {
        await using var crossSite = CreateFactory("None", false);
        using var crossSiteClient = crossSite.CreateClient(ClientOptions);
        await using var sameOrigin = CreateFactory("Lax", false);
        using var sameOriginClient = sameOrigin.CreateClient(ClientOptions);
        var crossSiteEmail = await RegisterAsync("cross-site", crossSiteClient);
        var sameOriginEmail = await RegisterAsync("same-origin", sameOriginClient);

        var issuedCrossSite = SetCookieHeaderValue.Parse((await LoginAsync(crossSiteClient, crossSiteEmail)).SetCookie);
        var issuedSameOrigin = SetCookieHeaderValue.Parse((await LoginAsync(sameOriginClient, sameOriginEmail)).SetCookie);

        // "None" is meaningless without "Secure": browsers drop the pair, so the flag is forced on.
        Assert.Equal(Microsoft.Net.Http.Headers.SameSiteMode.None, issuedCrossSite.SameSite);
        Assert.True(issuedCrossSite.Secure);
        // Plain-HTTP development keeps the cookie usable by honouring Secure=false.
        Assert.Equal(Microsoft.Net.Http.Headers.SameSiteMode.Lax, issuedSameOrigin.SameSite);
        Assert.False(issuedSameOrigin.Secure);
    }

    private WebApplicationFactory<Program> CreateFactory(string? sameSite, bool? secure) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", SigningKey);
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT", "1000");
            if (sameSite is not null) builder.UseSetting("Gones:Auth:RefreshCookie:SameSite", sameSite);
            if (secure is not null) builder.UseSetting("Gones:Auth:RefreshCookie:Secure", secure.Value ? "true" : "false");
        });

    private HttpClient Client => client ?? throw new InvalidOperationException("Test client is not initialized.");

    private async Task<string> RegisterAsync(string label, HttpClient? target = null)
    {
        var suffix = Guid.NewGuid().ToString("N");
        var email = $"{label}-{suffix}@example.test";
        using var response = await (target ?? Client).PostAsJsonAsync("/api/auth/register", new
        {
            email,
            username = $"Refresh{suffix[..8]}",
            password = Password,
            firstName = "Alice",
            lastName = "Martin"
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return email;
    }

    private static async Task<LoginResult> LoginAsync(HttpClient target, string email)
    {
        using var response = await target.PostAsJsonAsync("/api/auth/login", new { email, password = Password, deviceLabel = "Refresh cookie test" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var setCookie = SetCookieFrom(response);
        return new LoginResult(setCookie, setCookie.Split(';', 2)[0]);
    }

    private static Task<HttpResponseMessage> RefreshAsync(HttpClient target, string cookie)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        request.Headers.Add("Cookie", cookie);
        Assert.Null(request.Headers.Authorization);
        return target.SendAsync(request);
    }

    private static string SetCookieFrom(HttpResponseMessage response) => response.Headers.GetValues("Set-Cookie")
        .Single(value => value.StartsWith("gones_refresh=", StringComparison.Ordinal));

    private static string CookieFrom(HttpResponseMessage response) => SetCookieFrom(response).Split(';', 2)[0];

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options;
        return new GonesDbContext(options);
    }

    private sealed record LoginResult(string SetCookie, string Cookie);
}
