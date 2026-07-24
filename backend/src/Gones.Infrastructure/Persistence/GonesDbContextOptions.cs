using Microsoft.EntityFrameworkCore;

namespace Gones.Infrastructure.Persistence;

public static class GonesDbContextOptions
{
    public static DbContextOptionsBuilder ConfigureGones(this DbContextOptionsBuilder options, string connectionString)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);
        options.UseNpgsql(connectionString, npgsql => npgsql.UseNodaTime());
        return options;
    }

    public static DbContextOptionsBuilder<TContext> ConfigureGones<TContext>(this DbContextOptionsBuilder<TContext> options, string connectionString)
        where TContext : DbContext
    {
        ConfigureGones((DbContextOptionsBuilder)options, connectionString);
        return options;
    }
}
