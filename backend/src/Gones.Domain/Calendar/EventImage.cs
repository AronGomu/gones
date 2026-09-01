using NodaTime;

namespace Gones.Domain.Calendar;

public enum EventImageState
{
    Temporary,
    ProposalOwned,
    EventOwned
}

public sealed class EventImage
{
    public const int MaximumAltTextLength = 300;
    public static readonly Duration TemporaryLifetime = Duration.FromHours(24);
    private static readonly int[] StandardVariantWidths = [320, 960, 1600];

    private EventImage() { }

    public Guid Id { get; private init; }
    public Guid UploadedByUserId { get; private init; }
    public EventImageState State { get; private init; }
    public Guid? EventId { get; private init; }
    public Guid? ProposalId { get; private init; }
    public int? SortOrder { get; private init; }
    public string? AltText { get; private init; }
    public int Width { get; private init; }
    public int Height { get; private init; }
    public Instant CreatedAt { get; private init; }
    public Instant? ExpiresAt { get; private init; }

    public static EventImage CreateTemporary(Guid id, Guid uploadedByUserId, int width, int height, Instant now)
    {
        if (id == Guid.Empty) throw new ArgumentException("Image ID cannot be empty.", nameof(id));
        if (uploadedByUserId == Guid.Empty) throw new ArgumentException("Uploader user ID cannot be empty.", nameof(uploadedByUserId));
        if (width <= 0) throw new ArgumentOutOfRangeException(nameof(width));
        if (height <= 0) throw new ArgumentOutOfRangeException(nameof(height));
        return new EventImage
        {
            Id = id,
            UploadedByUserId = uploadedByUserId,
            State = EventImageState.Temporary,
            Width = width,
            Height = height,
            CreatedAt = now,
            ExpiresAt = now + TemporaryLifetime
        };
    }

    public static IReadOnlyList<int> VariantWidthsFor(int sourceWidth)
    {
        if (sourceWidth <= 0) throw new ArgumentOutOfRangeException(nameof(sourceWidth));
        return sourceWidth < StandardVariantWidths[0]
            ? [sourceWidth]
            : StandardVariantWidths.Where(width => width <= sourceWidth).ToArray();
    }
}

public sealed class EventImageObjectDeletion
{
    public const int MaximumObjectKeyLength = 300;
    public const int MaximumLastErrorLength = 200;
    private static readonly Duration MaximumRetryDelay = Duration.FromHours(24);

    private EventImageObjectDeletion() { }

    public string ObjectKey { get; private init; } = string.Empty;
    public Guid ImageId { get; private init; }
    public int Attempts { get; private set; }
    public Instant NextAttemptAt { get; private set; }
    public string? LastError { get; private set; }
    public Instant CreatedAt { get; private init; }

    public static EventImageObjectDeletion Create(Guid imageId, string objectKey, Instant now)
    {
        if (imageId == Guid.Empty) throw new ArgumentException("Image ID cannot be empty.", nameof(imageId));
        ArgumentException.ThrowIfNullOrWhiteSpace(objectKey);
        if (objectKey.Length > MaximumObjectKeyLength) throw new ArgumentException($"Object key cannot exceed {MaximumObjectKeyLength} characters.", nameof(objectKey));
        return new EventImageObjectDeletion
        {
            ObjectKey = objectKey,
            ImageId = imageId,
            NextAttemptAt = now,
            CreatedAt = now
        };
    }

    public void DeferUntil(Instant nextAttemptAt)
    {
        if (nextAttemptAt < CreatedAt) throw new ArgumentOutOfRangeException(nameof(nextAttemptAt));
        NextAttemptAt = nextAttemptAt;
    }

    public void RecordFailure(Exception exception, Instant now)
    {
        ArgumentNullException.ThrowIfNull(exception);
        Attempts++;
        var error = exception.GetType().Name;
        LastError = error[..Math.Min(error.Length, MaximumLastErrorLength)];
        var exponent = Math.Min(Attempts - 1, 7);
        var delay = Duration.FromMinutes(15 * (1 << exponent));
        NextAttemptAt = now + (delay < MaximumRetryDelay ? delay : MaximumRetryDelay);
    }
}
