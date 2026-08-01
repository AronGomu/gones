using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Gones.Api.Errors;
using Gones.Domain.Identity;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;

namespace Gones.Api.Identity;

internal sealed record ExternalProviderProfile(
    string Subject,
    string? Email,
    bool EmailVerified,
    string? Username,
    string? FirstName,
    string? LastName);

internal sealed record FakeOAuthScenario(string Scenario, string? Subject, string? Email);

internal interface IExternalOAuthClient
{
    Uri CreateAuthorizationUri(string provider, string state, FakeOAuthScenario? scenario);
    Task<ExternalProviderProfile> ExchangeAsync(string provider, string code, CancellationToken cancellationToken);
}

internal sealed class ExternalOAuthClient(
    ExternalOAuthOptions options,
    IHttpClientFactory httpClientFactory,
    FakeOAuthCodeStore fakeCodes) : IExternalOAuthClient
{
    public Uri CreateAuthorizationUri(string provider, string state, FakeOAuthScenario? scenario)
    {
        provider = ExternalIdentityProvider.Normalize(provider);
        if (!options.Enabled) throw new OAuthProviderUnavailableException();
        if (options.Mode == GonesAuthProvider.Fake)
        {
            var values = new Dictionary<string, string?>
            {
                ["redirect_uri"] = options.CallbackUri(provider).ToString(),
                ["state"] = state,
                ["scenario"] = scenario?.Scenario ?? "complete",
                ["subject"] = scenario?.Subject,
                ["email"] = scenario?.Email
            };
            return new Uri(QueryHelpers.AddQueryString(new Uri(options.CallbackOrigin!, $"/api/testing/oauth/{provider}/authorize").ToString(), values));
        }

        var providerOptions = GetProvider(provider);
        var query = new Dictionary<string, string?>
        {
            ["client_id"] = providerOptions.ClientId,
            ["redirect_uri"] = options.CallbackUri(provider).ToString(),
            ["response_type"] = "code",
            ["scope"] = providerOptions.Scopes,
            ["state"] = state
        };
        if (provider == ExternalIdentityProvider.Google) query["prompt"] = "select_account";
        return new Uri(QueryHelpers.AddQueryString(providerOptions.AuthorizationEndpoint.ToString(), query));
    }

    public async Task<ExternalProviderProfile> ExchangeAsync(string provider, string code, CancellationToken cancellationToken)
    {
        provider = ExternalIdentityProvider.Normalize(provider);
        if (string.IsNullOrWhiteSpace(code) || code.Length > 2048) throw new OAuthProviderRejectedException();
        if (options.Mode == GonesAuthProvider.Fake)
        {
            return fakeCodes.Take(code) ?? throw new OAuthProviderRejectedException();
        }
        if (options.Mode != GonesAuthProvider.External) throw new OAuthProviderUnavailableException();

        var providerOptions = GetProvider(provider);
        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post, providerOptions.TokenEndpoint)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = providerOptions.ClientId,
                ["client_secret"] = providerOptions.ClientSecret,
                ["code"] = code,
                ["redirect_uri"] = options.CallbackUri(provider).ToString(),
                ["grant_type"] = "authorization_code"
            })
        };
        using var tokenResponse = await httpClientFactory.CreateClient(nameof(ExternalOAuthClient)).SendAsync(tokenRequest, cancellationToken);
        if (!tokenResponse.IsSuccessStatusCode) throw new OAuthProviderRejectedException();
        var token = await tokenResponse.Content.ReadFromJsonAsync<OAuthTokenResponse>(cancellationToken: cancellationToken);
        if (string.IsNullOrWhiteSpace(token?.AccessToken)) throw new OAuthProviderRejectedException();

        using var profileRequest = new HttpRequestMessage(HttpMethod.Get, providerOptions.UserInformationEndpoint);
        profileRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.AccessToken);
        using var profileResponse = await httpClientFactory.CreateClient(nameof(ExternalOAuthClient)).SendAsync(profileRequest, cancellationToken);
        if (!profileResponse.IsSuccessStatusCode) throw new OAuthProviderRejectedException();
        using var document = await JsonDocument.ParseAsync(await profileResponse.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
        return provider == ExternalIdentityProvider.Google ? ParseGoogle(document.RootElement) : ParseFacebook(document.RootElement);
    }

    private OAuthProviderOptions GetProvider(string provider) =>
        options.Providers.TryGetValue(provider, out var value) ? value : throw new OAuthProviderUnavailableException();

    private static ExternalProviderProfile ParseGoogle(JsonElement profile)
    {
        var subject = RequiredString(profile, "sub");
        var email = OptionalString(profile, "email");
        var verified = profile.TryGetProperty("email_verified", out var claim) && claim.ValueKind == JsonValueKind.True;
        return new ExternalProviderProfile(subject, email, verified, null, OptionalString(profile, "given_name"), OptionalString(profile, "family_name"));
    }

    private static ExternalProviderProfile ParseFacebook(JsonElement profile) => new(
        RequiredString(profile, "id"),
        OptionalString(profile, "email"),
        false,
        null,
        OptionalString(profile, "first_name"),
        OptionalString(profile, "last_name"));

    private static string RequiredString(JsonElement value, string property) =>
        OptionalString(value, property) ?? throw new OAuthProviderRejectedException();

    private static string? OptionalString(JsonElement value, string property) =>
        value.TryGetProperty(property, out var item) && item.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.GetString())
            ? item.GetString()
            : null;

    private sealed record OAuthTokenResponse([property: JsonPropertyName("access_token")] string? AccessToken);
}

internal sealed class FakeOAuthCodeStore
{
    private readonly ConcurrentDictionary<string, ExternalProviderProfile> codes = new(StringComparer.Ordinal);

    public string Issue(ExternalProviderProfile profile)
    {
        var code = WebEncoders.Base64UrlEncode(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        if (!codes.TryAdd(code, profile)) throw new InvalidOperationException("Could not issue fake OAuth code.");
        return code;
    }

    public ExternalProviderProfile? Take(string code) => codes.TryRemove(code, out var profile) ? profile : null;
}

internal static class FakeOAuthProviderEndpoints
{
    public static void MapFakeOAuthProviderEndpoints(this WebApplication app)
    {
        app.MapGet("/api/testing/oauth/{provider}/authorize", (
            string provider,
            [FromQuery(Name = "redirect_uri")] string redirectUri,
            string state,
            string? scenario,
            string? subject,
            string? email,
            FakeOAuthCodeStore codes) =>
        {
            provider = ExternalIdentityProvider.Normalize(provider);
            if (!Uri.TryCreate(redirectUri, UriKind.Absolute, out var callback)
                || callback.Scheme != Uri.UriSchemeHttps
                || string.IsNullOrWhiteSpace(state))
            {
                throw new OAuthProviderRejectedException();
            }
            var profile = FakeProfile(provider, scenario, subject, email);
            var code = codes.Issue(profile);
            var destination = QueryHelpers.AddQueryString(callback.ToString(), new Dictionary<string, string?> { ["code"] = code, ["state"] = state });
            return Results.Redirect(destination);
        }).ExcludeFromDescription().AllowAnonymous();
    }

    private static ExternalProviderProfile FakeProfile(string provider, string? scenario, string? subject, string? email)
    {
        var normalizedScenario = scenario?.Trim().ToLowerInvariant() ?? "complete";
        var normalizedSubject = string.IsNullOrWhiteSpace(subject) ? $"fake-{Guid.NewGuid():N}" : subject.Trim();
        var normalizedEmail = normalizedScenario == "missing_email" ? null : email?.Trim();
        var verified = normalizedScenario != "unverified_email" && normalizedEmail is not null;
        var username = normalizedScenario == "incomplete" || normalizedScenario is "missing_email" or "unverified_email"
            ? null
            : $"OAuth{Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(normalizedSubject)))[..12]}";
        return new ExternalProviderProfile(normalizedSubject, normalizedEmail, verified, username, "Alice", "Martin");
    }
}
