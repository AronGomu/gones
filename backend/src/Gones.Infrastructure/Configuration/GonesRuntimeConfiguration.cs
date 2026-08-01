using Microsoft.Extensions.Configuration;

namespace Gones.Infrastructure.Configuration;

public sealed record GonesFeatureFlags(
    bool ApiBackend,
    bool CalendarV1,
    bool AuthV1,
    bool LeagueServer,
    bool LiveServer,
    bool AdminV1)
{
    public bool AnyServerFeature => ApiBackend || CalendarV1 || AuthV1 || LeagueServer || LiveServer || AdminV1;
}

public enum GonesAuthProvider
{
    Local,
    Fake,
    External
}

public sealed record GonesRuntimeConfiguration(GonesFeatureFlags Features, GonesAuthProvider? AuthProvider)
{
    public static GonesRuntimeConfiguration Load(IConfiguration configuration, bool isDevelopment)
    {
        var flags = new GonesFeatureFlags(
            ReadBoolean(configuration, "GONES_FEATURES:API_BACKEND"),
            ReadBoolean(configuration, "GONES_FEATURES:CALENDAR_V1"),
            ReadBoolean(configuration, "GONES_FEATURES:AUTH_V1"),
            ReadBoolean(configuration, "GONES_FEATURES:LEAGUE_SERVER"),
            ReadBoolean(configuration, "GONES_FEATURES:LIVE_SERVER"),
            ReadBoolean(configuration, "GONES_FEATURES:ADMIN_V1"));

        if (flags.AnyServerFeature)
        {
            Require(configuration, "GONES_DB_CONNECTION");
            Require(configuration, "GONES_ALLOWED_ORIGINS");
        }

        GonesAuthProvider? authProvider = null;
        if (flags.AdminV1 && !flags.AuthV1)
        {
            throw new InvalidOperationException("GONES_FEATURES:ADMIN_V1 requires GONES_FEATURES:AUTH_V1.");
        }

        if (flags.AuthV1)
        {
            var signingKey = Require(configuration, "GONES_AUTH_SIGNING_KEY");
            if (signingKey.Length < 32) throw new InvalidOperationException("GONES_AUTH_SIGNING_KEY must contain at least 32 characters.");
            var provider = Require(configuration, "GONES_AUTH_PROVIDER");
            if (!Enum.TryParse<GonesAuthProvider>(provider, true, out var parsedProvider) || !Enum.IsDefined(parsedProvider))
            {
                throw new InvalidOperationException("GONES_AUTH_PROVIDER must be Local, Fake, or External.");
            }
            authProvider = parsedProvider;
            if (authProvider == GonesAuthProvider.Fake && !isDevelopment)
            {
                throw new InvalidOperationException("Fake auth provider is allowed only in Development or Testing.");
            }
        }

        return new GonesRuntimeConfiguration(flags, authProvider);
    }

    private static bool ReadBoolean(IConfiguration configuration, string key)
    {
        var raw = configuration[key];
        if (string.IsNullOrWhiteSpace(raw)) return false;
        return bool.TryParse(raw, out var value)
            ? value
            : throw new InvalidOperationException($"{key} must be true or false.");
    }

    private static string Require(IConfiguration configuration, string key)
    {
        var value = configuration[key];
        return !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new InvalidOperationException($"{key} is required when its feature is enabled.");
    }
}
