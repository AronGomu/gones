namespace Gones.UnitTests;

public sealed class AssemblySmokeTests
{
    [Fact]
    public void Domain_and_application_load()
    {
        Assert.Equal("Gones.Domain", typeof(Domain.AssemblyMarker).Assembly.GetName().Name);
        Assert.Equal("Gones.Application", typeof(Application.AssemblyMarker).Assembly.GetName().Name);
    }
}
