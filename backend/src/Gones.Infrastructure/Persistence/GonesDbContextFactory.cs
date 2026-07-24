using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Gones.Infrastructure.Persistence;

public sealed class GonesDbContextFactory : IDesignTimeDbContextFactory<GonesDbContext>
{
    public GonesDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable(PersistenceServiceCollectionExtensions.ConnectionStringKey)
            ?? throw new InvalidOperationException($"{PersistenceServiceCollectionExtensions.ConnectionStringKey} is required for EF tooling.");
        var options = new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones(connectionString)
            .Options;

        return new GonesDbContext(options);
    }
}
