using Gones.Domain.Identity;
using Gones.Infrastructure.Configuration;
using Microsoft.Extensions.Configuration;

namespace Gones.Infrastructure.Identity;

public sealed class ExternalOAuthOptions
{
    private ExternalOAuthOptions(GonesAuthProvider mode, Uri? callbackOrigin, IReadOnlyDictionary<string, OAuthProviderOptions> providers)
    {
        Mode = mode;
        CallbackOrigin = callbackOrigin;
        Providers = providers;
    }

    public GonesAuthProvider Mode { get; }
    public Uri? CallbackOrigin { get; }
    public IReadOnlyDictionary<string, OAuthProviderOptions> Providers { get; }
    public bool Enabled => Mode is GonesAuthProvider.Fake or GonesAuthProvider.External;

    public static ExternalOAuthOptions Load(IConfiguration configuration, GonesRuntimeConfiguration runtime)
    {
        var mode = runtime.AuthProvider ?? GonesAuthProvider.Local;
        if (mode == GonesAuthProvider.Local) return new ExternalOAuthOptions(mode, null, new Dictionary<string, OAuthProviderOptions>());

        var callbackOrigin = RequireHttpsOrigin(configuration["GONES_OAUTH_CALLBACK_ORIGIN"], "GONES_OAUTH_CALLBACK_ORIGIN");
        if (mode == GonesAuthProvider.Fake) return new ExternalOAuthOptions(mode, callbackOrigin, new Dictionary<string, OAuthProviderOptions>());

        var providers = new Dictionary<string, OAuthProviderOptions>(StringComparer.Ordinal)
        {
            [ExternalIdentityProvider.Google] = new OAuthProviderOptions(
                Require(configuration, "GONES_GOOGLE_CLIENT_ID"),
                ReadSecret(configuration, "GONES_GOOGLE_CLIENT_SECRET", "GONES_GOOGLE_CLIENT_SECRET_FILE"),
                ReadEndpoint(configuration, "GOOGLE", "AUTHORIZATION", "https://accounts.google.com/o/oauth2/v2/auth"),
                ReadEndpoint(configuration, "GOOGLE", "TOKEN", "https://oauth2.googleapis.com/token"),
                ReadEndpoint(configuration, "GOOGLE", "USERINFO", "https://openidconnect.googleapis.com/v1/userinfo"),
                "openid email profile"),
            [ExternalIdentityProvider.Facebook] = new OAuthProviderOptions(
                Require(configuration, "GONES_FACEBOOK_CLIENT_ID"),
                ReadSecret(configuration, "GONES_FACEBOOK_CLIENT_SECRET", "GONES_FACEBOOK_CLIENT_SECRET_FILE"),
                ReadEndpoint(configuration, "FACEBOOK", "AUTHORIZATION", "https://www.facebook.com/v22.0/dialog/oauth"),
                ReadEndpoint(configuration, "FACEBOOK", "TOKEN", "https://graph.facebook.com/v22.0/oauth/access_token"),
                ReadEndpoint(configuration, "FACEBOOK", "USERINFO", "https://graph.facebook.com/v22.0/me?fields=id,email,first_name,last_name"),
                "email public_profile")
        };
        return new ExternalOAuthOptions(mode, callbackOrigin, providers);
    }

    public Uri CallbackUri(string provider) => new(CallbackOrigin ?? throw new InvalidOperationException("OAuth is disabled."), $"/api/auth/oauth/{ExternalIdentityProvider.Normalize(provider)}/callback");

    public override string ToString() => $"ExternalOAuthOptions {{ Mode = {Mode}, Enabled = {Enabled} }}";

    private static Uri RequireHttpsOrigin(string? raw, string key)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var value)
            || value.Scheme != Uri.UriSchemeHttps
            || !string.IsNullOrEmpty(value.UserInfo)
            || !string.IsNullOrEmpty(value.Query)
            || !string.IsNullOrEmpty(value.Fragment)
            || value.AbsolutePath != "/")
        {
            throw new InvalidOperationException($"{key} must be an exact HTTPS origin.");
        }
        return value;
    }

    /// <summary>
    /// Optional per-provider endpoint override, so a self-hosted or fake OIDC provider can be pointed
    /// at from a generic host without a code change (C41 release rehearsal uses this). HTTPS only:
    /// the override never becomes a way to downgrade an identity exchange to cleartext.
    /// </summary>
    private static Uri ReadEndpoint(IConfiguration configuration, string provider, string endpoint, string fallback)
    {
        var key = $"GONES_OAUTH_{provider}_{endpoint}_ENDPOINT";
        var raw = configuration[key];
        if (string.IsNullOrWhiteSpace(raw)) return new Uri(fallback);
        if (!Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var value)
            || value.Scheme != Uri.UriSchemeHttps
            || !string.IsNullOrEmpty(value.UserInfo)
            || !string.IsNullOrEmpty(value.Fragment))
        {
            throw new InvalidOperationException($"{key} must be an absolute HTTPS URL without user information or a fragment.");
        }
        return value;
    }

    private static string Require(IConfiguration configuration, string key) =>
        !string.IsNullOrWhiteSpace(configuration[key]) ? configuration[key]!.Trim() : throw new InvalidOperationException($"{key} is required when external OAuth is enabled.");

    private static string ReadSecret(IConfiguration configuration, string valueKey, string fileKey)
    {
        var direct = configuration[valueKey];
        var file = configuration[fileKey];
        if (!string.IsNullOrWhiteSpace(direct) && !string.IsNullOrWhiteSpace(file))
        {
            throw new InvalidOperationException($"Configure only one of {valueKey} or {fileKey}.");
        }
        if (!string.IsNullOrWhiteSpace(direct)) return direct.Trim();
        if (string.IsNullOrWhiteSpace(file)) throw new InvalidOperationException($"{valueKey} or {fileKey} is required when external OAuth is enabled.");
        try
        {
            var secret = File.ReadAllText(file.Trim()).Trim();
            return !string.IsNullOrWhiteSpace(secret) ? secret : throw new InvalidOperationException($"{fileKey} points to an empty secret file.");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new InvalidOperationException($"{fileKey} could not be read.", exception);
        }
    }
}

public sealed class OAuthProviderOptions(
    string clientId,
    string clientSecret,
    Uri authorizationEndpoint,
    Uri tokenEndpoint,
    Uri userInformationEndpoint,
    string scopes)
{
    public string ClientId { get; } = clientId;
    public string ClientSecret { get; } = clientSecret;
    public Uri AuthorizationEndpoint { get; } = authorizationEndpoint;
    public Uri TokenEndpoint { get; } = tokenEndpoint;
    public Uri UserInformationEndpoint { get; } = userInformationEndpoint;
    public string Scopes { get; } = scopes;
    public override string ToString() => $"OAuthProviderOptions {{ ClientId = [redacted], AuthorizationEndpoint = {AuthorizationEndpoint.Host} }}";
}
