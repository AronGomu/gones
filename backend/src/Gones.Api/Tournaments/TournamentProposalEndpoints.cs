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
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
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
}

internal sealed class TournamentProposalService(
    GonesDbContext database,
    TournamentPublicationService publication,
    INotificationOutbox outbox,
    IConfiguration configuration,
    IClock clock)
{
    private static readonly JsonSerializerOptions StoredJsonOptions = new(JsonSerializerDefaults.Web);
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
