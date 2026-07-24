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

public sealed class ResourceNotFoundException() : ApiException("not_found", "Resource not found.", StatusCodes.Status404NotFound);
public sealed class ConcurrencyConflictException() : ApiException("stale_version", "Resource changed since it was read.", StatusCodes.Status412PreconditionFailed);
public sealed class ResourceConflictException() : ApiException("conflict", "Request conflicts with current resource state.", StatusCodes.Status409Conflict);
public sealed class RequestBodyTooLargeException() : ApiException("request_too_large", "Request body exceeds the allowed size.", StatusCodes.Status413PayloadTooLarge);
