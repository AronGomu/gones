using NodaTime;

namespace Gones.Domain.Persistence;

public sealed class SystemMarker : VersionedEntity
{
    public required string Key { get; init; }
    public Instant? ConsumedAt { get; set; }
    public Guid? ConsumedByUserId { get; set; }
    public required Instant CreatedAt { get; init; }

    public bool IsConsumed => ConsumedAt is not null;

    public void Consume(Guid userId, Instant now)
    {
        if (userId == Guid.Empty) throw new ArgumentException("User ID cannot be empty.", nameof(userId));
        if (IsConsumed) return;
        ConsumedAt = now;
        ConsumedByUserId = userId;
    }
}
