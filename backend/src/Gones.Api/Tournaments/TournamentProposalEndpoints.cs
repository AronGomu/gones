using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Identity;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Application.Notifications;
using Gones.Domain.Calendar;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using NodaTime;

namespace Gones.Api.Tournaments;

/// <summary>
/// T16. A verified account that is neither Organizer nor Admin cannot publish a tournament; it
/// submits a proposal instead. The proposal is stored as JSON — never as a draft tournament — and
/// every chosen approver is mailed a review link carrying its own single-use token.
/// </summary>
internal static class TournamentProposalEndpoints
{
    public static void MapTournamentProposalEndpoints(this WebApplication app)
    {
        var proposals = app.MapGroup("/api/tournament-proposals")
            .RequireAuthorization(AuthorizationPolicies.User);

        proposals.MapGet("/approvers", ListApproversAsync)
            .Produces<IReadOnlyList<ProposalApproverResponse>>()
            .ProducesProblem(StatusCodes.Status401Unauthorized);

        proposals.MapPost(string.Empty, SubmitAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<TournamentProposalResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        // T17, A8: the mailed token *is* the credential, so this group is anonymous on purpose. With
        // no identity to throttle, the IP limiter is what bounds guessing at a 256-bit token.
        var tokens = app.MapGroup("/api/tournament-proposals/by-token")
            .AllowAnonymous()
            .RequireRateLimiting(AuthRateLimiting.IpPolicy);

        tokens.MapGet("/{token}", GetByTokenAsync)
            .Produces<TournamentProposalReviewResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        tokens.MapPost("/{token}/approve", ApproveAsync)
            .Produces<TournamentProposalDecisionResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        tokens.MapPost("/{token}/reject", RejectAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
    }

    /// <summary>
    /// The submitter has to pick who reviews the request, so the candidates are public to any signed-in
    /// account — but only as an identity, never as a mailbox: no email leaves this endpoint.
    /// </summary>
    private static async Task<IResult> ListApproversAsync(
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var approvers = await (
            from user in database.Users.AsNoTracking()
            join profile in database.UserProfiles.AsNoTracking() on user.Id equals profile.UserId
            where (user.GlobalRole == GlobalRoles.Organizer || user.GlobalRole == GlobalRoles.Admin)
                && profile.ClosedAt == null
            orderby profile.Username
            select new ProposalApproverResponse(user.Id, profile.Username, user.GlobalRole)
        ).ToListAsync(cancellationToken);
        return Results.Ok(approvers);
    }

    private static async Task<IResult> SubmitAsync(
        TournamentProposalRequest request,
        ClaimsPrincipal principal,
        TournamentProposalService proposals,
        CancellationToken cancellationToken)
    {
        var response = await proposals.SubmitAsync(
            OrganizationPrincipal.UserId(principal),
            request,
            cancellationToken);
        return Results.Created($"/api/tournament-proposals/{response.Id:D}", response);
    }

    /// <summary>
    /// Hands the approver everything the review page has to show. A decided proposal conflicts rather
    /// than replaying its payload: the link is spent, and saying so is not the same as leaking it again.
    /// </summary>
    private static async Task<IResult> GetByTokenAsync(
        string token,
        GonesDbContext database,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var (proposal, recipient) = await ResolveTokenAsync(token, database, clock, cancellationToken);
        if (!proposal.IsPending) throw new ResourceConflictException();
        return Results.Ok(new TournamentProposalReviewResponse(
            proposal.Id,
            Payload(proposal),
            proposal.Status.ToString(),
            await UsernameAsync(database, proposal.SubmittedByUserId, cancellationToken),
            await UsernameAsync(database, recipient.UserId, cancellationToken),
            proposal.ExpiresAt));
    }

    /// <summary>
    /// Publishes the stored payload as the **submitter**, so ownership and the tournament audit row
    /// name whoever proposed it; the approver is recorded in this endpoint's own audit diff instead.
    ///
    /// Publishing commits before the proposal is marked decided, and the two cannot be one
    /// transaction because <c>PublishTournamentAsync</c> owns its own. That ordering is deliberate:
    /// the idempotency key is derived from the proposal, so a retry after a half-finished approval
    /// returns the tournament that already exists instead of creating a second one. The reverse order
    /// would leave a spent proposal with nothing published.
    /// </summary>
    private static async Task<IResult> ApproveAsync(
        string token,
        GonesDbContext database,
        TournamentPublicationService publication,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var (proposal, recipient) = await ResolveTokenAsync(token, database, clock, cancellationToken);
        if (!proposal.IsPending) throw new ResourceConflictException();
        var proposalId = proposal.Id;
        var approverUserId = recipient.UserId;
        var submitterUserId = proposal.SubmittedByUserId;
        var payload = Payload(proposal);

        database.ChangeTracker.Clear();
        var outcome = await publication.PublishTournamentAsync(
            payload,
            submitterUserId,
            isAdmin: false,
            $"tournament-proposal:{proposalId:D}",
            previewTicket: null,
            cancellationToken,
            // The submitter is not a member of the target organization — that is the whole reason the
            // proposal exists. Only this path relaxes the check; PublishAsync keeps the default.
            requireMembership: false);

        database.ChangeTracker.Clear();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var locked = await LockAsync(database, proposalId, cancellationToken);
        if (!locked.IsPending)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }

        var now = clock.GetCurrentInstant();
        locked.Approve(approverUserId, now);
        database.AuditRecords.Add(Audit(
            approverUserId,
            "tournament-proposal.approved",
            proposalId,
            JsonSerializer.Serialize(
                new { approverUserId = approverUserId.ToString("D"), tournamentId = outcome.Response.Id.ToString("D") },
                PayloadJsonOptions),
            now));
        await SaveDecisionAsync(database, transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(new TournamentProposalDecisionResponse(proposalId, locked.Status.ToString(), outcome.Response.Slug));
    }

    /// <summary>
    /// Refusing publishes nothing. The reason reaches the submitter through the mail body only: the
    /// audit row keeps its length, never its text.
    /// </summary>
    private static async Task<IResult> RejectAsync(
        string token,
        TournamentProposalRejectRequest request,
        GonesDbContext database,
        INotificationOutbox outbox,
        IConfiguration configuration,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var (proposal, recipient) = await ResolveTokenAsync(token, database, clock, cancellationToken);
        if (!proposal.IsPending) throw new ResourceConflictException();
        var proposalId = proposal.Id;
        var approverUserId = recipient.UserId;
        var submitterUserId = proposal.SubmittedByUserId;
        var tournamentName = Payload(proposal).Title;
        var approverUsername = await UsernameAsync(database, approverUserId, cancellationToken);
        var submitterProfile = await database.UserProfiles.AsNoTracking()
            .SingleOrDefaultAsync(profile => profile.UserId == submitterUserId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        // The submitting account is cascade-deleted with its proposals, so a live proposal always has
        // a mailbox behind it; refusing here beats an unhandled failure inside the outbox.
        var submitterEmail = await database.Users.AsNoTracking()
            .Where(user => user.Id == submitterUserId)
            .Select(user => user.Email)
            .SingleOrDefaultAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(submitterEmail)) throw new ResourceNotFoundException();
        var calendarUrl = new Uri(AccountLifecycleOptions.Load(configuration).PublicOrigin, "/calendar");

        database.ChangeTracker.Clear();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var locked = await LockAsync(database, proposalId, cancellationToken);
        if (!locked.IsPending)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }

        var now = clock.GetCurrentInstant();
        locked.Reject(approverUserId, request.Reason, now);
        database.AuditRecords.Add(Audit(
            approverUserId,
            "tournament-proposal.rejected",
            proposalId,
            JsonSerializer.Serialize(
                new { approverUserId = approverUserId.ToString("D"), reasonLength = locked.RejectionReason!.Length },
                PayloadJsonOptions),
            now));
        await SaveDecisionAsync(database, transaction, cancellationToken);

        // Enqueued inside the same transaction as the decision: a refusal the submitter never hears
        // about is worse than no refusal at all.
        outbox.Enqueue(new NotificationRequest(
            submitterEmail,
            submitterProfile.PreferredLanguage,
            $"tournament-proposal-rejected:{proposalId:D}",
            new TournamentProposalRejectedTemplateModel(
                submitterProfile.Username,
                tournamentName,
                approverUsername,
                locked.RejectionReason!,
                calendarUrl),
            submitterUserId));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// Resolves the mailed plaintext to its recipient row. The plaintext is hashed immediately and
    /// never logged, echoed or stored. An unknown token and an expired proposal fail identically:
    /// a 404 must not confirm that a proposal ever existed.
    /// </summary>
    private static async Task<(TournamentProposal Proposal, TournamentProposalRecipient Recipient)> ResolveTokenAsync(
        string token,
        GonesDbContext database,
        IClock clock,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > MaximumTokenLength) throw new ResourceNotFoundException();
        var tokenHash = AccountLifecycleService.Hash(token);
        var recipient = await database.TournamentProposalRecipients
            .SingleOrDefaultAsync(item => item.TokenHash == tokenHash, cancellationToken);
        // The index lookup already matched, but the comparison that decides is the constant-time one:
        // it costs nothing here and keeps a future non-indexed scan from leaking a prefix by timing.
        if (recipient is null || !FixedTimeEquals(recipient.TokenHash, tokenHash)) throw new ResourceNotFoundException();

        var proposal = await database.TournamentProposals
            .SingleOrDefaultAsync(item => item.Id == recipient.ProposalId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (proposal.ExpiresAt <= clock.GetCurrentInstant()) throw new ResourceNotFoundException();
        return (proposal, recipient);
    }

    /// <summary>
    /// Re-reads the proposal under a row lock so two approvers deciding at the same instant are
    /// serialized rather than both seeing <c>Pending</c>. The optimistic version is the second net.
    /// </summary>
    private static async Task<TournamentProposal> LockAsync(
        GonesDbContext database,
        Guid proposalId,
        CancellationToken cancellationToken)
    {
        var rows = await database.TournamentProposals
            .FromSql($"SELECT * FROM tournament_proposals WHERE id = {proposalId} FOR UPDATE")
            .ToListAsync(cancellationToken);
        return rows.Count == 1 ? rows[0] : throw new ResourceNotFoundException();
    }

    private static async Task SaveDecisionAsync(
        GonesDbContext database,
        IDbContextTransaction transaction,
        CancellationToken cancellationToken)
    {
        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Someone else decided between the lock and the write: their decision stands.
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    private static bool FixedTimeEquals(string storedHash, string computedHash) =>
        storedHash.Length == computedHash.Length
        && CryptographicOperations.FixedTimeEquals(
            Convert.FromHexString(storedHash),
            Convert.FromHexString(computedHash));

    private static TournamentPayloadRequest Payload(TournamentProposal proposal) =>
        JsonSerializer.Deserialize<TournamentPayloadRequest>(proposal.PayloadJson, PayloadJsonOptions)
            ?? throw new InvalidOperationException("Stored tournament proposal payload is invalid.");

    private static async Task<string> UsernameAsync(GonesDbContext database, Guid userId, CancellationToken cancellationToken) =>
        await database.UserProfiles.AsNoTracking()
            .Where(profile => profile.UserId == userId)
            .Select(profile => profile.Username)
            .SingleOrDefaultAsync(cancellationToken)
        ?? throw new ResourceNotFoundException();

    private static AuditRecord Audit(Guid actorId, string action, Guid proposalId, string diff, Instant now) => new()
    {
        ActorId = actorId,
        Action = action,
        EntityType = "tournament_proposal",
        EntityId = proposalId.ToString("D"),
        RedactedDiff = diff,
        OccurredAt = now
    };

    /// <summary>Bounds the work an anonymous caller can make the hash do; a real token is 43 characters.</summary>
    private const int MaximumTokenLength = 512;

    /// <summary>
    /// The single serializer contract for the stored payload: submission writes it and every decision
    /// reads it back, so the two must never drift apart.
    /// </summary>
    internal static readonly JsonSerializerOptions PayloadJsonOptions = new(JsonSerializerDefaults.Web);
}

internal sealed class TournamentProposalService(
    GonesDbContext database,
    TournamentPublicationService publication,
    INotificationOutbox outbox,
    IConfiguration configuration,
    IClock clock)
{
    private static readonly JsonSerializerOptions StoredJsonOptions = TournamentProposalEndpoints.PayloadJsonOptions;
    private const string AbsentValue = "—";

    public async Task<TournamentProposalResponse> SubmitAsync(
        Guid submitterUserId,
        TournamentProposalRequest request,
        CancellationToken cancellationToken)
    {
        var submitter = await database.Users.AsNoTracking()
            .SingleOrDefaultAsync(user => user.Id == submitterUserId, cancellationToken)
            ?? throw new AuthenticationFailedException();
        // Mailing strangers on an unverified account's word is how a calendar becomes a spam relay.
        if (!submitter.EmailConfirmed) throw new EmailVerificationRequiredException();
        // The database role is the authority here, not the token claim.
        if (GlobalRoles.IsAssignable(submitter.GlobalRole)) throw new DirectPublicationRequiredException();

        var submitterProfile = await database.UserProfiles.AsNoTracking()
            .SingleOrDefaultAsync(profile => profile.UserId == submitterUserId, cancellationToken)
            ?? throw new ResourceNotFoundException();

        var recipients = await LoadRecipientsAsync(request.RecipientUserIds, cancellationToken);
        ValidatePayloadShape(request.Tournament);
        await publication.ValidateProposalPayloadAsync(submitterUserId, request.Tournament, cancellationToken);

        var formatNames = await database.TournamentFormats.AsNoTracking()
            .Where(format => request.Tournament.FormatIds.Contains(format.Id))
            .OrderBy(format => format.SortOrder).ThenBy(format => format.Slug)
            .Select(format => format.Name)
            .ToListAsync(cancellationToken);

        var reviewOrigin = AccountLifecycleOptions.Load(configuration).PublicOrigin;
        var now = clock.GetCurrentInstant();
        var proposal = TournamentProposal.Create(
            submitterUserId,
            JsonSerializer.Serialize(request.Tournament, StoredJsonOptions),
            now);
        // Distinct token per recipient: the approver behind a review link has to be provable from
        // the token alone, so two recipients must never share one.
        var links = new List<(ProposalRecipient Recipient, Uri ReviewUrl)>(recipients.Count);
        foreach (var recipient in recipients)
        {
            var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
            proposal.AddRecipient(recipient.UserId, AccountLifecycleService.Hash(token), now);
            links.Add((recipient, new Uri(reviewOrigin, $"/tournament-requests/{Uri.EscapeDataString(token)}")));
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        database.TournamentProposals.Add(proposal);
        await database.SaveChangesAsync(cancellationToken);

        // Enqueued only once the proposal is durable: no mail may point at a review link that
        // never got stored.
        foreach (var (recipient, reviewUrl) in links)
        {
            outbox.Enqueue(new NotificationRequest(
                recipient.Email,
                recipient.PreferredLanguage,
                $"tournament-proposal:{proposal.Id:D}:{recipient.UserId:D}",
                new TournamentProposalTemplateModel(
                    recipient.Username,
                    submitterProfile.Username,
                    request.Tournament.Title,
                    Present(request.Tournament.Summary),
                    VenueAddress(request.Tournament),
                    Present(request.Tournament.StartsAtLocal),
                    Present(request.Tournament.EndsAtLocal),
                    request.Tournament.TimeZoneId,
                    formatNames.Count > 0 ? string.Join(", ", formatNames) : AbsentValue,
                    request.Tournament.Capacity?.ToString(CultureInfo.InvariantCulture) ?? AbsentValue,
                    reviewUrl),
                recipient.UserId));
        }

        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new TournamentProposalResponse(proposal.Id, proposal.Status.ToString(), proposal.ExpiresAt, links.Count);
    }

    private async Task<IReadOnlyList<ProposalRecipient>> LoadRecipientsAsync(
        IReadOnlyList<Guid> recipientUserIds,
        CancellationToken cancellationToken)
    {
        var requested = recipientUserIds.Distinct().ToArray();
        if (requested.Length == 0 || requested.Length != recipientUserIds.Count)
        {
            throw Validation("recipientUserIds", "At least one unique approver is required.");
        }

        var found = await (
            from user in database.Users.AsNoTracking()
            join profile in database.UserProfiles.AsNoTracking() on user.Id equals profile.UserId
            where requested.Contains(user.Id)
                && (user.GlobalRole == GlobalRoles.Organizer || user.GlobalRole == GlobalRoles.Admin)
                && profile.ClosedAt == null
                && user.Email != null
            orderby profile.Username
            select new ProposalRecipient(user.Id, profile.Username, user.Email!, profile.PreferredLanguage)
        ).ToListAsync(cancellationToken);
        // An unknown id and a non-approver id fail identically: a submitter must not be able to
        // probe which accounts exist.
        if (found.Count != requested.Length)
        {
            throw Validation("recipientUserIds", "One or more approvers are invalid.");
        }

        return found;
    }

    /// <summary>
    /// The endpoint filter only validates the top-level request, so the nested payload's own
    /// annotations are applied here — the proposal must satisfy the same contract as a direct publish.
    /// </summary>
    private static void ValidatePayloadShape(TournamentPayloadRequest payload)
    {
        var results = new List<ValidationResult>();
        if (Validator.TryValidateObject(payload, new ValidationContext(payload), results, validateAllProperties: true)) return;
        var failures = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var result in results)
        {
            foreach (var member in result.MemberNames.DefaultIfEmpty("tournament"))
            {
                var key = $"tournament.{JsonNamingPolicy.CamelCase.ConvertName(member)}";
                if (!failures.TryGetValue(key, out var messages)) failures[key] = messages = [];
                messages.Add(result.ErrorMessage ?? "Invalid value.");
            }
        }

        throw new ApiValidationException(failures.ToDictionary(
            pair => pair.Key,
            pair => pair.Value.Distinct(StringComparer.Ordinal).ToArray(),
            StringComparer.Ordinal));
    }

    private static string VenueAddress(TournamentPayloadRequest payload) => string.Join(
        ", ",
        new[]
        {
            payload.StreetAddress,
            string.IsNullOrWhiteSpace(payload.PostalCode) ? payload.City : $"{payload.PostalCode} {payload.City}",
            payload.Country
        }.Where(part => !string.IsNullOrWhiteSpace(part)));

    private static string Present(string? value) => string.IsNullOrWhiteSpace(value) ? AbsentValue : value.Trim();

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private sealed record ProposalRecipient(Guid UserId, string Username, string Email, string PreferredLanguage);
}

internal sealed record ProposalApproverResponse(Guid Id, string Username, string GlobalRole);

internal sealed record TournamentProposalRequest(
    [property: Required] TournamentPayloadRequest Tournament,
    [property: Required, MinLength(1)] IReadOnlyList<Guid> RecipientUserIds);

internal sealed record TournamentProposalResponse(Guid Id, string Status, Instant ExpiresAt, int RecipientCount);

internal sealed record TournamentProposalReviewResponse(
    Guid Id,
    TournamentPayloadRequest Tournament,
    string Status,
    string SubmittedByUsername,
    string ApproverUsername,
    Instant ExpiresAt);

internal sealed record TournamentProposalDecisionResponse(Guid ProposalId, string Status, string? Slug);

/// <summary>
/// The upper bound is the stored column, not a round number: a reason validation lets through has to
/// be a reason the database can keep.
/// </summary>
internal sealed record TournamentProposalRejectRequest(
    [property: Required, StringLength(TournamentProposal.MaximumRejectionReasonLength, MinimumLength = 1)] string Reason);
