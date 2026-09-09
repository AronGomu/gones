using Gones.Infrastructure.Workers;
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
        services.AddDbContext<GonesDbContext>((provider, options) =>
        {
            options.ConfigureGones(connectionString);
            if (provider.GetService<WorkerWakeInterceptor>() is { } wake) options.AddInterceptors(wake);
        });

        return services;
    }
}
