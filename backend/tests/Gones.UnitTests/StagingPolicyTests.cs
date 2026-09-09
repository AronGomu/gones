using System.Security.Claims;
using System.Text.Json;
using Gones.Infrastructure.Configuration;
using Microsoft.Extensions.Configuration;
using NodaTime;

namespace Gones.UnitTests;

public sealed class StagingPolicyTests : IDisposable
{
    private const string Owner = "owner@example.test";
    private readonly string directory = Path.Combine(Directory.GetCurrentDirectory(), ".tmp", $"staging-policy-{Guid.NewGuid():N}");
    private string PolicyPath => Path.Combine(directory, "private-policy.json");
    public StagingPolicyTests() => Directory.CreateDirectory(directory);
    public void Dispose() { foreach (var path in Directory.GetFiles(directory)) File.Delete(path); Directory.Delete(directory); }

    [Theory]
    [InlineData("Production", null, false)]
    [InlineData("Development", null, false)]
    [InlineData("Testing", "testing", false)]
    [InlineData("Production", "staging", true)]
    [InlineData("Staging", null, true)]
    [InlineData("Staging", "staging", true)]
    public void Authoritative_identity_controls_policy(string host, string? marker, bool staging)
    {
        var config = Config(staging ? ValidJson() : null, marker);
        Assert.Equal(staging, StagingAccessPolicy.Load(config, host).IsStaging);
    }

    [Theory]
    [InlineData("Staging", "production")]
    [InlineData("Production", "stage")]
    [InlineData("Production", "")]
    [InlineData("Production", "STAGING")]
    [InlineData("Production", null)]
    public void Contradictory_unknown_identity_or_nonstaging_policy_fails_closed(string host, string? marker)
        => AssertSafeFailure(() => StagingAccessPolicy.Load(Config(ValidJson(), marker), host));

    [Theory]
    [InlineData("{\"revision\":\"v2\",\"revision\":\"v1\",\"validAfterUtc\":\"2026-01-01T00:00:00Z\",\"invitedEmails\":[\"owner@example.test\"],\"recipientEmails\":[\"owner@example.test\"]}")]
    [InlineData("{}")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{\"private\":\"owner@example.test\"}")]
    [InlineData("{ /* secret */ }")]
    public void Malformed_JSON_is_sanitized(string json) => AssertSafeFailure(() => StagingAccessPolicy.Load(Config(json), "Staging"));

    [Theory]
    [InlineData("OWNER@example.test", true)]
    [InlineData(" owner@example.test ", true)]
    [InlineData("owner+alias@example.test", false)]
    [InlineData("o.wner@example.test", false)]
    [InlineData("owner@sub.example.test", false)]
    [InlineData("\towner@example.test", false)]
    [InlineData("owner@example.test\n", false)]
    [InlineData("ｏwner@example.test", false)]
    [InlineData("Owner <owner@example.test>", false)]
    [InlineData("owner@example.test,other@example.test", false)]
    [InlineData("*@example.test", false)]
    public void Exact_email_matching_does_not_broaden_aliases(string email, bool allowed)
        => Assert.Equal(allowed, StagingAccessPolicy.Load(Config(ValidJson()), "Staging").IsEligible(email));

    [Theory]
    [InlineData("invitedEmails", "[\"owner@example.test\",\"OWNER@example.test\"]")]
    [InlineData("invitedEmails", "[]")]
    [InlineData("recipientEmails", "[\"other@example.test\"]")]
    [InlineData("recipientEmails", "null")]
    [InlineData("invitedEmails", "[\"owner@example.test\",\"extra@example.test\"]")]
    [InlineData("invitedEmails", "[\"owner@example.test\",\"*@example.test\"]")]
    [InlineData("invitedEmails", "[\"owner@example.test\",\"\\tother@example.test\"]")]
    [InlineData("validAfterUtc", "\"2026-01-01T00:00:00.1Z\"")]
    [InlineData("validAfterUtc", "\"2026-01-01T00:00:00+00:00\"")]
    [InlineData("validAfterUtc", "\"9999-01-01T00:00:00Z\"")]
    [InlineData("revision", "null")]
    [InlineData("revision", "\"unsafe value\"")]
    public void Invalid_members_fail_closed(string field, string value)
    {
        var fields = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(ValidJson())!;
        fields[field] = JsonDocument.Parse(value).RootElement.Clone();
        AssertSafeFailure(() => StagingAccessPolicy.Load(Config(JsonSerializer.Serialize(fields)), "Staging"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("1735689600.0")]
    [InlineData("1e20")]
    [InlineData("99999999999999999999999999999")]
    [InlineData("999999999999")]
    [InlineData("-1")]
    [InlineData("01767225600")]
    [InlineData(" 1767225600")]
    public void JWT_cutoff_requires_one_canonical_integer(string? iat)
    {
        var policy = StagingAccessPolicy.Load(Config(ValidJson()), "Staging");
        var claims = iat is null ? Array.Empty<Claim>() : [new Claim("iat", iat)];
        Assert.False(policy.IsCurrentJwt(new ClaimsPrincipal(new ClaimsIdentity(claims))));
    }

    [Fact]
    public void Every_timestamp_boundary_includes_equality_without_skew()
    {
        var policy = StagingAccessPolicy.Load(Config(ValidJson()), "Staging");
        Assert.False(policy.IsCurrent(policy.ValidAfter - Duration.FromNanoseconds(1)));
        Assert.True(policy.IsCurrent(policy.ValidAfter));
        Assert.True(policy.IsCurrent(policy.ValidAfter + Duration.FromNanoseconds(1)));
        var seconds = policy.ValidAfter.ToUnixTimeSeconds();
        Assert.False(policy.IsCurrentJwt(Principal(seconds - 1)));
        Assert.True(policy.IsCurrentJwt(Principal(seconds)));
        Assert.True(policy.IsCurrentJwt(Principal(seconds + 1)));
        Assert.False(policy.IsCurrentJwt(new ClaimsPrincipal(new ClaimsIdentity([new Claim("iat", seconds.ToString()), new Claim("iat", seconds.ToString())]))));
    }

    [Fact]
    public void File_edit_has_no_effect_until_new_instance_loads_revision()
    {
        var config = Config(ValidJson());
        var original = StagingAccessPolicy.Load(config, "Staging");
        File.WriteAllText(PolicyPath, ValidJson([Owner, "added@example.test"]));
        Assert.False(original.IsEligible("added@example.test"));
        Assert.True(StagingAccessPolicy.Load(config, "Staging").IsEligible("added@example.test"));
    }

    [Theory]
    [InlineData("relative")]
    [InlineData("absent")]
    [InlineData("oversized")]
    public void Private_files_are_absolute_bounded_and_errors_omit_paths(string kind)
    {
        var config = Config(ValidJson());
        if (kind == "relative") config[StagingAccessPolicy.FileKey] = "private-fixture-path.json";
        if (kind == "absent") config[StagingAccessPolicy.FileKey] = Path.Combine(directory, "missing");
        if (kind == "oversized") File.WriteAllText(PolicyPath, new string(' ', 65537));
        AssertSafeFailure(() => StagingAccessPolicy.Load(config, "Staging"));
        var ownerConfig = new ConfigurationManager();
        ownerConfig["GONES_BOOTSTRAP_ADMIN_EMAIL_FILE"] = config[StagingAccessPolicy.FileKey];
        AssertSafeFailure(() => ownerConfig.AddGonesSecretFiles());
    }

    [Fact]
    public void Owner_private_file_requires_exclusive_value_then_uses_same_mailbox_validation()
    {
        var ownerPath = Path.Combine(directory, "owner");
        File.WriteAllText(ownerPath, Owner + "\n");
        var config = Config(ValidJson());
        config["GONES_BOOTSTRAP_ADMIN_EMAIL_FILE"] = ownerPath;
        AssertSafeFailure(() => config.AddGonesSecretFiles());
        config["GONES_BOOTSTRAP_ADMIN_EMAIL"] = null;
        config.AddGonesSecretFiles();
        Assert.True(StagingAccessPolicy.Load(config, "Staging").IsEligible(Owner));
    }

    private ConfigurationManager Config(string? json, string? marker = null)
    {
        var config = new ConfigurationManager();
        if (json is not null) { File.WriteAllText(PolicyPath, json); config[StagingAccessPolicy.FileKey] = PolicyPath; }
        config["GONES_DEPLOYMENT_ENVIRONMENT"] = marker;
        config["GONES_BOOTSTRAP_ADMIN_EMAIL"] = Owner;
        return config;
    }
    private static string ValidJson(string[]? emails = null) => JsonSerializer.Serialize(new
    {
        revision = "test-1", validAfterUtc = "2026-01-01T00:00:00Z", invitedEmails = emails ?? [Owner], recipientEmails = emails ?? [Owner]
    });
    private void AssertSafeFailure(Action action)
    {
        var error = Assert.Throws<InvalidOperationException>(action);
        Assert.Equal("staging_policy_invalid", error.Message);
        Assert.Null(error.InnerException);
        Assert.DoesNotContain(directory, error.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain(Owner, error.ToString(), StringComparison.Ordinal);
    }
    private static ClaimsPrincipal Principal(long seconds) => new(new ClaimsIdentity([new Claim("iat", seconds.ToString(System.Globalization.CultureInfo.InvariantCulture))]));
}
