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
    public EventImageState State { get; private set; }
    public Guid? EventId { get; private set; }
    public Guid? ProposalId { get; private set; }
    public int? SortOrder { get; private set; }
    public string? AltText { get; private set; }
    public int Width { get; private init; }
    public int Height { get; private init; }
    public Instant CreatedAt { get; private init; }
    public Instant? ExpiresAt { get; private set; }

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

    public void AttachToEvent(Guid eventId, Guid userId, int sortOrder, string? altText, Instant now)
    {
        if (eventId == Guid.Empty) throw new ArgumentException("Event ID cannot be empty.", nameof(eventId));
        if (userId == Guid.Empty) throw new ArgumentException("User ID cannot be empty.", nameof(userId));
        if (sortOrder < 0) throw new ArgumentOutOfRangeException(nameof(sortOrder));
        if (State != EventImageState.Temporary || UploadedByUserId != userId || ExpiresAt <= now)
        {
            throw new InvalidOperationException("Event image is not attachable.");
        }
        State = EventImageState.EventOwned;
        EventId = eventId;
        ProposalId = null;
        SortOrder = sortOrder;
        AltText = NormalizeAltText(altText);
        ExpiresAt = null;
    }

    public void AttachToProposal(
        Guid proposalId,
        Guid userId,
        int sortOrder,
        string? altText,
        Instant proposalExpiresAt,
        Instant now)
    {
        if (proposalId == Guid.Empty) throw new ArgumentException("Proposal ID cannot be empty.", nameof(proposalId));
        if (userId == Guid.Empty) throw new ArgumentException("User ID cannot be empty.", nameof(userId));
        if (sortOrder < 0) throw new ArgumentOutOfRangeException(nameof(sortOrder));
        if (proposalExpiresAt <= now) throw new ArgumentOutOfRangeException(nameof(proposalExpiresAt));
        if (State != EventImageState.Temporary || UploadedByUserId != userId || ExpiresAt <= now)
        {
            throw new InvalidOperationException("Event image is not attachable.");
        }
        State = EventImageState.ProposalOwned;
        EventId = null;
        ProposalId = proposalId;
        SortOrder = sortOrder;
        AltText = NormalizeAltText(altText);
        ExpiresAt = proposalExpiresAt;
    }

    public void PromoteProposalToEvent(
        Guid eventId,
        Guid proposalId,
        Guid userId,
        int sortOrder,
        string? altText,
        Instant now)
    {
        if (eventId == Guid.Empty) throw new ArgumentException("Event ID cannot be empty.", nameof(eventId));
        if (proposalId == Guid.Empty) throw new ArgumentException("Proposal ID cannot be empty.", nameof(proposalId));
        if (userId == Guid.Empty) throw new ArgumentException("User ID cannot be empty.", nameof(userId));
        if (sortOrder < 0) throw new ArgumentOutOfRangeException(nameof(sortOrder));
        var normalizedAlt = NormalizeAltText(altText);
        if (State != EventImageState.ProposalOwned
            || ProposalId != proposalId
            || UploadedByUserId != userId
            || SortOrder != sortOrder
            || !string.Equals(AltText, normalizedAlt, StringComparison.Ordinal)
            || ExpiresAt <= now)
        {
            throw new InvalidOperationException("Proposal image is not publishable.");
        }
        State = EventImageState.EventOwned;
        EventId = eventId;
        ProposalId = null;
        ExpiresAt = null;
    }

    private static string? NormalizeAltText(string? altText)
    {
        var normalized = string.IsNullOrWhiteSpace(altText) ? null : altText.Trim();
        if (normalized?.Length > MaximumAltTextLength)
        {
            throw new ArgumentException($"Alt text cannot exceed {MaximumAltTextLength} characters.", nameof(altText));
        }
        return normalized;
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
