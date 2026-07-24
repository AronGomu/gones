using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Security;
using Gones.Api.Validation;

namespace Gones.Api.Testing;

internal static class ContractTestEndpoints
{
    public static void MapContractTestEndpoints(this WebApplication app)
    {
        if (!app.Environment.IsEnvironment("Testing")) return;

        var group = app.MapGroup("/api/_contract");
        group.MapPost("/echo", (EchoRequest request) => Results.Ok(request))
            .AddEndpointFilter<DataAnnotationsValidationFilter>();
        group.MapPost("/validate", (ValidatedRequest request) => Results.Ok(request))
            .AddEndpointFilter<DataAnnotationsValidationFilter>();
        group.MapGet("/auth", () => Results.NoContent()).RequireAuthorization(AuthorizationPolicies.User);
        group.MapGet("/admin", () => Results.NoContent()).RequireAuthorization(AuthorizationPolicies.Admin);
        group.MapGet("/organizer", () => Results.NoContent()).RequireAuthorization(AuthorizationPolicies.Organizer);
        group.MapGet("/organization-member", () => Results.NoContent()).RequireAuthorization(AuthorizationPolicies.OrganizationMember);
        group.MapGet("/organization-owner", () => Results.NoContent()).RequireAuthorization(AuthorizationPolicies.OrganizationOwner);
        group.MapGet("/forbidden", () => Results.Forbid());
        group.MapPost("/timestamp", (TimestampRequest request) => Results.Ok(request));
        group.MapPost("/datetime", (DateTimeRequest request) => Results.Ok(request));
        group.MapPost("/json", (JsonElement request) => Results.Ok(request));
        group.MapGet("/bare-400", () => Results.StatusCode(400));
        group.MapGet("/bare-413", () => Results.StatusCode(413));
        group.MapGet("/bare-418", () => Results.StatusCode(418));
        group.MapGet("/bad-413", (Func<IResult>)(() => throw new BadHttpRequestException("large", 413)));
        group.MapGet("/missing", (Func<IResult>)(() => throw new ResourceNotFoundException()));
        group.MapGet("/stale", (Func<IResult>)(() => throw new ConcurrencyConflictException()));
        group.MapGet("/conflict", (Func<IResult>)(() => throw new ResourceConflictException()));
        group.MapGet("/boom", (Func<IResult>)(() => throw new InvalidOperationException("sensitive SQL user@example.test token-secret-value must not leak")));
    }

    internal sealed record EchoRequest([property: Required, StringLength(100)] string? Value);

    internal sealed record ValidatedRequest(
        [property: Required, StringLength(20, MinimumLength = 3)] string? Name);

    internal sealed record TimestampRequest(DateTimeOffset Timestamp);
    internal sealed record DateTimeRequest(DateTime Timestamp);
}
