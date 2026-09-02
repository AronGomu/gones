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
using Gones.Application.Events;
using Gones.Application.Notifications;
using Gones.Domain.Calendar;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using NodaTime;

namespace Gones.Api.Events;

/// <summary>
/// T16. A verified account that is neither Organizer nor Admin cannot publish a tournament; it
/// submits a proposal instead. The proposal is stored as JSON — never as a draft tournament — and
/// every chosen approver is mailed a review link carrying its own single-use token.
/// </summary>
internal static class EventProposalEndpoints
{
    public static void MapEventProposalEndpoints(this WebApplication app)
    {
        var proposals = app.MapGroup("/api/event-proposals")
            .RequireAuthorization(AuthorizationPolicies.User);

        proposals.MapGet("/approvers", ListApproversAsync)
            .Produces<IReadOnlyList<ProposalApproverResponse>>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized);

        proposals.MapPost(string.Empty, SubmitAsync)
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<EventProposalResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        // T17, A8: the mailed token *is* the credential, so this group is anonymous on purpose. With
        // no identity to throttle, the IP limiter is what bounds guessing at a 256-bit token.
        var tokens = app.MapGroup("/api/event-proposals/by-token")
            .AllowAnonymous()
            .RequireRateLimiting(AuthRateLimiting.IpPolicy);

        tokens.MapGet("/{token}", GetByTokenAsync)
            .Produces<EventProposalReviewResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        tokens.MapPost("/{token}/approve", ApproveAsync)
            .Produces<EventProposalDecisionResponse>()
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
    ///
    /// T26: the candidates are scoped to the organization the tournament would be published under.
    /// The list used to be every global Organizer and Admin regardless of the target, which let one
    /// unrelated organizer publish a live public tournament carrying another organization's name,
    /// website and contact email.
    /// </summary>
    private static async Task<IResult> ListApproversAsync(
        Guid organizationId,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        if (organizationId == Guid.Empty) throw Validation("organizationId", "Organization ID is required.");
        var authorized = ApproverUserIds(database, organizationId);
        var approvers = await (
            from user in database.Users.AsNoTracking()
            join profile in database.UserProfiles.AsNoTracking() on user.Id equals profile.UserId
            where authorized.Contains(user.Id)
            orderby profile.Username
            select new ProposalApproverResponse(user.Id, profile.Username, user.GlobalRole)
        ).ToListAsync(cancellationToken);
        return Results.Ok(approvers);
    }

    /// <summary>
    /// T26. The single rule for who may decide a proposal aimed at <paramref name="organizationId"/>,
    /// applied identically when the candidates are listed, when a submission names them, and again
    /// when a mailed token is presented: an Organizer or Admin holding an
    /// <c>organization_members</c> row for that organization, plus every global Admin.
    ///
    /// Global Admins are unconditional on purpose. Without that fallback an organization whose
    /// members are all plain accounts — or which has no members at all — would have nobody able to
    /// decide, and every proposal naming it would expire unread. Because they are unconditional, an
    /// Admin who *is* a member is already covered and needs no separate clause.
    ///
    /// A closed profile is excluded either way: a closed account is not someone who can consent.
    /// </summary>
    internal static IQueryable<Guid> ApproverUserIds(GonesDbContext database, Guid organizationId) =>
        from user in database.Users.AsNoTracking()
        join profile in database.UserProfiles.AsNoTracking() on user.Id equals profile.UserId
        where profile.ClosedAt == null
            && (user.GlobalRole == GlobalRoles.Admin
                || (user.GlobalRole == GlobalRoles.Organizer
                    && database.OrganizationMembers.Any(member =>
                        member.OrganizationId == organizationId && member.UserId == user.Id)))
        select user.Id;

    private static async Task<IResult> SubmitAsync(
        EventProposalRequest request,
        ClaimsPrincipal principal,
        EventProposalService proposals,
        CancellationToken cancellationToken)
    {
        var response = await proposals.SubmitAsync(
            OrganizationPrincipal.UserId(principal),
            request,
            cancellationToken);
        return Results.Created($"/api/event-proposals/{response.Id:D}", response);
    }

    /// <summary>
    /// Hands the approver everything the review page has to show. A decided proposal conflicts rather
    /// than replaying its payload: the link is spent, and saying so is not the same as leaking it again.
    /// </summary>
    private static async Task<IResult> GetByTokenAsync(
        string token,
        GonesDbContext database,
        IEventMarkdownRenderer markdown,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var (proposal, recipient) = await ResolveTokenAsync(token, database, clock, cancellationToken);
        if (!proposal.IsPending) throw new ResourceConflictException();
        var envelope = Envelope(proposal);
        var payload = envelope.Event;
        var organizationName = await database.Organizations.AsNoTracking()
            .Where(organization => organization.Id == payload.OrganizationId && organization.DeletedAt == null)
            .Select(organization => organization.Name)
            .SingleOrDefaultAsync(cancellationToken) ?? string.Empty;
        var formatNames = await database.TournamentFormats.AsNoTracking()
            .Where(format => payload.FormatIds.Contains(format.Id) && format.DeletedAt == null)
            .OrderBy(format => format.Slug)
            .Select(format => format.Name)
            .ToListAsync(cancellationToken);
        return Results.Ok(new EventProposalReviewResponse(
            proposal.Id,
            payload,
            payload.BodyMarkdown is null ? null : markdown.RenderAndSanitize(payload.BodyMarkdown),
            envelope.Location.TimeZoneId,
            DerivedEnd(payload.StartsAtLocal),
            proposal.Status.ToString(),
            await UsernameAsync(database, proposal.SubmittedByUserId, cancellationToken),
            await UsernameAsync(database, recipient.UserId, cancellationToken),
            proposal.ExpiresAt,
            organizationName,
            formatNames));
    }

    /// <summary>
    /// Publishes the stored payload as the **submitter**, so ownership and the tournament audit row
    /// name whoever proposed it; the approver is recorded in this endpoint's own audit diff instead.
    ///
    /// T26: the proposal's row lock is taken **before** anything is published, and publishing joins
    /// this transaction rather than opening a second one. The previous order published first, so an
    /// approve that lost the race to a reject left a live, registerable tournament hanging off a
    /// <c>Rejected</c> proposal — the submitter mailed a refusal, the approver shown a 409, and
    /// nothing anywhere to take the tournament back down. Holding the lock across the publish makes
    /// the two decisions strictly serial: the loser sees the winner's status and publishes nothing.
    ///
    /// One transaction also means the tournament and the decision commit together or not at all. The
    /// idempotency key stays derived from the proposal, so a retry after a failed attempt re-enters
    /// the same key rather than creating a second tournament.
    /// </summary>
    private static async Task<IResult> ApproveAsync(
        string token,
        GonesDbContext database,
        EventPublicationService publication,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var (proposal, recipient) = await ResolveTokenAsync(token, database, clock, cancellationToken);
        if (!proposal.IsPending) throw new ResourceConflictException();
        var proposalId = proposal.Id;
        var approverUserId = recipient.UserId;
        var submitterUserId = proposal.SubmittedByUserId;
        var envelope = Envelope(proposal);
        var payload = envelope.Event;

        database.ChangeTracker.Clear();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var claimed = await LockAsync(database, proposalId, cancellationToken);
        if (!claimed.IsPending)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }

        var outcome = await publication.PublishEventAsync(
            payload,
            submitterUserId,
            isAdmin: false,
            $"tournament-proposal:{proposalId:D}",
            envelope.Location,
            cancellationToken,
            // The *submitter* is not a member of the target organization — that is the whole reason
            // the proposal exists, and T26 kept it that way. What T26 narrowed is the other side:
            // the token above resolves only for someone who represents this organization, so the
            // consent this publish acts on is the organization's. Only this path relaxes the check;
            // PublishAsync keeps the default. ADR 0024 records the split.
            requireMembership: false);

        // Publishing may have cleared the change tracker on a slug retry, so the proposal is read
        // again rather than carried across that boundary. The row lock this transaction already
        // holds makes the second read free of races.
        database.ChangeTracker.Clear();
        var locked = await LockAsync(database, proposalId, cancellationToken);
        var now = clock.GetCurrentInstant();
        locked.Approve(approverUserId, now);
        database.AuditRecords.Add(Audit(
            approverUserId,
            "tournament-proposal.approved",
            proposalId,
            JsonSerializer.Serialize(
                new { approverUserId = approverUserId.ToString("D"), eventId = outcome.Response.Id.ToString("D") },
                PayloadJsonOptions),
            now));
        await SaveDecisionAsync(database, transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(new EventProposalDecisionResponse(proposalId, locked.Status.ToString(), outcome.Response.Slug));
    }

    /// <summary>
    /// Refusing publishes nothing. The reason reaches the submitter through the mail body only: the
    /// audit row keeps its length, never its text.
    /// </summary>
    private static async Task<IResult> RejectAsync(
        string token,
        EventProposalRejectRequest request,
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
        var eventName = Payload(proposal).Title;
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
        var calendarUrl = new Uri(AccountLifecycleOptions.Load(configuration).PublicOrigin, "/events");

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
                eventName,
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
    /// never logged, echoed or stored. An unknown token, an expired proposal and a holder who no
    /// longer represents the target organization fail identically: a 404 must not confirm that a
    /// proposal ever existed, nor that the reader was once entitled to decide it.
    ///
    /// T26: authority is re-read here, not trusted from submission time. A link is live for seven
    /// days, and in that window an approver can be demoted to <c>User</c>, have their profile closed,
    /// or lose the organization membership that made them an approver at all. Any of those and the
    /// link stops publishing — checking only at submission meant a stale mail outlived the standing
    /// that justified it.
    /// </summary>
    private static async Task<(EventProposal Proposal, EventProposalRecipient Recipient)> ResolveTokenAsync(
        string token,
        GonesDbContext database,
        IClock clock,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > MaximumTokenLength) throw new ResourceNotFoundException();
        var tokenHash = AccountLifecycleService.Hash(token);
        var recipient = await database.EventProposalRecipients
            .SingleOrDefaultAsync(item => item.TokenHash == tokenHash, cancellationToken);
        // The index lookup already matched, but the comparison that decides is the constant-time one:
        // it costs nothing here and keeps a future non-indexed scan from leaking a prefix by timing.
        if (recipient is null || !FixedTimeEquals(recipient.TokenHash, tokenHash)) throw new ResourceNotFoundException();

        var proposal = await database.EventProposals
            .SingleOrDefaultAsync(item => item.Id == recipient.ProposalId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (proposal.ExpiresAt <= clock.GetCurrentInstant()) throw new ResourceNotFoundException();

        var organizationId = Payload(proposal).OrganizationId;
        if (!await ApproverUserIds(database, organizationId)
            .AnyAsync(userId => userId == recipient.UserId, cancellationToken))
        {
            throw new ResourceNotFoundException();
        }

        return (proposal, recipient);
    }

    /// <summary>
    /// Re-reads the proposal under a row lock so two approvers deciding at the same instant are
    /// serialized rather than both seeing <c>Pending</c>. The optimistic version is the second net.
    /// </summary>
    private static async Task<EventProposal> LockAsync(
        GonesDbContext database,
        Guid proposalId,
        CancellationToken cancellationToken)
    {
        var rows = await database.EventProposals
            .FromSql($"SELECT * FROM event_proposals WHERE id = {proposalId} FOR UPDATE")
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

    private static string DerivedEnd(string startsAtLocal) =>
        startsAtLocal.Length >= 10 ? $"{startsAtLocal[..10]}T23:59:59" : string.Empty;

    private static EventPayloadRequest Payload(EventProposal proposal) => Envelope(proposal).Event;

    private static EventProposalEnvelope Envelope(EventProposal proposal)
    {
        var envelope = JsonSerializer.Deserialize<EventProposalEnvelope>(proposal.PayloadJson, PayloadJsonOptions)
            ?? throw new ResourceConflictException();
        if (envelope.Version != EventProposalEnvelope.CurrentVersion
            || envelope.Event is null
            || envelope.Event.Location is null
            || envelope.Event.Images is null
            || envelope.Event.Images.Count != 0
            || envelope.Location is null
            || string.IsNullOrWhiteSpace(envelope.PayloadHash))
        {
            throw new ResourceConflictException();
        }
        try
        {
            EventPublicationService.ValidatePayloadShape(envelope.Event);
        }
        catch (ApiValidationException)
        {
            throw new ResourceConflictException();
        }
        if (!EventPublicationService.FixedTimePayloadHash(envelope.PayloadHash, EventPublicationService.PayloadHash(envelope.Event))
            || !EventPublicationService.LocationMatches(envelope.Event.Location, envelope.Location))
        {
            throw new ResourceConflictException();
        }
        return envelope;
    }

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

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    /// <summary>Bounds the work an anonymous caller can make the hash do; a real token is 43 characters.</summary>
    private const int MaximumTokenLength = 512;

    /// <summary>
    /// T26. An upper bound on how many mailboxes one submission can reach. The list had a floor of
    /// one and no ceiling, which made a single request an arbitrarily large mail fan-out. Ten is far
    /// above what a submitter choosing reviewers needs, and far below anything worth using as an
    /// amplifier.
    /// </summary>
    internal const int MaximumRecipientCount = 10;

    /// <summary>
    /// The single serializer contract for the stored payload: submission writes it and every decision
    /// reads it back, so the two must never drift apart.
    /// </summary>
    internal static readonly JsonSerializerOptions PayloadJsonOptions = new(JsonSerializerDefaults.Web);
}

internal sealed class EventProposalService(
    GonesDbContext database,
    EventPublicationService publication,
    INotificationOutbox outbox,
    IConfiguration configuration,
    IClock clock)
{
    private static readonly JsonSerializerOptions StoredJsonOptions = EventProposalEndpoints.PayloadJsonOptions;
    private const string AbsentValue = "—";

    public async Task<EventProposalResponse> SubmitAsync(
        Guid submitterUserId,
        EventProposalRequest request,
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

        // Shape first: the recipient rule below is scoped to the target organization, so the payload
        // has to be a well-formed one before it can say which organization that is.
        ValidatePayloadShape(request.Event);
        var recipients = await LoadRecipientsAsync(request.Event.OrganizationId, request.RecipientUserIds, cancellationToken);
        var location = await publication.ValidateProposalPayloadAsync(submitterUserId, request.Event, cancellationToken);

        var formatNames = await database.TournamentFormats.AsNoTracking()
            .Where(format => request.Event.FormatIds.Contains(format.Id))
            .OrderBy(format => format.SortOrder).ThenBy(format => format.Slug)
            .Select(format => format.Name)
            .ToListAsync(cancellationToken);

        var reviewOrigin = AccountLifecycleOptions.Load(configuration).PublicOrigin;
        var now = clock.GetCurrentInstant();
        var envelope = EventProposalEnvelope.Create(request.Event, location);
        var proposal = EventProposal.Create(
            submitterUserId,
            JsonSerializer.Serialize(envelope, StoredJsonOptions),
            now);
        // Distinct token per recipient: the approver behind a review link has to be provable from
        // the token alone, so two recipients must never share one.
        var links = new List<(ProposalRecipient Recipient, Uri ReviewUrl)>(recipients.Count);
        foreach (var recipient in recipients)
        {
            var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
            proposal.AddRecipient(recipient.UserId, AccountLifecycleService.Hash(token), now);
            links.Add((recipient, new Uri(reviewOrigin, $"/event-requests/{Uri.EscapeDataString(token)}")));
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        database.EventProposals.Add(proposal);
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
                    request.Event.Title,
                    Present(request.Event.Summary),
                    VenueAddress(request.Event),
                    Present(request.Event.StartsAtLocal),
                    Present(ProposalEnd(request.Event.StartsAtLocal)),
                    location.TimeZoneId,
                    formatNames.Count > 0 ? string.Join(", ", formatNames) : AbsentValue,
                    request.Event.Capacity.ToString(CultureInfo.InvariantCulture),
                    reviewUrl),
                recipient.UserId));
        }

        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new EventProposalResponse(proposal.Id, proposal.Status.ToString(), proposal.ExpiresAt, links.Count);
    }

    private async Task<IReadOnlyList<ProposalRecipient>> LoadRecipientsAsync(
        Guid organizationId,
        IReadOnlyList<Guid> recipientUserIds,
        CancellationToken cancellationToken)
    {
        var requested = recipientUserIds.Distinct().ToArray();
        if (requested.Length == 0 || requested.Length != recipientUserIds.Count)
        {
            throw Validation("recipientUserIds", "At least one unique approver is required.");
        }
        // Refused before the lookup runs, so an oversized list costs one comparison rather than a
        // query. The annotation on the request record says the same thing to the OpenAPI contract.
        if (requested.Length > EventProposalEndpoints.MaximumRecipientCount)
        {
            throw Validation(
                "recipientUserIds",
                $"At most {EventProposalEndpoints.MaximumRecipientCount} approvers can be chosen.");
        }

        // T26: the same org-scoped rule the picker was populated from. A global Organizer with no
        // standing over this organization is not a valid recipient, whatever the client sent.
        var authorized = EventProposalEndpoints.ApproverUserIds(database, organizationId);
        var found = await (
            from user in database.Users.AsNoTracking()
            join profile in database.UserProfiles.AsNoTracking() on user.Id equals profile.UserId
            where requested.Contains(user.Id)
                && authorized.Contains(user.Id)
                && user.Email != null
            orderby profile.Username
            select new ProposalRecipient(user.Id, profile.Username, user.Email!, profile.PreferredLanguage)
        ).ToListAsync(cancellationToken);
        // An unknown id, a non-approver id and an approver who does not represent this organization
        // fail identically: a submitter must not be able to probe which accounts exist, nor map out
        // who belongs to which organization.
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
    private static void ValidatePayloadShape(EventPayloadRequest payload) =>
        EventPublicationService.ValidatePayloadShape(payload, "event.");

    private static string VenueAddress(EventPayloadRequest payload) => string.Join(
        ", ",
        new[]
        {
            payload.Location.StreetAddress,
            $"{payload.Location.PostalCode} {payload.Location.City}",
            payload.Location.Region,
            payload.Location.Country
        }.Where(part => !string.IsNullOrWhiteSpace(part)));

    private static string ProposalEnd(string startsAtLocal) =>
        startsAtLocal.Length >= 10 ? $"{startsAtLocal[..10]}T23:59:59" : AbsentValue;

    private static string Present(string? value) => string.IsNullOrWhiteSpace(value) ? AbsentValue : value.Trim();

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private sealed record ProposalRecipient(Guid UserId, string Username, string Email, string PreferredLanguage);
}

internal sealed record ProposalApproverResponse(Guid Id, string Username, string GlobalRole);

internal sealed record EventProposalEnvelope(
    int Version,
    string PayloadHash,
    EventPayloadRequest Event,
    ValidatedEventLocation Location)
{
    public const int CurrentVersion = 1;

    public static EventProposalEnvelope Create(EventPayloadRequest payload, ValidatedEventLocation location) =>
        new(CurrentVersion, EventPublicationService.PayloadHash(payload), payload, location);
}

internal sealed record EventProposalRequest(
    [property: Required] EventPayloadRequest Event,
    [property: Required, MinLength(1), MaxLength(EventProposalEndpoints.MaximumRecipientCount)]
    IReadOnlyList<Guid> RecipientUserIds);

internal sealed record EventProposalResponse(Guid Id, string Status, Instant ExpiresAt, int RecipientCount);

internal sealed record EventProposalReviewResponse(
    Guid Id,
    EventPayloadRequest Event,
    string? BodyHtml,
    string TimeZoneId,
    string EndsAtLocal,
    string Status,
    string SubmittedByUsername,
    string ApproverUsername,
    Instant ExpiresAt,
    string OrganizationName,
    IReadOnlyList<string> FormatNames);

internal sealed record EventProposalDecisionResponse(Guid ProposalId, string Status, string? Slug);

/// <summary>
/// The upper bound is the stored column, not a round number: a reason validation lets through has to
/// be a reason the database can keep.
/// </summary>
internal sealed record EventProposalRejectRequest(
    [property: Required, StringLength(EventProposal.MaximumRejectionReasonLength, MinimumLength = 1)] string Reason);
