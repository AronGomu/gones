using NodaTime;

namespace Gones.Domain.Persistence;

public abstract class VersionedEntity
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public long Version { get; set; } = 1;
}

public sealed class SchemaVersion : VersionedEntity
{
    public required string Name { get; init; }
    public required Instant AppliedAt { get; init; }
}

public sealed class IdempotencyRecord : VersionedEntity
{
    public required string Scope { get; init; }
    public required string Key { get; init; }
    public required int ResponseStatusCode { get; init; }
    public required string ResponseBody { get; init; }
    public required Instant CreatedAt { get; init; }
    public required Instant ExpiresAt { get; init; }
}

public sealed class AuditRecord : VersionedEntity
{
    public Guid? ActorId { get; init; }
    public required string Action { get; init; }
    public required string EntityType { get; init; }
    public required string EntityId { get; init; }
    public required string RedactedDiff { get; init; }
    public required Instant OccurredAt { get; init; }
}

public sealed class OutboxRecord : VersionedEntity
{
    public required string MessageType { get; init; }
    public required string Payload { get; init; }
    public required Instant OccurredAt { get; init; }
    public Instant? ProcessedAt { get; set; }
    public int AttemptCount { get; set; }
}
