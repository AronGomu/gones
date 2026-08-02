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
        services.AddSingleton<NotificationTemplateRenderer>();
        services.AddSingleton<INotificationRetryPolicy>(DefaultNotificationRetryPolicy.Instance);
        services.AddSingleton<NotificationMetrics>();
        var transport = configuration["GONES_EMAIL_TRANSPORT"];
        if (string.Equals(transport, "Brevo", StringComparison.OrdinalIgnoreCase))
        {
            var brevo = BrevoOptions.Load(configuration);
            options = options with { ProviderIdempotencyWindow = brevo.IdempotencyWindow };
            services.AddSingleton(brevo);
            services.AddHttpClient<BrevoEmailTransport>();
            services.AddSingleton<IEmailTransport>(provider => provider.GetRequiredService<BrevoEmailTransport>());
        }
        else
        {
            var includeActionLinks = configuration.GetValue<bool>("GONES_EMAIL_SINK_INCLUDE_ACTION_LINKS");
            services.AddSingleton<IEmailTransport>(provider => new FileEmailTransport(options.SinkPath, provider.GetRequiredService<IClock>(), includeActionLinks));
        }
        services.AddSingleton(options);
        services.AddScoped<NotificationOutboxStore>();
        services.AddScoped<NotificationProcessor>();
        services.AddScoped<NotificationDeliveryMetadataCleaner>();
        return services;
    }
}
