namespace Gones.IntegrationTests;

public sealed class PostgreSqlTestContainerTests
{
    [Fact]
    public void Matches_rootlesskit_port_binding_collision()
    {
        const string details = "DockerApiException: RootlessKit PortManager.AddPort(): failed to expose port 0.0.0.0:5432: bind: address already in use";

        Assert.True(PostgreSqlTestContainer.IsTransientPortBindingFailure(details));
    }

    [Fact]
    public void Rejects_generic_address_in_use_failure()
    {
        const string details = "DockerApiException: driver failed programming external connectivity: bind: address already in use";

        Assert.False(PostgreSqlTestContainer.IsTransientPortBindingFailure(details));
    }

    [Fact]
    public void Rejects_unrelated_rootlesskit_failure()
    {
        const string details = "DockerApiException: RootlessKit PortManager.AddPort(): failed to configure namespace";

        Assert.False(PostgreSqlTestContainer.IsTransientPortBindingFailure(details));
    }
}
