using System.ComponentModel.DataAnnotations;
using Gones.Domain.Calendar;

namespace Gones.Application.Events;

public sealed record EventLocationInput(
    [property: Required, MaxLength(Event.MaximumAddressLength)] string StreetAddress,
    [property: Required, MaxLength(Event.MaximumPostalCodeLength)] string PostalCode,
    [property: Required, MaxLength(Event.MaximumCityLength)] string City,
    [property: Required, MaxLength(Event.MaximumCountryLength)] string Country,
    [property: Required, MaxLength(Event.MaximumRegionLength)] string Region,
    [property: Required, MaxLength(Event.MaximumTimeZoneLength)] string TimeZoneId);

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

public static class EventImageUploadLimits
{
    public const long MaximumBytes = 5 * 1024 * 1024;
    public const long MaximumPixels = 25_000_000;
    public static readonly IReadOnlySet<string> ContentTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg",
        "image/png",
        "image/webp"
    };
}

public static class EventImageObjectKeys
{
    public static string Variant(Guid imageId, int width) => $"event-images/{imageId:D}/{width}.webp";
}

public sealed class EventImageTooLargeException() : Exception("Event image exceeds 5 MiB.");
public sealed class EventImageTypeUnsupportedException() : Exception("Event image type is unsupported.");
public sealed class EventImageInvalidException() : Exception("Event image is invalid.");
public sealed class EventImageTooManyPixelsException() : Exception("Event image exceeds 25 megapixels.");
public sealed class EventImageAnimatedException() : Exception("Animated Event images are unsupported.");
public sealed class EventImageStorageUnavailableException(Exception? innerException = null)
    : Exception("Event image storage is unavailable.", innerException);
