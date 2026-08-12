using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Calendar;

public enum TournamentProposalStatus
{
    Pending,
    Approved,
    Rejected
}

/// <summary>
/// A tournament a non-organizer asked an Organizer or Admin to publish on their behalf.
///
/// The submitted tournament is kept as opaque JSON rather than as a draft <see cref="Event"/>:
/// the public calendar reads scheduled tournaments only, so an unapproved proposal has no way to
/// surface there. Approval (T17) is what turns the payload into a real tournament.
/// </summary>
public sealed class EventProposal : VersionedEntity
{
    public const int MaximumPayloadJsonLength = 32_000;
    public const int MaximumRejectionReasonLength = 500;

    /// <summary>A8: a review link stays usable for seven days, then the proposal is dead.</summary>
    public static readonly Duration Lifetime = Duration.FromDays(7);

    private readonly List<EventProposalRecipient> recipients = [];

    private EventProposal() { }

    public Guid SubmittedByUserId { get; private init; }
    public string PayloadJson { get; private init; } = string.Empty;
    public TournamentProposalStatus Status { get; private set; }
    public Instant CreatedAt { get; private init; }
    public Instant ExpiresAt { get; private init; }
    public Instant? DecidedAt { get; private set; }
    public Guid? DecidedByUserId { get; private set; }
    public string? RejectionReason { get; private set; }

    public IReadOnlyList<EventProposalRecipient> Recipients => recipients;

    public bool IsPending => Status == TournamentProposalStatus.Pending;

    public static EventProposal Create(Guid submittedByUserId, string payloadJson, Instant now)
    {
        RequireId(submittedByUserId, nameof(submittedByUserId));
        ArgumentException.ThrowIfNullOrWhiteSpace(payloadJson);
        if (payloadJson.Length > MaximumPayloadJsonLength)
        {
            throw new ArgumentException($"Payload cannot exceed {MaximumPayloadJsonLength} characters.", nameof(payloadJson));
        }

        return new EventProposal
        {
            SubmittedByUserId = submittedByUserId,
            PayloadJson = payloadJson,
            Status = TournamentProposalStatus.Pending,
            CreatedAt = now,
            ExpiresAt = now + Lifetime
        };
    }

    /// <summary>
    /// Every approver gets its own token, so the approver behind a review link is provable from the
    /// token alone. Only the hash is ever handed in — the plaintext lives solely in the mailed link.
    /// </summary>
    public EventProposalRecipient AddRecipient(Guid userId, string tokenHash, Instant sentAt)
    {
        RequireId(userId, nameof(userId));
        if (!IsPending) throw new InvalidOperationException("Only a pending proposal can gain recipients.");
        if (recipients.Any(recipient => recipient.UserId == userId))
        {
            throw new ArgumentException("Recipient is already on this proposal.", nameof(userId));
        }

        var recipient = EventProposalRecipient.Create(Id, userId, tokenHash, sentAt);
        recipients.Add(recipient);
        return recipient;
    }

    public void Approve(Guid decidedBy, Instant now)
    {
        RequireId(decidedBy, nameof(decidedBy));
        Decide(TournamentProposalStatus.Approved, decidedBy, null, now);
    }

    public void Reject(Guid? decidedBy, string reason, Instant now)
    {
        if (decidedBy is { } actor) RequireId(actor, nameof(decidedBy));
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        var trimmed = reason.Trim();
        if (trimmed.Length > MaximumRejectionReasonLength)
        {
            throw new ArgumentException($"Reason cannot exceed {MaximumRejectionReasonLength} characters.", nameof(reason));
        }

        Decide(TournamentProposalStatus.Rejected, decidedBy, trimmed, now);
    }

    private void Decide(TournamentProposalStatus status, Guid? decidedBy, string? reason, Instant now)
    {
        if (!IsPending) throw new InvalidOperationException("Proposal was already decided.");
        if (now < CreatedAt) throw new ArgumentOutOfRangeException(nameof(now));
        Status = status;
        DecidedByUserId = decidedBy;
        DecidedAt = now;
        RejectionReason = reason;
    }

    private static void RequireId(Guid value, string parameterName)
    {
        if (value == Guid.Empty) throw new ArgumentException("ID cannot be empty.", parameterName);
    }
}

public sealed class EventProposalRecipient : VersionedEntity
{
    /// <summary>SHA-256, lowercase hex.</summary>
    public const int TokenHashLength = 64;

    private EventProposalRecipient() { }

    public Guid ProposalId { get; private init; }
    public Guid UserId { get; private init; }
    public string TokenHash { get; private init; } = string.Empty;
    public Instant SentAt { get; private init; }

    internal static EventProposalRecipient Create(Guid proposalId, Guid userId, string tokenHash, Instant sentAt)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tokenHash);
        if (tokenHash.Length != TokenHashLength || !tokenHash.All(character => char.IsAsciiDigit(character) || character is >= 'a' and <= 'f'))
        {
            throw new ArgumentException("Token hash must be lowercase SHA-256 hexadecimal.", nameof(tokenHash));
        }

        return new EventProposalRecipient
        {
            ProposalId = proposalId,
            UserId = userId,
            TokenHash = tokenHash,
            SentAt = sentAt
        };
    }
}
