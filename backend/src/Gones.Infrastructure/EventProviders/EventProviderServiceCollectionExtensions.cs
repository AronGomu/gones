using Amazon.S3;
using Gones.Application.Events;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Gones.Infrastructure.EventProviders;

public sealed record EventProviderRegistrations(EventImageStorageOptions? ImageStorage);

public static class EventProviderServiceCollectionExtensions
{
    public static EventProviderRegistrations AddEventProviderFoundations(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddSingleton<IEventImageProcessor, ImageSharpEventImageProcessor>();

        var imageStorage = EventImageStorageOptions.TryLoad(configuration);
        if (imageStorage is null)
        {
            services.AddSingleton<IEventImageObjectStore, UnavailableEventImageObjectStore>();
        }
        else
        {
            services.AddSingleton(imageStorage);
            services.AddSingleton<IAmazonS3>(_ => S3EventImageObjectStore.CreateClient(imageStorage));
            services.AddSingleton<IEventImageObjectStore, S3EventImageObjectStore>();
        }

        return new EventProviderRegistrations(imageStorage);
    }
}
