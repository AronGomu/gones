namespace Gones.Api.Errors;

public abstract class ApiException(string code, string safeMessage, int statusCode) : Exception(safeMessage)
{
    public string Code { get; } = code;
    public string SafeMessage { get; } = safeMessage;
    public int StatusCode { get; } = statusCode;
}

public sealed class ApiValidationException(IReadOnlyDictionary<string, string[]> errors)
    : ApiException("validation_failed", "One or more fields are invalid.", StatusCodes.Status400BadRequest)
{
    public IReadOnlyDictionary<string, string[]> Errors { get; } = errors;
}

public sealed class AuthenticationFailedException() : ApiException("invalid_credentials", "Credentials are invalid.", StatusCodes.Status401Unauthorized);
public sealed class InvalidAccountActionTokenException() : ApiException("invalid_account_action", "Account action link is invalid or expired.", StatusCodes.Status400BadRequest);
public sealed class RateLimitExceededException() : ApiException("rate_limited", "Too many requests. Try again later.", StatusCodes.Status429TooManyRequests);
public sealed class ResourceNotFoundException() : ApiException("not_found", "Resource not found.", StatusCodes.Status404NotFound);
public sealed class ConcurrencyConflictException() : ApiException("stale_version", "Resource changed since it was read.", StatusCodes.Status412PreconditionFailed);
public sealed class ResourceConflictException() : ApiException("conflict", "Request conflicts with current resource state.", StatusCodes.Status409Conflict);
public sealed class RequestBodyTooLargeException() : ApiException("request_too_large", "Request body exceeds the allowed size.", StatusCodes.Status413PayloadTooLarge);
public sealed class InvalidOAuthStateException() : ApiException("invalid_oauth_state", "OAuth request is invalid or expired.", StatusCodes.Status400BadRequest);
public sealed class InvalidOAuthTicketException() : ApiException("invalid_oauth_ticket", "OAuth completion link is invalid or expired.", StatusCodes.Status400BadRequest);
public sealed class OAuthProviderRejectedException() : ApiException("oauth_provider_rejected", "OAuth provider response could not be accepted.", StatusCodes.Status400BadRequest);
public sealed class OAuthProviderUnavailableException() : ApiException("oauth_provider_unavailable", "OAuth provider is unavailable.", StatusCodes.Status404NotFound);
public sealed class ExistingEmailRequiresLinkException() : ApiException("existing_email_requires_link", "Sign in with your existing account, then link this provider from account settings.", StatusCodes.Status409Conflict);
public sealed class LastLoginMethodException() : ApiException("last_login_method", "Final login method cannot be removed.", StatusCodes.Status409Conflict);
