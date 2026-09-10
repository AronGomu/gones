using Gones.Infrastructure.Observability;
using Microsoft.Extensions.Configuration;

namespace Gones.UnitTests;

public sealed class ReleaseTelemetryTests
{
    [Fact]
    public void Release_identity_uses_deployment_metadata_for_resource_attributes()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["GONES_RELEASE_VERSION"] = "2026.09.10.abc123",
            ["GONES_RELEASE_DIGEST"] = "sha256:deadbeef",
            ["GONES_DEPLOYMENT_ENVIRONMENT"] = "staging"
        }).Build();

        var identity = GonesReleaseIdentity.Load(configuration);

        Assert.Equal("2026.09.10.abc123", identity.Version);
        Assert.Equal("staging", identity.Environment);
        Assert.Equal("sha256:deadbeef", identity.Digest);
        Assert.Equal("staging", identity.Attributes["deployment.environment.name"]);
        Assert.Equal("2026.09.10.abc123", identity.Attributes["gones.release.version"]);
        Assert.Equal("sha256:deadbeef", identity.Attributes["gones.release.digest"]);
    }

    [Fact]
    public void Release_identity_rejects_control_characters()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["GONES_RELEASE_VERSION"] = "release\nforged"
        }).Build();

        var exception = Assert.Throws<InvalidOperationException>(() => GonesReleaseIdentity.Load(configuration));

        Assert.Equal("GONES_RELEASE_VERSION is invalid.", exception.Message);
    }
}
