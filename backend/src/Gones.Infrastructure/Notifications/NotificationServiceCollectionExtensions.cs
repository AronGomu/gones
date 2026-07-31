using Gones.Application.Notifications;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;

namespace Gones.Infrastructure.Notifications;

public static class NotificationServiceCollectionExtensions
{
    public static IServiceCollection AddNotificationOutbox(this IServiceCollection services)
    {
        services.AddScoped<INotificationOutbox, NotificationOutbox>();
        return services;
    }

    public static IServiceCollection AddNotificationWorker(this IServiceCollection services, IConfiguration configuration)
    {
        var options = NotificationWorkerOptions.Load(configuration);
        services.AddNotificationOutbox();
        services.AddSingleton(options);
        services.AddSingleton<NotificationTemplateRenderer>();
        services.AddSingleton<INotificationRetryPolicy>(DefaultNotificationRetryPolicy.Instance);
        services.AddSingleton<NotificationMetrics>();
        services.AddSingleton<IEmailTransport>(provider => new FileEmailTransport(options.SinkPath, provider.GetRequiredService<IClock>()));
        services.AddScoped<NotificationOutboxStore>();
        services.AddScoped<NotificationProcessor>();
        return services;
    }
}
