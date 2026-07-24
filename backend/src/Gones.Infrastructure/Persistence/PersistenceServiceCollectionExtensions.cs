using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;

namespace Gones.Infrastructure.Persistence;

public static class PersistenceServiceCollectionExtensions
{
    public const string ConnectionStringKey = "GONES_DB_CONNECTION";

    public static IServiceCollection AddGonesPersistence(this IServiceCollection services, string connectionString)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);

        services.AddSingleton<IClock>(SystemClock.Instance);
        services.AddDbContext<GonesDbContext>(options => options.ConfigureGones(connectionString));

        return services;
    }
}
