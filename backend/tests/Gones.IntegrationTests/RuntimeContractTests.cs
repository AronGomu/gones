using System.Net;
using Gones.Api.Security;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Identity;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Gones.IntegrationTests;

/// <summary>
/// C41 runtime contract: the images must be configurable from a generic Linux container host with
/// nothing but environment variables, mounted secret files, and a TLS-terminating reverse proxy.
/// </summary>
public sealed class RuntimeContractTests
{
    [Fact]
    public void Secret_files_inject_database_and_signing_key_without_environment_values()
    {
        var connectionFile = Path.GetTempFileName();
        var signingKeyFile = Path.GetTempFileName();
        try
        {
            File.WriteAllText(connectionFile, "Host=db;Database=gones\n");
            File.WriteAllText(signingKeyFile, $"{new string('k', 40)}\n");
            var configuration = Build(new()
            {
                ["GONES_DB_CONNECTION_FILE"] = connectionFile,
                ["GONES_AUTH_SIGNING_KEY_FILE"] = signingKeyFile
            });

            var resolved = GonesSecretFiles.Resolve(configuration);

            Assert.Equal("Host=db;Database=gones", resolved["GONES_DB_CONNECTION"]);
            Assert.Equal(new string('k', 40), resolved["GONES_AUTH_SIGNING_KEY"]);
        }
        finally
        {
            File.Delete(connectionFile);
            File.Delete(signingKeyFile);
        }
    }

    [Fact]
    public void Secret_file_injection_fails_closed_on_ambiguous_missing_or_empty_input()
    {
        var emptyFile = Path.GetTempFileName();
        try
        {
            var ambiguous = Assert.Throws<InvalidOperationException>(() => GonesSecretFiles.Resolve(Build(new()
            {
                ["GONES_DB_CONNECTION"] = "Host=db",
                ["GONES_DB_CONNECTION_FILE"] = emptyFile
            })));
            var missing = Assert.Throws<InvalidOperationException>(() => GonesSecretFiles.Resolve(Build(new()
            {
                ["GONES_AUTH_SIGNING_KEY_FILE"] = Path.Combine(Path.GetTempPath(), $"gones-missing-{Guid.NewGuid():N}")
            })));
            var empty = Assert.Throws<InvalidOperationException>(() => GonesSecretFiles.Resolve(Build(new()
            {
                ["GONES_AUTH_SIGNING_KEY_FILE"] = emptyFile
            })));

            Assert.Contains("only one of", ambiguous.Message, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("could not be read", missing.Message, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("empty", empty.Message, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            File.Delete(emptyFile);
        }
    }

    [Fact]
    public void Secret_file_keys_never_widen_to_arbitrary_configuration()
    {
        Assert.Equal(
        [
            "GONES_DB_CONNECTION",
            "GONES_AUTH_SIGNING_KEY",
            "GONES_EVENT_IMAGES_S3_ACCESS_KEY",
            "GONES_EVENT_IMAGES_S3_SECRET_KEY"
        ],
        GonesSecretFiles.SupportedKeys);
    }

    [Fact]
    public void Graceful_shutdown_window_is_configurable_and_bounded()
    {
        Assert.Equal(TimeSpan.FromSeconds(25), GonesHostRuntime.LoadShutdownTimeout(Build([])));
        Assert.Equal(TimeSpan.FromSeconds(40), GonesHostRuntime.LoadShutdownTimeout(Build(new() { ["GONES_SHUTDOWN_TIMEOUT_SECONDS"] = "40" })));
        Assert.Throws<InvalidOperationException>(() => GonesHostRuntime.LoadShutdownTimeout(Build(new() { ["GONES_SHUTDOWN_TIMEOUT_SECONDS"] = "0" })));
        Assert.Throws<InvalidOperationException>(() => GonesHostRuntime.LoadShutdownTimeout(Build(new() { ["GONES_SHUTDOWN_TIMEOUT_SECONDS"] = "soon" })));
    }

    [Fact]
    public void Forwarded_proxy_configuration_is_disabled_until_explicit_proxies_are_declared()
    {
        Assert.False(ForwardedProxySettings.Load(Build([])).Enabled);

        var settings = ForwardedProxySettings.Load(Build(new()
        {
            [ForwardedProxySettings.ProxiesKey] = "10.9.0.2, 172.18.0.0/16",
            [ForwardedProxySettings.HopLimitKey] = "2"
        }));

        Assert.True(settings.Enabled);
        Assert.Equal([IPAddress.Parse("10.9.0.2")], settings.KnownProxies);
        Assert.Single(settings.KnownNetworks);
        Assert.Equal(2, settings.HopLimit);
    }

    [Theory]
    [InlineData("not-an-ip", ForwardedProxySettings.ProxiesKey)]
    [InlineData("10.9.0.2/99", ForwardedProxySettings.ProxiesKey)]
    [InlineData("*", ForwardedProxySettings.ProxiesKey)]
    public void Invalid_forwarded_proxy_entry_fails_startup(string value, string key)
    {
        var error = Assert.Throws<InvalidOperationException>(() => ForwardedProxySettings.Load(Build(new() { [key] = value })));

        Assert.Contains(key, error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("13")]
    [InlineData("many")]
    public void Invalid_forwarded_hop_limit_fails_startup(string value)
    {
        Assert.Throws<InvalidOperationException>(() => ForwardedProxySettings.Load(Build(new()
        {
            [ForwardedProxySettings.ProxiesKey] = "10.9.0.2",
            [ForwardedProxySettings.HopLimitKey] = value
        })));
    }

    [Fact]
    public async Task Trusted_proxy_forwards_scheme_so_transport_security_is_emitted()
    {
        using var factory = CreateFactory("10.9.0.2", "10.9.0.2");
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health/live");
        request.Headers.Add("X-Forwarded-Proto", "https");

        using var response = await client.SendAsync(request);

        Assert.True(response.Headers.Contains("Strict-Transport-Security"));
    }

    [Fact]
    public async Task Untrusted_hop_cannot_spoof_the_forwarded_scheme()
    {
        using var factory = CreateFactory("10.9.0.2", "203.0.113.7");
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health/live");
        request.Headers.Add("X-Forwarded-Proto", "https");

        using var response = await client.SendAsync(request);

        Assert.False(response.Headers.Contains("Strict-Transport-Security"));
    }

    [Fact]
    public async Task Trusted_proxy_restores_client_ip_fidelity_for_the_public_read_limiter()
    {
        using var factory = CreateFactory("10.9.0.2", "10.9.0.2", publicReadPermitLimit: 1);
        using var client = factory.CreateClient();

        var first = await GetAsync(client, "198.51.100.10");
        var second = await GetAsync(client, "198.51.100.10");
        var otherClient = await GetAsync(client, "198.51.100.11");

        Assert.Equal(HttpStatusCode.NotFound, first);
        Assert.Equal(HttpStatusCode.TooManyRequests, second);
        Assert.Equal(HttpStatusCode.NotFound, otherClient);
    }

    [Fact]
    public async Task Without_trusted_proxies_every_forwarded_client_shares_one_partition()
    {
        using var factory = CreateFactory(proxies: null, remoteIp: "10.9.0.2", publicReadPermitLimit: 1);
        using var client = factory.CreateClient();

        var first = await GetAsync(client, "198.51.100.10");
        var second = await GetAsync(client, "198.51.100.11");

        Assert.Equal(HttpStatusCode.NotFound, first);
        Assert.Equal(HttpStatusCode.TooManyRequests, second);
    }

    [Fact]
    public void Self_hosted_identity_endpoints_may_be_overridden_with_exact_https_uris()
    {
        var values = ExternalOAuthValues();
        values["GONES_OAUTH_GOOGLE_AUTHORIZATION_ENDPOINT"] = "https://idp.internal/authorize";
        values["GONES_OAUTH_GOOGLE_TOKEN_ENDPOINT"] = "https://idp.internal/token";
        values["GONES_OAUTH_GOOGLE_USERINFO_ENDPOINT"] = "https://idp.internal/userinfo";
        var configuration = Build(values);
        var runtime = GonesRuntimeConfiguration.Load(configuration, false);

        var options = ExternalOAuthOptions.Load(configuration, runtime);

        Assert.Equal("https://idp.internal/authorize", options.Providers["google"].AuthorizationEndpoint.ToString());
        Assert.Equal("https://idp.internal/token", options.Providers["google"].TokenEndpoint.ToString());
        Assert.Equal("https://idp.internal/userinfo", options.Providers["google"].UserInformationEndpoint.ToString());
        Assert.Equal("https://www.facebook.com/v22.0/dialog/oauth", options.Providers["facebook"].AuthorizationEndpoint.ToString());
    }

    [Theory]
    [InlineData("http://idp.internal/authorize")]
    [InlineData("idp.internal/authorize")]
    public void Insecure_identity_endpoint_override_fails_startup(string endpoint)
    {
        var values = ExternalOAuthValues();
        values["GONES_OAUTH_GOOGLE_AUTHORIZATION_ENDPOINT"] = endpoint;
        var configuration = Build(values);
        var runtime = GonesRuntimeConfiguration.Load(configuration, false);

        var error = Assert.Throws<InvalidOperationException>(() => ExternalOAuthOptions.Load(configuration, runtime));

        Assert.Contains("GONES_OAUTH_GOOGLE_AUTHORIZATION_ENDPOINT", error.Message, StringComparison.Ordinal);
    }

    private static async Task<HttpStatusCode> GetAsync(HttpClient client, string forwardedFor)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/gones-runtime-contract-probe");
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    private static Dictionary<string, string?> ExternalOAuthValues() => new()
    {
        ["GONES_FEATURES:AUTH_V1"] = "true",
        ["GONES_DB_CONNECTION"] = "Host=db",
        ["GONES_ALLOWED_ORIGINS"] = "https://app.example",
        ["GONES_AUTH_SIGNING_KEY"] = new string('x', 32),
        ["GONES_AUTH_PROVIDER"] = "External",
        ["GONES_OAUTH_CALLBACK_ORIGIN"] = "https://oauth.example",
        ["GONES_GOOGLE_CLIENT_ID"] = "google-client",
        ["GONES_GOOGLE_CLIENT_SECRET"] = "google-secret",
        ["GONES_FACEBOOK_CLIENT_ID"] = "facebook-client",
        ["GONES_FACEBOOK_CLIENT_SECRET"] = "facebook-secret"
    };

    private static WebApplicationFactory<Program> CreateFactory(string? proxies, string remoteIp, int? publicReadPermitLimit = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting(ForwardedProxySettings.ProxiesKey, proxies ?? string.Empty);
            if (publicReadPermitLimit is not null)
            {
                builder.UseSetting(RateLimitSettings.PublicReadKey, publicReadPermitLimit.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
            }
            builder.ConfigureTestServices(services => services.AddSingleton<IStartupFilter>(new RemoteIpStartupFilter(IPAddress.Parse(remoteIp))));
        });

    private static IConfiguration Build(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    /// <summary>TestServer has no socket, so the simulated edge hop is injected ahead of the whole pipeline.</summary>
    private sealed class RemoteIpStartupFilter(IPAddress remoteIp) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use(async (context, following) =>
            {
                context.Connection.RemoteIpAddress = remoteIp;
                await following();
            });
            next(app);
        };
    }
}
