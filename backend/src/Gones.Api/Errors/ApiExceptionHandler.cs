using Gones.Api.Security;
using Microsoft.AspNetCore.Diagnostics;
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

        context.Response.StatusCode = status;
        await context.Response.WriteAsJsonAsync(problem, options: null, contentType: "application/problem+json", cancellationToken: cancellationToken);
        return true;
    }
}
