using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Gones.IntegrationTests;

public sealed class StagingStartupTests
{
    [Theory]
    [InlineData("Staging", null)]
    [InlineData("Production", "staging")]
    public async Task Staging_missing_policy_refuses_startup_before_database_access(string environment, string? marker)
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            if (marker is not null) builder.UseSetting("GONES_DEPLOYMENT_ENVIRONMENT", marker);
        });
        var error = Assert.ThrowsAny<Exception>(() => factory.CreateClient());
        Assert.Contains("staging_policy_invalid", error.ToString(), StringComparison.Ordinal);
    }
}
