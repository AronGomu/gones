namespace Gones.Api.Errors;

public abstract class ApiException(string code, string safeMessage, int statusCode) : Exception(safeMessage)
{
    public string Code { get; } = code;
    public string SafeMessage { get; } = safeMessage;
    public int StatusCode { get; } = statusCode;
}

/// <summary>
/// The default <c>validation_failed</c> code stays the wire contract for every existing caller; a
/// narrower code (for example <c>username_taken</c>) is passed when the client has to tell one
/// rejection apart from another to phrase it in the reader's own language.
/// </summary>
public sealed class ApiValidationException(IReadOnlyDictionary<string, string[]> errors, string code = "validation_failed")
    : ApiException(code, "One or more fields are invalid.", StatusCodes.Status400BadRequest)
{
    public IReadOnlyDictionary<string, string[]> Errors { get; } = errors;
}

public sealed class AuthenticationFailedException() : ApiException("invalid_credentials", "Credentials are invalid.", StatusCodes.Status401Unauthorized);
public sealed class InvalidAccountActionTokenException() : ApiException("invalid_account_action", "Account action link is invalid or expired.", StatusCodes.Status400BadRequest);
public sealed class RateLimitExceededException() : ApiException("rate_limited", "Too many requests. Try again later.", StatusCodes.Status429TooManyRequests);
public sealed class ResourceNotFoundException() : ApiException("not_found", "Resource not found.", StatusCodes.Status404NotFound);
public sealed class ConcurrencyConflictException(string? currentETag = null, long? currentDocumentVersion = null)
    : ApiException("stale_version", "Resource changed since it was read.", StatusCodes.Status412PreconditionFailed)
{
    /// <summary>Latest strong ETag of the resource, surfaced so stale writers can reload and retry.</summary>
    public string? CurrentETag { get; } = currentETag;
    public long? CurrentDocumentVersion { get; } = currentDocumentVersion;
}
/// <summary>
/// The default <c>conflict</c> code stays the wire contract for every existing caller; a narrower
/// code (for example <c>lastAdmin</c>) is passed when the client has to tell conflicts apart.
/// </summary>
public sealed class ResourceConflictException(string code = "conflict")
    : ApiException(code, "Request conflicts with current resource state.", StatusCodes.Status409Conflict);
/// <summary>
/// A malformed archive query string. Separate from <see cref="ApiValidationException"/> because that
/// one answers with a field map for a submitted form, while a bad query parameter has no field to map
/// and the browser cache keys its retry decision on the code alone. Separate from the framework's own
/// binding failure because <c>UseStatusCodePages</c> labels that <c>malformed_request</c>, which says
/// nothing about which parameter was wrong.
/// </summary>
public sealed class ArchiveInvalidRequestException(string safeMessage)
    : ApiException("invalid_request", safeMessage, StatusCodes.Status400BadRequest);
/// <summary>
/// The account still owns rows behind a restricting foreign key, so it cannot be hard-deleted.
/// <see cref="Relations"/> names the offending <c>table.column</c> pairs so a caller can say what
/// has to be handed over first instead of guessing.
/// </summary>
public sealed class AccountOwnsRecordsException(IReadOnlyList<string> relations)
    : ApiException("account_owns_records", "Account still owns records that must be reassigned or removed first.", StatusCodes.Status409Conflict)
{
    public IReadOnlyList<string> Relations { get; } = relations;
}
public sealed class RequestBodyTooLargeException() : ApiException("request_too_large", "Request body exceeds the allowed size.", StatusCodes.Status413PayloadTooLarge);
public sealed class InvalidOAuthStateException() : ApiException("invalid_oauth_state", "OAuth request is invalid or expired.", StatusCodes.Status400BadRequest);
public sealed class InvalidOAuthTicketException() : ApiException("invalid_oauth_ticket", "OAuth completion link is invalid or expired.", StatusCodes.Status400BadRequest);
public sealed class OAuthProviderRejectedException() : ApiException("oauth_provider_rejected", "OAuth provider response could not be accepted.", StatusCodes.Status400BadRequest);
public sealed class OAuthProviderUnavailableException() : ApiException("oauth_provider_unavailable", "OAuth provider is unavailable.", StatusCodes.Status404NotFound);

public static class EventProviderProblemCatalog
{
    public const string LocationUnresolved = "location_unresolved";
    public const string LocationProviderUnavailable = "location_provider_unavailable";
    public const string ImageStorageUnavailable = "image_storage_unavailable";
    public const string LocationUnresolvedMessage = "Choose a complete resolved location.";
    public const string LocationProviderUnavailableMessage = "Event location provider is unavailable.";
    public const string ImageStorageUnavailableMessage = "Event image storage is unavailable.";
}
public sealed class ExistingEmailRequiresLinkException() : ApiException("existing_email_requires_link", "Sign in with your existing account, then link this provider from account settings.", StatusCodes.Status409Conflict);
public sealed class LastLoginMethodException() : ApiException("last_login_method", "Final login method cannot be removed.", StatusCodes.Status409Conflict);
public sealed class LocationTokenInvalidException() : ApiException("location_token_invalid", "Event location token is invalid.", StatusCodes.Status400BadRequest);
public sealed class LocationTokenExpiredException() : ApiException("location_token_expired", "Event location token expired.", StatusCodes.Status400BadRequest);
public sealed class IdempotencyConflictException() : ApiException("idempotency_conflict", "Idempotency key was already used for another request.", StatusCodes.Status409Conflict);
public sealed class EmailVerificationRequiredException() : ApiException("email_verification_required", "Verified email is required to register.", StatusCodes.Status403Forbidden);
/// <summary>
/// Organizers and Admins publish tournaments themselves; a proposal is the path for everyone else,
/// so letting them mail an approval request to each other would be a pointless detour.
/// </summary>
public sealed class DirectPublicationRequiredException() : ApiException("direct_publication_required", "Organizers and administrators publish tournaments directly.", StatusCodes.Status403Forbidden);
/// <summary>
/// An organization with no members is a Draft: nobody represents it, so nothing may be published in
/// its name. Draft is derived from the member count, never stored, so this clears the moment an
/// organizer is added.
/// </summary>
public sealed class OrganizationIsDraftException() : ApiException("organization_is_draft", "Organization has no organizer and cannot publish.", StatusCodes.Status409Conflict);
/// <summary>
/// Creating a membership is what promotes an account to the global <c>Organizer</c> role, and that
/// role gates surfaces no organization scopes (the league archive, the live server, player-name
/// maintenance). An organization Owner minting memberships would therefore be minting privilege far
/// outside their own organization, so only an administrator may add a member or transfer ownership.
/// Removing a member and changing a member's organization role stay Owner-callable: neither grants
/// anything - a removal can only strip privilege from a member of the Owner's own organization, and
/// an Owner/Organizer flip leaves the membership, and so the derived global role, untouched.
/// </summary>
public sealed class AdminMembershipGrantRequiredException() : ApiException("admin_membership_grant_required", "Only an administrator can add an organization member or transfer ownership.", StatusCodes.Status403Forbidden);
public sealed class RegistrationBlockedException() : ApiException("registration_blocked", "Registration is blocked for this organization.", StatusCodes.Status403Forbidden);
public sealed class RegistrationAlreadyActiveException() : ApiException("registration_already_active", "User already has an active registration for this Tournament.", StatusCodes.Status409Conflict);
public sealed class EventFullException() : ApiException("event_full", "Tournament has no registration slots available.", StatusCodes.Status409Conflict);
public sealed class EventNotOpenException() : ApiException("event_not_open", "Tournament is not open for registration.", StatusCodes.Status409Conflict);
public sealed class RegistrationClosedException() : ApiException("registration_closed", "Tournament registration has closed.", StatusCodes.Status409Conflict);
public sealed class UnregistrationClosedException() : ApiException("unregistration_closed", "Tournament unregistration has closed.", StatusCodes.Status409Conflict);
public sealed class ActiveRegistrationNotFoundException() : ApiException("registration_not_found", "Active registration was not found.", StatusCodes.Status404NotFound);
public sealed class OrganizationBlockAlreadyActiveException() : ApiException("organization_block_already_active", "User already has an active organization block.", StatusCodes.Status409Conflict);
public sealed class ExportRowLimitExceededException() : ApiException("export_row_limit_exceeded", "Participant export exceeds the maximum row count.", StatusCodes.Status409Conflict);
