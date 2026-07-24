using Gones.Infrastructure.Configuration;
using Microsoft.Extensions.Configuration;

namespace Gones.IntegrationTests;

public sealed class RuntimeConfigurationTests
{
    [Fact]
    public void Legacy_static_mode_defaults_every_feature_off()
    {
        var runtime = GonesRuntimeConfiguration.Load(Build([]), false);

        Assert.False(runtime.Features.AnyServerFeature);
    }

    [Theory]
    [InlineData("API_BACKEND", 0)]
    [InlineData("CALENDAR_V1", 1)]
    [InlineData("AUTH_V1", 2)]
    [InlineData("LEAGUE_SERVER", 3)]
    [InlineData("LIVE_SERVER", 4)]
    [InlineData("ADMIN_V1", 5)]
    public void Every_feature_key_maps_to_typed_flag(string key, int expectedIndex)
    {
        var values = new Dictionary<string, string?>
        {
            [$"GONES_FEATURES:{key}"] = "true",
            ["GONES_DB_CONNECTION"] = "Host=db",
            ["GONES_ALLOWED_ORIGINS"] = "https://app.example",
            ["GONES_AUTH_SIGNING_KEY"] = new string('x', 32),
            ["GONES_AUTH_PROVIDER"] = "Local"
        };

        var flags = GonesRuntimeConfiguration.Load(Build(values), false).Features;
        var actual = new[] { flags.ApiBackend, flags.CalendarV1, flags.AuthV1, flags.LeagueServer, flags.LiveServer, flags.AdminV1 };
        var expected = new bool[6];
        expected[expectedIndex] = true;
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void Invalid_feature_boolean_fails_startup()
    {
        var error = Assert.Throws<InvalidOperationException>(() => GonesRuntimeConfiguration.Load(Build(new()
        {
            ["GONES_FEATURES:API_BACKEND"] = "sometimes"
        }), false));

        Assert.Contains("must be true or false", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Enabled_server_feature_requires_database_and_origin()
    {
        var missingDatabase = Assert.Throws<InvalidOperationException>(() => GonesRuntimeConfiguration.Load(Build(new()
        {
            ["GONES_FEATURES:CALENDAR_V1"] = "true"
        }), false));
        var missingOrigin = Assert.Throws<InvalidOperationException>(() => GonesRuntimeConfiguration.Load(Build(new()
        {
            ["GONES_FEATURES:CALENDAR_V1"] = "true",
            ["GONES_DB_CONNECTION"] = "Host=db"
        }), false));

        Assert.Contains("GONES_DB_CONNECTION", missingDatabase.Message, StringComparison.Ordinal);
        Assert.Contains("GONES_ALLOWED_ORIGINS", missingOrigin.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Fake_auth_provider_is_development_only()
    {
        var values = new Dictionary<string, string?>
        {
            ["GONES_FEATURES:AUTH_V1"] = "true",
            ["GONES_DB_CONNECTION"] = "Host=db",
            ["GONES_ALLOWED_ORIGINS"] = "https://app.example",
            ["GONES_AUTH_SIGNING_KEY"] = new string('x', 32),
            ["GONES_AUTH_PROVIDER"] = "fake"
        };

        Assert.Throws<InvalidOperationException>(() => GonesRuntimeConfiguration.Load(Build(values), false));
        var development = GonesRuntimeConfiguration.Load(Build(values), true);
        Assert.True(development.Features.AuthV1);
        Assert.Equal(GonesAuthProvider.Fake, development.AuthProvider);
    }

    [Theory]
    [InlineData(null, "Local", "GONES_AUTH_SIGNING_KEY")]
    [InlineData("short", "Local", "at least 32")]
    [InlineData("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", null, "GONES_AUTH_PROVIDER")]
    [InlineData("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "Typo", "must be Local, Fake, or External")]
    [InlineData("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "999", "must be Local, Fake, or External")]
    public void Invalid_auth_configuration_fails_startup(string? signingKey, string? provider, string expected)
    {
        var values = new Dictionary<string, string?>
        {
            ["GONES_FEATURES:AUTH_V1"] = "true",
            ["GONES_DB_CONNECTION"] = "Host=db",
            ["GONES_ALLOWED_ORIGINS"] = "https://app.example",
            ["GONES_AUTH_SIGNING_KEY"] = signingKey,
            ["GONES_AUTH_PROVIDER"] = provider
        };

        var error = Assert.Throws<InvalidOperationException>(() => GonesRuntimeConfiguration.Load(Build(values), false));
        Assert.Contains(expected, error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("Local", GonesAuthProvider.Local)]
    [InlineData("External", GonesAuthProvider.External)]
    public void Supported_auth_provider_is_valid_in_production(string provider, GonesAuthProvider expected)
    {
        var runtime = GonesRuntimeConfiguration.Load(Build(new()
        {
            ["GONES_FEATURES:AUTH_V1"] = "true",
            ["GONES_DB_CONNECTION"] = "Host=db",
            ["GONES_ALLOWED_ORIGINS"] = "https://app.example",
            ["GONES_AUTH_SIGNING_KEY"] = new string('x', 32),
            ["GONES_AUTH_PROVIDER"] = provider
        }), false);

        Assert.Equal(expected, runtime.AuthProvider);
    }

    private static IConfiguration Build(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
