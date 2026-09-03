using Gones.Api.Security;
using Gones.Application.Events;
using Microsoft.AspNetCore.Diagnostics;
using Npgsql;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;

namespace Gones.Api.Errors;

public sealed class ApiExceptionHandler(ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        var (status, code, message, errors) = exception switch
        {
            ApiValidationException validation => (validation.StatusCode, validation.Code, validation.SafeMessage, validation.Errors),
            ApiException known => (known.StatusCode, known.Code, known.SafeMessage, null),
            EventImageStorageUnavailableException => (StatusCodes.Status503ServiceUnavailable, EventProviderProblemCatalog.ImageStorageUnavailable, EventProviderProblemCatalog.ImageStorageUnavailableMessage, null),
            EventImageTooLargeException => (StatusCodes.Status413PayloadTooLarge, "image_too_large", "Event image exceeds 5 MiB.", null),
            EventImageTypeUnsupportedException => (StatusCodes.Status415UnsupportedMediaType, "image_type_unsupported", "Event image type is unsupported.", null),
            EventImageInvalidException => (StatusCodes.Status400BadRequest, "image_invalid", "Event image is invalid.", null),
            EventImageTooManyPixelsException => (StatusCodes.Status400BadRequest, "image_too_many_pixels", "Event image exceeds 25 megapixels.", null),
            EventImageAnimatedException => (StatusCodes.Status400BadRequest, "image_animated", "Animated Event images are unsupported.", null),
            _ when IsLostLockRace(exception) => (StatusCodes.Status409Conflict, "conflict", "Request conflicts with current resource state.", null),
            BadHttpRequestException badRequest when badRequest.StatusCode == StatusCodes.Status413PayloadTooLarge => (badRequest.StatusCode, "request_too_large", "Request body exceeds the allowed size.", null),
            BadHttpRequestException badRequest => (badRequest.StatusCode, "malformed_request", "Request is malformed.", null),
            _ => (StatusCodes.Status500InternalServerError, "internal_error", "An unexpected error occurred.", null)
        };

        if (status >= 500) logger.LogError(ApiLogEvents.UnhandledException, "Unhandled API exception; Event={Event}; ExceptionType={ExceptionType}; TraceId={TraceId}", "api.request.unhandled", exception.GetType().Name, context.TraceIdentifier);
        else logger.LogInformation(ApiLogEvents.RequestRejected, "API request rejected; Event={Event}; Code={Code}; TraceId={TraceId}", "api.request.rejected", code, context.TraceIdentifier);

        var problem = new ProblemDetails
        {
            Type = $"urn:gones:problem:{code}",
            Status = status,
            Title = ReasonPhrases.GetReasonPhrase(status),
            Detail = message,
            Instance = context.Request.Path
        };
        problem.Extensions["code"] = code;
        problem.Extensions["message"] = message;
        problem.Extensions["traceId"] = context.TraceIdentifier;
        if (errors is not null) problem.Extensions["errors"] = errors;
        // Latest-version metadata travels in the problem body: the exception-handler middleware
        // strips ETag response headers on error responses, so stale writers reload from here.
        if (exception is ConcurrencyConflictException { CurrentETag: not null } stale)
        {
            problem.Extensions["currentETag"] = stale.CurrentETag;
            if (stale.CurrentDocumentVersion is { } currentDocumentVersion) problem.Extensions["currentDocumentVersion"] = currentDocumentVersion;
        }
        // The blocking relation names are the whole point of this conflict: without them the caller
        // only learns that the deletion was refused, not what still has to be handed over.
        if (exception is AccountOwnsRecordsException owned) problem.Extensions["relations"] = owned.Relations;

        context.Response.StatusCode = status;
        await context.Response.WriteAsJsonAsync(problem, options: null, contentType: "application/problem+json", cancellationToken: cancellationToken);
        return true;
    }

    /// <summary>
    /// Postgres aborts one side of a deadlock or of a failed serialization instead of letting it
    /// hang. Losing that race is a concurrency outcome, not a server fault, and the caller may simply
    /// retry - so it leaves as the same 409 any other conflict does rather than as a raw 500. It can
    /// surface from a locking <c>SELECT ... FOR UPDATE</c> as well as from a save, which is why it is
    /// mapped here instead of in each write path.
    /// </summary>
    private static bool IsLostLockRace(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (current is PostgresException { SqlState: PostgresErrorCodes.DeadlockDetected or PostgresErrorCodes.SerializationFailure })
            {
                return true;
            }
        }
        return false;
    }
}
