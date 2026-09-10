using System.ComponentModel.DataAnnotations;
using Gones.Api.Errors;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Identity;

internal static class OwnerSetupEndpoints
{
    public static void MapOwnerSetupEndpoints(this RouteGroupBuilder auth)
    {
        auth.MapPost("/owner-setup", CompleteAsync)
            .WithName("CompleteOwnerSetup")
            .RequireRateLimiting(AuthRateLimiting.IpPolicy)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);
    }

    private static async Task<IResult> CompleteAsync(
        OwnerSetupRequest request, IConfiguration configuration, GonesDbContext database,
        UserManager<ApplicationUser> userManager, StagingAccessPolicy policy, IClock clock,
        CancellationToken cancellationToken)
    {
        OwnerSetupOptions options;
        try { options = OwnerSetupOptions.Load(configuration); }
        catch (InvalidOperationException) { throw new InvalidAccountActionTokenException(); }
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var setup = await OwnerSetupService.LockAsync(database, cancellationToken);
        if (await OwnerSetupService.DisqualifyAsync(database, setup, cancellationToken))
        {
            // A refusal must retain its tombstone, not roll it back with the HTTP exception.
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            throw new InvalidAccountActionTokenException();
        }
        var now = clock.GetCurrentInstant();
        if (!setup.Matches(options.Email, options.Environment, options.PublicOrigin)
            || !policy.IsEligible(options.Email) || setup.IssuedAt is not { } issued || !policy.IsCurrent(issued)
            || !setup.CanComplete(request.Token, now)) throw new InvalidAccountActionTokenException();
        var user = new ApplicationUser
        {
            Id = setup.UserId!.Value, UserName = request.Username, Email = options.Email, EmailConfirmed = true
        };
        UserProfile profile;
        try { profile = UserProfile.Create(user.Id, request.Username, request.FirstName, request.LastName, now); }
        catch (ArgumentException)
        {
            throw new ApiValidationException(new Dictionary<string, string[]> { ["Username"] = ["Profile fields are invalid."] });
        }
        try
        {
            var result = await userManager.CreateAsync(user, request.Password);
            if (!result.Succeeded)
            {
                if (result.Errors.Any(error => error.Code == "DuplicateUserName"))
                    throw new ApiValidationException(new Dictionary<string, string[]> { ["Username"] = ["Username is already taken."] }, "username_taken");
                throw new ApiValidationException(new Dictionary<string, string[]> { ["Password"] = result.Errors.Select(error => error.Description).ToArray() });
            }
            database.UserProfiles.Add(profile);
            setup.Complete(now);
            database.AuditRecords.Add(new AuditRecord
            {
                ActorId = user.Id, Action = "owner.setup.completed", EntityType = "user", EntityId = user.Id.ToString("D"),
                RedactedDiff = "{\"fields\":[\"password\",\"emailVerified\",\"profile\"]}", OccurredAt = now
            });
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException) { throw new ResourceConflictException(); }
        return Results.NoContent();
    }
}

internal sealed record OwnerSetupRequest(
    [property: Required, StringLength(256)] string Token,
    [property: Required] string Username,
    [property: Required, StringLength(100)] string FirstName,
    [property: Required, StringLength(100)] string LastName,
    [property: Required, StringLength(128)] string Password);
