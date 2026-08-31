namespace Gones.Application.Events;

public interface IEventLocationProvider
{
    Task<IReadOnlyList<EventLocationSuggestion>> AutocompleteAsync(string input, string sessionToken, string language, CancellationToken cancellationToken);
    Task<ResolvedEventLocation> ResolveAsync(string placeId, string sessionToken, string language, CancellationToken cancellationToken);
}

public sealed record EventLocationSuggestion(string PlaceId, string PrimaryText, string SecondaryText);

public sealed record ResolvedEventLocation(
    string PlaceId,
    string StreetAddress,
    string PostalCode,
    string City,
    string Country,
    string Region,
    decimal Latitude,
    decimal Longitude,
    string TimeZoneId);

public interface IEventImageObjectStore
{
    Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken);
    Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken);
    Task DeleteAsync(string key, CancellationToken cancellationToken);
}

public interface IEventImageProcessor
{
    Task<ProcessedEventImage> ProcessAsync(Stream source, string contentType, CancellationToken cancellationToken);
}

public sealed record ProcessedEventImage(int Width, int Height, IReadOnlyList<ProcessedEventImageVariant> Variants);
public sealed record ProcessedEventImageVariant(int Width, int Height, ReadOnlyMemory<byte> WebP);

public sealed class EventLocationProviderUnavailableException(Exception? innerException = null)
    : Exception("Event location provider is unavailable.", innerException);

public sealed class EventImageStorageUnavailableException(Exception? innerException = null)
    : Exception("Event image storage is unavailable.", innerException);
