using Amazon.S3;
using Gones.Application.Events;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Gones.Infrastructure.EventProviders;

public sealed record EventProviderRegistrations(GoogleMapsOptions GoogleMaps, EventImageStorageOptions? ImageStorage);

public static class EventProviderServiceCollectionExtensions
{
    private static readonly TimeSpan GoogleRequestTimeout = TimeSpan.FromSeconds(10);

    public static EventProviderRegistrations AddEventProviderFoundations(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var googleMaps = GoogleMapsOptions.Load(configuration);
        services.AddSingleton(googleMaps);
        if (googleMaps.IsConfigured)
        {
            services.AddTransient<GoogleTimeZoneApiKeyHandler>();
            services.AddHttpClient<IEventLocationProvider, GoogleEventLocationProvider>(client => client.Timeout = GoogleRequestTimeout)
                .AddHttpMessageHandler<GoogleTimeZoneApiKeyHandler>();
        }
        else
        {
            services.AddSingleton<IEventLocationProvider, UnavailableEventLocationProvider>();
        }

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

        return new EventProviderRegistrations(googleMaps, imageStorage);
    }
}
