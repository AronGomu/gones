using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Calendar;

public enum TournamentRegistrationStatus
{
    Confirmed,
    CancelledByUser,
    CancelledByTournament,
    RemovedByOrganizer
}

public sealed class TournamentRegistrationAttempt : VersionedEntity
{
    private TournamentRegistrationAttempt() { }

    public Guid TournamentId { get; private init; }
    public Guid UserId { get; private init; }
    public TournamentRegistrationStatus Status { get; private set; }
    public Guid RegisteredByUserId { get; private init; }
    public Instant RegisteredAt { get; private init; }
    public Guid? StatusChangedByUserId { get; private set; }
    public Instant? StatusChangedAt { get; private set; }

    public bool IsActive => Status == TournamentRegistrationStatus.Confirmed;

    public static TournamentRegistrationAttempt Register(
        Guid tournamentId,
        Guid userId,
        Guid registeredByUserId,
        Instant now)
    {
        RequireId(tournamentId, nameof(tournamentId));
        RequireId(userId, nameof(userId));
        RequireId(registeredByUserId, nameof(registeredByUserId));
        return new TournamentRegistrationAttempt
        {
            TournamentId = tournamentId,
            UserId = userId,
            Status = TournamentRegistrationStatus.Confirmed,
            RegisteredByUserId = registeredByUserId,
            RegisteredAt = now
        };
    }

    public void CancelByUser(Guid actorUserId, Instant now) =>
        Transition(TournamentRegistrationStatus.CancelledByUser, actorUserId, now);

    public void CancelByTournament(Guid actorUserId, Instant now) =>
        Transition(TournamentRegistrationStatus.CancelledByTournament, actorUserId, now);

    public void RemoveByOrganizer(Guid actorUserId, Instant now) =>
        Transition(TournamentRegistrationStatus.RemovedByOrganizer, actorUserId, now);

    private void Transition(TournamentRegistrationStatus status, Guid actorUserId, Instant now)
    {
        RequireId(actorUserId, nameof(actorUserId));
        if (!IsActive) throw new InvalidOperationException("Only a confirmed registration can be cancelled.");
        if (now < RegisteredAt) throw new ArgumentOutOfRangeException(nameof(now));
        Status = status;
        StatusChangedByUserId = actorUserId;
        StatusChangedAt = now;
    }

    private static void RequireId(Guid value, string parameterName)
    {
        if (value == Guid.Empty) throw new ArgumentException("ID cannot be empty.", parameterName);
    }
}
