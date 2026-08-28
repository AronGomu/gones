using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Api.Security;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Gones.IntegrationTests;

/// <summary>
/// Proves the locked V1 rate policies are wired, keyed, and rejected uniformly.
/// The numeric defaults themselves are asserted in <see cref="Locked_defaults_match_the_agreed_policy_table"/>;
/// the runtime behaviour is proven with deliberately tiny overrides so the suites stay fast.
/// </summary>
public sealed class RateLimitPolicyTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> factory;

    public RateLimitPolicyTests(WebApplicationFactory<Program> factory) => this.factory = factory;

    [Fact]
    public void Locked_defaults_match_the_agreed_policy_table()
    {
        Assert.Equal(5, AuthRateLimiting.PermitLimit);
        Assert.Equal(TimeSpan.FromMinutes(15), AuthRateLimiting.Window);
        Assert.Equal(30, AuthRateLimiting.RefreshPermitLimit);
        Assert.Equal(TimeSpan.FromMinutes(15), AuthRateLimiting.RefreshWindow);
        Assert.Equal(120, AuthRateLimiting.PublicReadPermitLimit);
        Assert.Equal(TimeSpan.FromMinutes(1), AuthRateLimiting.PublicReadWindow);
        Assert.Equal(30, AuthRateLimiting.WritePermitLimit);
        Assert.Equal(TimeSpan.FromMinutes(1), AuthRateLimiting.WriteWindow);
        Assert.Equal(120, AuthRateLimiting.AuthenticatedReadPermitLimit);
        Assert.Equal(TimeSpan.FromMinutes(1), AuthRateLimiting.AuthenticatedReadWindow);
        Assert.Equal(10, AuthRateLimiting.RegistrationPermitLimit);
        Assert.Equal(TimeSpan.FromMinutes(1), AuthRateLimiting.RegistrationWindow);
        Assert.Equal(10, AuthRateLimiting.ExportPermitLimit);
        Assert.Equal(TimeSpan.FromHours(1), AuthRateLimiting.ExportWindow);
        Assert.Equal(60, AuthRateLimiting.AdminPermitLimit);
        Assert.Equal(TimeSpan.FromMinutes(1), AuthRateLimiting.AdminWindow);
    }

    [Fact]
    public void Production_defaults_are_the_locked_values_and_local_runs_relax_only_volume_buckets()
    {
        var empty = new ConfigurationBuilder().Build();
        var production = RateLimitSettings.Load(empty);
        var local = RateLimitSettings.Load(empty, relaxedDefaults: true);
        var overridden = RateLimitSettings.Load(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [RateLimitSettings.PublicReadKey] = "7",
            [RateLimitSettings.AuthenticatedReadKey] = "5",
            [RateLimitSettings.AdminKey] = "3"
        }).Build(), relaxedDefaults: true);

        Assert.Equal(RateLimitSettings.Defaults, production);
        Assert.Equal(AuthRateLimiting.PermitLimit, local.AuthPermitLimit);
        Assert.Equal(AuthRateLimiting.RegistrationPermitLimit, local.RegistrationPermitLimit);
        Assert.Equal(AuthRateLimiting.ExportPermitLimit, local.ExportPermitLimit);
        Assert.Equal(RateLimitSettings.RelaxedPermitLimit, local.PublicReadPermitLimit);
        Assert.Equal(RateLimitSettings.RelaxedPermitLimit, local.WritePermitLimit);
        Assert.Equal(RateLimitSettings.RelaxedPermitLimit, local.AuthenticatedReadPermitLimit);
        Assert.Equal(RateLimitSettings.RelaxedPermitLimit, local.AdminPermitLimit);
        Assert.Equal(RateLimitSettings.RelaxedPermitLimit, local.RefreshPermitLimit);
        Assert.Equal(7, overridden.PublicReadPermitLimit);
        Assert.Equal(3, overridden.AdminPermitLimit);
        Assert.Equal(5, overridden.AuthenticatedReadPermitLimit);
    }

    [Fact]
    public void Limiter_partition_keys_are_hashed_and_never_contain_the_raw_identifier()
    {
        const string secret = "user@example.test";
        var hashed = Gones.Infrastructure.Observability.TelemetryRedaction.HashRateLimitKey($"write:{secret}");

        Assert.DoesNotContain(secret, hashed, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("write:", hashed, StringComparison.Ordinal);
        Assert.Equal(hashed, Gones.Infrastructure.Observability.TelemetryRedaction.HashRateLimitKey($"write:{secret}"));
        Assert.NotEqual(hashed, Gones.Infrastructure.Observability.TelemetryRedaction.HashRateLimitKey($"write:other@example.test"));
    }

    [Fact]
    public async Task Anonymous_reads_are_limited_per_client_with_429_and_retry_after()
    {
        using var client = CreateClient((RateLimitSettings.PublicReadKey, "3"));

        var statuses = new List<HttpResponseMessage>();
        for (var attempt = 0; attempt < 5; attempt++) statuses.Add(await client.GetAsync("/api/_contract/public-read"));
        try
        {
            Assert.Equal(3, statuses.Count(response => response.StatusCode == HttpStatusCode.OK));
            var rejected = statuses.Where(response => response.StatusCode == HttpStatusCode.TooManyRequests).ToArray();
            Assert.Equal(2, rejected.Length);
            foreach (var response in rejected)
            {
                Assert.Equal("rate_limited", await ProblemCode(response));
                var retryAfter = Assert.Single(response.Headers.GetValues("Retry-After"));
                Assert.True(int.TryParse(retryAfter, out var seconds) && seconds > 0, $"Retry-After must be positive seconds, was '{retryAfter}'.");
                Assert.True(seconds <= AuthRateLimiting.PublicReadWindow.TotalSeconds);
            }
        }
        finally
        {
            foreach (var response in statuses) response.Dispose();
        }
    }

    [Fact]
    public async Task Authenticated_reads_outside_admin_are_limited_per_user_with_429_and_retry_after()
    {
        using var client = CreateClient((RateLimitSettings.AuthenticatedReadKey, "3"));
        var user = Guid.NewGuid().ToString("D");

        var responses = new List<HttpResponseMessage>();
        for (var attempt = 0; attempt < 5; attempt++) responses.Add(await GetAuthenticatedReadAsync(client, user));
        try
        {
            Assert.Equal(3, responses.Count(response => response.StatusCode == HttpStatusCode.OK));
            var rejected = responses.Where(response => response.StatusCode == HttpStatusCode.TooManyRequests).ToArray();
            Assert.Equal(2, rejected.Length);
            foreach (var response in rejected)
            {
                Assert.Equal("rate_limited", await ProblemCode(response));
                var retryAfter = Assert.Single(response.Headers.GetValues("Retry-After"));
                Assert.True(int.TryParse(retryAfter, out var seconds) && seconds > 0, $"Retry-After must be positive seconds, was '{retryAfter}'.");
                Assert.True(seconds <= AuthRateLimiting.AuthenticatedReadWindow.TotalSeconds);
            }
        }
        finally
        {
            foreach (var response in responses) response.Dispose();
        }
    }

    [Fact]
    public async Task Authenticated_reads_do_not_leak_across_users_or_throttle_anonymous_reads()
    {
        using var client = CreateClient((RateLimitSettings.AuthenticatedReadKey, "1"));
        var first = Guid.NewGuid().ToString("D");
        var second = Guid.NewGuid().ToString("D");

        using var firstOk = await GetAuthenticatedReadAsync(client, first);
        using var firstRejected = await GetAuthenticatedReadAsync(client, first);
        using var secondOk = await GetAuthenticatedReadAsync(client, second);
        using var anonymous = await client.GetAsync("/api/_contract/public-read");

        Assert.Equal(HttpStatusCode.OK, firstOk.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, firstRejected.StatusCode);
        Assert.Equal(HttpStatusCode.OK, secondOk.StatusCode);
        Assert.Equal(HttpStatusCode.OK, anonymous.StatusCode);
    }

    [Fact]
    public async Task Authenticated_writes_are_limited_per_user_and_do_not_leak_across_users()
    {
        using var client = CreateClient((RateLimitSettings.WriteKey, "2"));
        var first = Guid.NewGuid().ToString("D");
        var second = Guid.NewGuid().ToString("D");

        var firstUser = new List<HttpStatusCode>();
        for (var attempt = 0; attempt < 4; attempt++) firstUser.Add(await PostEchoAsync(client, first));
        var secondUser = await PostEchoAsync(client, second);

        Assert.Equal(2, firstUser.Count(status => status == HttpStatusCode.OK));
        Assert.Equal(2, firstUser.Count(status => status == HttpStatusCode.TooManyRequests));
        Assert.Equal(HttpStatusCode.OK, secondUser);
    }

    [Fact]
    public async Task Admin_surface_uses_its_own_bucket_separate_from_writes()
    {
        using var client = CreateClient((RateLimitSettings.AdminKey, "1"), (RateLimitSettings.WriteKey, "50"));
        var user = Guid.NewGuid().ToString("D");

        var firstAdmin = await GetAdminProbeAsync(client, user);
        var secondAdmin = await GetAdminProbeAsync(client, user);
        var write = await PostEchoAsync(client, user);

        Assert.NotEqual(HttpStatusCode.TooManyRequests, firstAdmin);
        Assert.Equal(HttpStatusCode.TooManyRequests, secondAdmin);
        Assert.Equal(HttpStatusCode.OK, write);
    }

    [Theory]
    [InlineData("POST", "/api/auth/refresh", AuthRateLimiting.RefreshPolicy)]
    [InlineData("POST", "/api/auth/login", AuthRateLimiting.IpPolicy)]
    [InlineData("POST", "/api/auth/register", AuthRateLimiting.IpPolicy)]
    [InlineData("POST", "/api/auth/forgot-password", AuthRateLimiting.IpPolicy)]
    [InlineData("POST", "/api/auth/reset-password", AuthRateLimiting.IpPolicy)]
    [InlineData("POST", "/api/auth/resend-verification", AuthRateLimiting.IpPolicy)]
    public void Auth_endpoints_declare_their_locked_policy(string method, string route, string policy)
    {
        var endpoints = AuthEnabledEndpoints();
        var match = endpoints.Single(endpoint =>
            endpoint.RoutePattern.RawText == route
            && endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Routing.IHttpMethodMetadata>()!.HttpMethods.Contains(method));

        var attached = match.Metadata.GetMetadata<Microsoft.AspNetCore.RateLimiting.EnableRateLimitingAttribute>();
        Assert.NotNull(attached);
        Assert.Equal(policy, attached!.PolicyName);
    }

    private IReadOnlyList<Microsoft.AspNetCore.Routing.RouteEndpoint> AuthEnabledEndpoints()
    {
        using var authFactory = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "integration-only-signing-key-for-rate-limit-metadata");
            // Routes are only mapped when persistence is configured; the DSN is never connected to
            // because this test inspects the route table rather than issuing requests.
            builder.UseSetting("GONES_DB_CONNECTION", "Host=127.0.0.1;Port=1;Database=gones;Username=none;Password=none");
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
        });
        _ = authFactory.CreateClient();
        return authFactory.Services
            .GetRequiredService<Microsoft.AspNetCore.Routing.EndpointDataSource>()
            .Endpoints.OfType<Microsoft.AspNetCore.Routing.RouteEndpoint>()
            .ToArray();
    }

    [Fact]
    public async Task Non_api_paths_are_not_throttled_by_the_global_limiter()
    {
        using var client = CreateClient((RateLimitSettings.PublicReadKey, "1"));

        for (var attempt = 0; attempt < 5; attempt++)
        {
            using var response = await client.GetAsync("/health/live");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }

    [Fact]
    public async Task Rate_limit_rejection_still_returns_429_when_the_audit_write_fails()
    {
        // Auth runs against an unreachable DSN, so the rejection audit write cannot succeed. ADR 0017
        // declares that write best-effort, so the documented 429 contract must survive its failure.
        using var authFactory = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "integration-only-signing-key-for-rate-limit-audit");
            builder.UseSetting("GONES_DB_CONNECTION", "Host=127.0.0.1;Port=1;Database=gones;Username=none;Password=none");
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting(RateLimitSettings.AuthKey, "1");
        });
        using var client = authFactory.CreateClient();

        // The first call spends the single permit; its own status depends on the dead database and is not the subject here.
        using var spent = await PostLoginAsync(client);
        using var rejected = await PostLoginAsync(client);

        Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
        Assert.Equal("rate_limited", await ProblemCode(rejected));
        var retryAfter = Assert.Single(rejected.Headers.GetValues("Retry-After"));
        Assert.True(int.TryParse(retryAfter, out var seconds) && seconds > 0, $"Retry-After must be positive seconds, was '{retryAfter}'.");
    }

    [Fact]
    public void Only_the_auth_surface_earns_a_rejection_audit()
    {
        Assert.True(AuthRateLimiting.ShouldAuditRejection(new PathString("/api/auth/login")));
        Assert.True(AuthRateLimiting.ShouldAuditRejection(new PathString("/api/auth/refresh")));
        Assert.False(AuthRateLimiting.ShouldAuditRejection(new PathString("/api/_contract/public-read")));
        Assert.False(AuthRateLimiting.ShouldAuditRejection(new PathString("/api/admin/x")));
        Assert.False(AuthRateLimiting.ShouldAuditRejection(new PathString("/api/leagues")));
        Assert.False(AuthRateLimiting.ShouldAuditRejection(new PathString("/health/live")));
    }

    private HttpClient CreateClient(params (string Key, string Value)[] settings) =>
        factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            foreach (var (key, value) in settings) builder.UseSetting(key, value);
        }).CreateClient();

    private static async Task<HttpStatusCode> PostEchoAsync(HttpClient client, string userId)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/_contract/echo")
        {
            Content = JsonContent.Create(new { value = "x" })
        };
        request.Headers.Add("X-Test-User", userId);
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    private static async Task<HttpStatusCode> GetAdminProbeAsync(HttpClient client, string userId)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/admin/does-not-exist");
        request.Headers.Add("X-Test-User", userId);
        request.Headers.Add("X-Test-Roles", "Admin");
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    private static async Task<HttpResponseMessage> PostLoginAsync(HttpClient client) =>
        await client.PostAsync("/api/auth/login", JsonContent.Create(new { email = "limit@example.test", password = "irrelevant-password-1!" }));

    private static async Task<HttpResponseMessage> GetAuthenticatedReadAsync(HttpClient client, string userId)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/_contract/public-read");
        request.Headers.Add("X-Test-User", userId);
        return await client.SendAsync(request);
    }

    private static async Task<string?> ProblemCode(HttpResponseMessage response)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        return problem.GetProperty("code").GetString();
    }
}
