using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Gones.IntegrationTests;

public sealed class ApiBoundaryTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> factory;
    private readonly HttpClient client;

    public ApiBoundaryTests(WebApplicationFactory<Program> factory)
    {
        this.factory = factory;
        client = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Testing")).CreateClient();
    }

    [Fact]
    public async Task Malformed_json_returns_safe_problem_details()
    {
        using var content = new StringContent("{", Encoding.UTF8, "application/json");
        using var response = await client.PostAsync("/api/_contract/echo", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("malformed_request", await ProblemCode(response));
    }

    [Fact]
    public async Task Validation_returns_field_map()
    {
        using var response = await client.PostAsJsonAsync("/api/_contract/validate", new { name = "x" });
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("validation_failed", problem.GetProperty("code").GetString());
        Assert.True(problem.GetProperty("errors").TryGetProperty("Name", out _));
    }

    [Fact]
    public async Task Valid_input_reaches_endpoint()
    {
        using var response = await client.PostAsJsonAsync("/api/_contract/validate", new { name = "valid" });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("valid", body.GetProperty("name").GetString());
    }

    [Theory]
    [InlineData("auth", HttpStatusCode.Unauthorized, "unauthorized")]
    [InlineData("forbidden", HttpStatusCode.Forbidden, "forbidden")]
    [InlineData("missing", HttpStatusCode.NotFound, "not_found")]
    [InlineData("stale", HttpStatusCode.PreconditionFailed, "stale_version")]
    [InlineData("conflict", HttpStatusCode.Conflict, "conflict")]
    public async Task Boundary_statuses_use_stable_codes(string path, HttpStatusCode status, string code)
    {
        using var response = await client.GetAsync($"/api/_contract/{path}");

        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, await ProblemCode(response));
    }

    [Fact]
    public async Task Authenticated_user_satisfies_user_policy()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/_contract/auth");
        request.Headers.Add("X-Test-User", Guid.NewGuid().ToString("D"));
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Theory]
    [InlineData("organizer", "Organizer", HttpStatusCode.NoContent)]
    [InlineData("organizer", "Admin", HttpStatusCode.NoContent)]
    [InlineData("organizer", "User", HttpStatusCode.Forbidden)]
    [InlineData("organization-member", "Admin", HttpStatusCode.Forbidden)]
    [InlineData("organization-owner", "Admin", HttpStatusCode.Forbidden)]
    public async Task Role_policies_enforce_current_claim_contract(string endpoint, string role, HttpStatusCode expected)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/_contract/{endpoint}");
        request.Headers.Add("X-Test-User", Guid.NewGuid().ToString("D"));
        request.Headers.Add("X-Test-Roles", role);
        using var response = await client.SendAsync(request);

        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task Wrong_role_is_forbidden_by_policy()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/_contract/admin");
        request.Headers.Add("X-Test-User", Guid.NewGuid().ToString("D"));
        request.Headers.Add("X-Test-Roles", "User");
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("forbidden", await ProblemCode(response));
    }

    [Fact]
    public async Task Oversized_api_body_returns_413()
    {
        using var content = new StringContent(new string('x', 1_048_577), Encoding.UTF8, "application/json");
        using var response = await client.PostAsync("/api/_contract/echo", content);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal("request_too_large", await ProblemCode(response));
    }

    [Fact]
    public async Task Unknown_length_oversized_body_returns_413()
    {
        using var content = new UnknownLengthContent(new string('x', 1_048_577));
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        using var response = await client.PostAsync("/api/_contract/echo", content);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal("request_too_large", await ProblemCode(response));
    }

    [Fact]
    public async Task Json_depth_limit_is_enforced()
    {
        static string Nested(int depth) => $"{{\"value\":{new string('[', depth)}0{new string(']', depth)}}}";
        using var accepted = new StringContent(Nested(30), Encoding.UTF8, "application/json");
        using var acceptedResponse = await client.PostAsync("/api/_contract/json", accepted);
        using var rejected = new StringContent(Nested(33), Encoding.UTF8, "application/json");
        using var rejectedResponse = await client.PostAsync("/api/_contract/json", rejected);

        Assert.Equal(HttpStatusCode.OK, acceptedResponse.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, rejectedResponse.StatusCode);
        Assert.Equal("malformed_request", await ProblemCode(rejectedResponse));
    }

    [Fact]
    public async Task Timestamps_require_offsets_and_serialize_as_utc()
    {
        using var valid = new StringContent("{\"timestamp\":\"2026-07-24T12:00:00+02:00\"}", Encoding.UTF8, "application/json");
        using var validResponse = await client.PostAsync("/api/_contract/timestamp", valid);
        var validBody = await validResponse.Content.ReadFromJsonAsync<JsonElement>();
        using var invalid = new StringContent("{\"timestamp\":\"2026-07-24T12:00:00\"}", Encoding.UTF8, "application/json");
        using var invalidResponse = await client.PostAsync("/api/_contract/timestamp", invalid);
        using var dateTime = new StringContent("{\"timestamp\":\"2026-07-24T12:00:00+02:00\"}", Encoding.UTF8, "application/json");
        using var dateTimeResponse = await client.PostAsync("/api/_contract/datetime", dateTime);
        var dateTimeBody = await dateTimeResponse.Content.ReadFromJsonAsync<JsonElement>();
        using var unspecifiedDateTime = new StringContent("{\"timestamp\":\"2026-07-24T12:00:00\"}", Encoding.UTF8, "application/json");
        using var unspecifiedResponse = await client.PostAsync("/api/_contract/datetime", unspecifiedDateTime);

        Assert.Equal(HttpStatusCode.OK, validResponse.StatusCode);
        Assert.StartsWith("2026-07-24T10:00:00", validBody.GetProperty("timestamp").GetString(), StringComparison.Ordinal);
        Assert.EndsWith("+00:00", validBody.GetProperty("timestamp").GetString(), StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.BadRequest, invalidResponse.StatusCode);
        Assert.Equal("malformed_request", await ProblemCode(invalidResponse));
        Assert.Equal(HttpStatusCode.OK, dateTimeResponse.StatusCode);
        Assert.StartsWith("2026-07-24T10:00:00", dateTimeBody.GetProperty("timestamp").GetString(), StringComparison.Ordinal);
        Assert.EndsWith("Z", dateTimeBody.GetProperty("timestamp").GetString(), StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.BadRequest, unspecifiedResponse.StatusCode);
        Assert.Equal("malformed_request", await ProblemCode(unspecifiedResponse));
    }

    [Fact]
    public async Task Cors_exposes_public_response_headers_to_allowed_frontend()
    {
        using var corsClient = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
        }).CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health/live");
        request.Headers.Add("Origin", "https://app.example");
        using var response = await corsClient.SendAsync(request);

        Assert.Equal("https://app.example", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        var exposedHeaders = response.Headers.GetValues("Access-Control-Expose-Headers").Single();
        Assert.Contains("Content-Disposition", exposedHeaders, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ETag", exposedHeaders, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task OpenApi_is_admin_protected_outside_development()
    {
        using var openApiClient = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_OPENAPI_ENABLED", "true");
        }).CreateClient();

        using var response = await openApiClient.GetAsync("/openapi/v1.json");
        using var userRequest = new HttpRequestMessage(HttpMethod.Get, "/openapi/v1.json");
        userRequest.Headers.Add("X-Test-User", Guid.NewGuid().ToString("D"));
        userRequest.Headers.Add("X-Test-Roles", "User");
        using var userResponse = await openApiClient.SendAsync(userRequest);
        using var adminRequest = new HttpRequestMessage(HttpMethod.Get, "/openapi/v1.json");
        adminRequest.Headers.Add("X-Test-User", Guid.NewGuid().ToString("D"));
        adminRequest.Headers.Add("X-Test-Roles", "Admin");
        using var adminResponse = await openApiClient.SendAsync(adminRequest);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("unauthorized", await ProblemCode(response));
        Assert.Equal(HttpStatusCode.Forbidden, userResponse.StatusCode);
        Assert.Equal("forbidden", await ProblemCode(userResponse));
        Assert.Equal(HttpStatusCode.OK, adminResponse.StatusCode);
        Assert.Equal("application/json", adminResponse.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Development_exposes_OpenApi_anonymously()
    {
        using var developmentClient = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Development")).CreateClient();

        using var response = await developmentClient.GetAsync("/openapi/v1.json");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Production_disables_test_auth_and_contract_routes()
    {
        using var productionClient = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Production")).CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/_contract/auth");
        request.Headers.Add("X-Test-User", Guid.NewGuid().ToString("D"));
        request.Headers.Add("X-Test-Roles", "Admin");
        using var response = await productionClient.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("not_found", await ProblemCode(response));
    }

    [Theory]
    [InlineData("bare-400", HttpStatusCode.BadRequest, "malformed_request")]
    [InlineData("bare-413", HttpStatusCode.RequestEntityTooLarge, "request_too_large")]
    [InlineData("bare-418", HttpStatusCode418, "request_failed")]
    [InlineData("bad-413", HttpStatusCode.RequestEntityTooLarge, "request_too_large")]
    public async Task Failure_routing_uses_stable_fallback_codes(string endpoint, HttpStatusCode status, string code)
    {
        using var response = await client.GetAsync($"/api/_contract/{endpoint}");

        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, await ProblemCode(response));
    }

    private const HttpStatusCode HttpStatusCode418 = (HttpStatusCode)418;

    [Fact]
    public async Task Unexpected_errors_do_not_leak_details()
    {
        using var response = await client.GetAsync("/api/_contract/boom");
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Contains("internal_error", body, StringComparison.Ordinal);
        Assert.DoesNotContain("sensitive SQL", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Boundary_logs_exclude_exception_message_and_pii()
    {
        var sink = new CollectingLoggerProvider();
        using var loggingClient = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureServices(services => services.AddLogging(logging =>
            {
                logging.ClearProviders();
                logging.AddProvider(sink);
            }));
        }).CreateClient();

        var correlationId = Guid.NewGuid().ToString("D");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/_contract/boom?email=user@example.test&token=token-secret-value");
        request.Headers.Add("X-Correlation-ID", correlationId);
        using var response = await loggingClient.SendAsync(request);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        var allLogChannels = string.Join('\n', sink.Records.SelectMany(record =>
            new[] { record.Message, record.Exception, string.Join(';', record.State), string.Join(';', record.Scopes) }));
        Assert.DoesNotContain("sensitive SQL", allLogChannels, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("user@example.test", allLogChannels, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token-secret-value", allLogChannels, StringComparison.OrdinalIgnoreCase);
        var completion = Assert.Single(sink.Records, record => record.Message.Contains("API boundary completed", StringComparison.Ordinal));
        var error = Assert.Single(sink.Records, record => record.Message.Contains("Unhandled API exception", StringComparison.Ordinal));
        Assert.Contains(completion.Scopes, scope => scope.Contains(correlationId, StringComparison.Ordinal));
        Assert.Contains(error.Scopes, scope => scope.Contains(correlationId, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Correlation_and_security_headers_are_returned()
    {
        var correlationId = Guid.NewGuid().ToString("D");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health/live");
        request.Headers.Add("X-Correlation-ID", correlationId);
        using var response = await client.SendAsync(request);

        Assert.Equal(correlationId, response.Headers.GetValues("X-Correlation-ID").Single());
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
        Assert.Contains("default-src 'none'", response.Headers.GetValues("Content-Security-Policy").Single(), StringComparison.Ordinal);

        using var apiResponse = await client.GetAsync("/api/_contract/missing");
        Assert.Contains("no-store", apiResponse.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Api_denies_every_unused_browser_capability_and_isolates_the_origin()
    {
        using var response = await client.GetAsync("/health/live");

        var csp = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("default-src 'none'", csp, StringComparison.Ordinal);
        Assert.Contains("frame-ancestors 'none'", csp, StringComparison.Ordinal);
        Assert.Contains("base-uri 'none'", csp, StringComparison.Ordinal);
        Assert.Contains("form-action 'none'", csp, StringComparison.Ordinal);

        var permissions = response.Headers.GetValues("Permissions-Policy").Single();
        foreach (var feature in new[] { "camera", "microphone", "geolocation", "payment", "usb", "display-capture", "publickey-credentials-get" })
        {
            Assert.Contains($"{feature}=()", permissions, StringComparison.Ordinal);
        }

        Assert.Equal("same-origin", response.Headers.GetValues("Cross-Origin-Opener-Policy").Single());
        Assert.Equal("same-site", response.Headers.GetValues("Cross-Origin-Resource-Policy").Single());
    }

    [Fact]
    public async Task Hsts_is_emitted_only_over_tls()
    {
        using var plain = await client.GetAsync("/health/live");
        using var secureClient = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Testing"))
            .CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        using var secure = await secureClient.GetAsync("/health/live");

        Assert.False(plain.Headers.Contains("Strict-Transport-Security"));
        var hsts = secure.Headers.GetValues("Strict-Transport-Security").Single();
        Assert.Contains("max-age=63072000", hsts, StringComparison.Ordinal);
        Assert.Contains("includeSubDomains", hsts, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Error_responses_keep_the_full_security_header_set()
    {
        using var response = await client.GetAsync("/api/_contract/boom");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.True(response.Headers.Contains("Content-Security-Policy"));
        Assert.True(response.Headers.Contains("Permissions-Policy"));
        Assert.True(response.Headers.Contains("Cross-Origin-Opener-Policy"));
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
    }

    [Fact]
    public async Task Unknown_route_uses_not_found_problem_contract()
    {
        using var response = await client.GetAsync("/does-not-exist");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("not_found", await ProblemCode(response));
    }

    [Theory]
    [InlineData("*")]
    [InlineData("file:///tmp/app")]
    [InlineData("https://app.example/")]
    [InlineData("https://app.example/path")]
    [InlineData("https://app.example?query=1")]
    [InlineData("https://user@app.example")]
    [InlineData("https://app.example/#fragment")]
    public void Invalid_cors_configuration_fails_startup(string origin)
    {
        using var invalidFactory = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_ALLOWED_ORIGINS", origin);
        });

        var error = Assert.ThrowsAny<Exception>(() => invalidFactory.CreateClient());
        Assert.Contains("must contain exact HTTP(S) origins", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Credentialed_cors_allows_only_exact_configured_origin()
    {
        using var corsClient = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
        }).CreateClient();
        using var allowed = new HttpRequestMessage(HttpMethod.Options, "/api/_contract/echo");
        allowed.Headers.Add("Origin", "https://app.example");
        allowed.Headers.Add("Access-Control-Request-Method", "POST");
        using var allowedResponse = await corsClient.SendAsync(allowed);
        using var denied = new HttpRequestMessage(HttpMethod.Options, "/api/_contract/echo");
        denied.Headers.Add("Origin", "https://attacker.example");
        denied.Headers.Add("Access-Control-Request-Method", "POST");
        using var deniedResponse = await corsClient.SendAsync(denied);
        using var oversized = new HttpRequestMessage(HttpMethod.Post, "/api/_contract/echo");
        oversized.Headers.Add("Origin", "https://app.example");
        oversized.Content = new StringContent(new string('x', 1_048_577), Encoding.UTF8, "application/json");
        using var oversizedResponse = await corsClient.SendAsync(oversized);

        Assert.Equal("https://app.example", allowedResponse.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal("true", allowedResponse.Headers.GetValues("Access-Control-Allow-Credentials").Single());
        Assert.False(deniedResponse.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, oversizedResponse.StatusCode);
        Assert.Equal("https://app.example", oversizedResponse.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    private sealed class UnknownLengthContent(string value) : HttpContent
    {
        private readonly byte[] bytes = Encoding.UTF8.GetBytes(value);

        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => stream.WriteAsync(bytes).AsTask();
        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
        }
    }

    private sealed class CollectingLoggerProvider : ILoggerProvider
    {
        private readonly AsyncLocal<IReadOnlyList<string>?> activeScopes = new();
        public ConcurrentBag<LogRecord> Records { get; } = [];
        public ILogger CreateLogger(string categoryName) => new CollectingLogger(this);
        public void Dispose() { }

        private IDisposable PushScope(string value)
        {
            var previous = activeScopes.Value;
            activeScopes.Value = [.. previous ?? [], value];
            return new Scope(this, previous);
        }

        private sealed class CollectingLogger(CollectingLoggerProvider provider) : ILogger
        {
            public IDisposable BeginScope<TState>(TState state) where TState : notnull
            {
                var text = state is IEnumerable<KeyValuePair<string, object>> values
                    ? string.Join(';', values.Select(value => $"{value.Key}={value.Value}"))
                    : state.ToString() ?? string.Empty;
                return provider.PushScope(text);
            }
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                var structuredState = state is IEnumerable<KeyValuePair<string, object?>> values
                    ? values.Select(value => $"{value.Key}={value.Value}").ToArray()
                    : [state?.ToString() ?? string.Empty];
                provider.Records.Add(new LogRecord(
                    formatter(state, exception),
                    exception?.ToString() ?? string.Empty,
                    structuredState,
                    provider.activeScopes.Value ?? []));
            }
        }

        private sealed class Scope(CollectingLoggerProvider provider, IReadOnlyList<string>? previous) : IDisposable
        {
            public void Dispose() => provider.activeScopes.Value = previous;
        }
    }

    private sealed record LogRecord(string Message, string Exception, IReadOnlyList<string> State, IReadOnlyList<string> Scopes);

    private static async Task<string?> ProblemCode(HttpResponseMessage response)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.True(response.Headers.Contains("X-Correlation-ID"));
        Assert.True(response.Headers.Contains("X-Content-Type-Options"));
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal((int)response.StatusCode, problem.GetProperty("status").GetInt32());
        Assert.Equal($"urn:gones:problem:{problem.GetProperty("code").GetString()}", problem.GetProperty("type").GetString());
        Assert.False(string.IsNullOrWhiteSpace(problem.GetProperty("title").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(problem.GetProperty("detail").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(problem.GetProperty("instance").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(problem.GetProperty("message").GetString()));
        Assert.True(problem.TryGetProperty("traceId", out _));
        return problem.GetProperty("code").GetString();
    }
}
