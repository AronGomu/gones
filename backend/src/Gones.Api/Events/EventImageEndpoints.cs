using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Gones.Api.Errors;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Application.Events;
using Gones.Domain.Calendar;
using Gones.Infrastructure.EventProviders;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Events;

internal static class EventImageEndpoints
{
    public static void MapEventImageEndpoints(this WebApplication app)
    {
        var images = app.MapGroup("/api/event-images");
        images.MapPost(string.Empty, UploadAsync)
            .RequireAuthorization(AuthorizationPolicies.User)
            .Accepts<EventImageUploadForm>("multipart/form-data")
            .Produces<EventImageUploadResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status415UnsupportedMediaType)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);
        images.MapDelete("/{imageId:guid}", DeleteAsync)
            .RequireAuthorization(AuthorizationPolicies.User)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        images.MapGet("/{imageId:guid}/variants/{width:int}", ReadVariantAsync)
            .WithName("Variants")
            .AllowAnonymous()
            .Produces(StatusCodes.Status200OK, contentType: "image/webp")
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);
    }

    private static async Task<IResult> UploadAsync(
        HttpRequest request,
        ClaimsPrincipal principal,
        EventImageUploadService uploads,
        CancellationToken cancellationToken)
    {
        if (!request.HasFormContentType) throw new EventImageTypeUnsupportedException();
        IFormCollection form;
        try
        {
            form = await request.ReadFormAsync(cancellationToken);
        }
        catch (InvalidDataException)
        {
            throw new EventImageInvalidException();
        }
        if (form.Count != 0 || form.Files.Count != 1 || !string.Equals(form.Files[0].Name, "file", StringComparison.Ordinal))
        {
            throw new EventImageInvalidException();
        }

        var file = form.Files[0];
        var response = await uploads.UploadAsync(
            OrganizationPrincipal.UserId(principal),
            file,
            cancellationToken);
        return Results.Created($"/api/event-images/{response.Id:D}", response);
    }

    private static async Task<IResult> DeleteAsync(
        Guid imageId,
        ClaimsPrincipal principal,
        GonesDbContext database,
        EventImageCleanupService cleanup,
        ILogger<EventImageCleanupService> cleanupLogger,
        IClock clock,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var image = await database.EventImages.FromSqlInterpolated($$"""
            SELECT * FROM event_images WHERE id = {{imageId}} FOR UPDATE
            """).SingleOrDefaultAsync(cancellationToken) ?? throw new ResourceNotFoundException();
        if (image.UploadedByUserId != OrganizationPrincipal.UserId(principal)
            || image.State != EventImageState.Temporary
            || image.ExpiresAt <= clock.GetCurrentInstant())
        {
            throw new ResourceConflictException("image_state_conflict");
        }

        await cleanup.EnqueueAndDeleteAsync(image, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        using var cleanupTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        try
        {
            await cleanup.ProcessImageObjectDeletionsAsync(image.Id, cleanupTimeout.Token);
        }
        catch (Exception exception)
        {
            cleanupLogger.LogWarning(
                EventImageCleanupLogEvents.PostCommitCleanupFailed,
                "Event image post-commit object cleanup deferred; Event={Event}; ImageId={ImageId}; ExceptionType={ExceptionType}",
                "event_image.object_delete.post_commit_deferred",
                image.Id,
                exception.GetType().Name);
        }
        return Results.NoContent();
    }

    private static async Task<IResult> ReadVariantAsync(
        Guid imageId,
        int width,
        ClaimsPrincipal principal,
        HttpResponse response,
        GonesDbContext database,
        IEventImageObjectStore objects,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var image = await database.EventImages.AsNoTracking().SingleOrDefaultAsync(item => item.Id == imageId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (!EventImage.VariantWidthsFor(image.Width).Contains(width)) throw new ResourceNotFoundException();

        switch (image.State)
        {
            case EventImageState.Temporary:
                if (principal.Identity?.IsAuthenticated != true) return Results.Unauthorized();
                if (image.UploadedByUserId != OrganizationPrincipal.UserId(principal)
                    || image.ExpiresAt <= clock.GetCurrentInstant())
                {
                    throw new ResourceNotFoundException();
                }
                response.Headers.CacheControl = "no-store";
                break;
            case EventImageState.EventOwned:
                response.Headers.CacheControl = "public, max-age=31536000, immutable";
                break;
            case EventImageState.ProposalOwned:
            default:
                throw new ResourceNotFoundException();
        }

        try
        {
            var content = await objects.OpenReadAsync(EventImageObjectKeys.Variant(image.Id, width), cancellationToken);
            return Results.Stream(content, "image/webp");
        }
        catch (KeyNotFoundException)
        {
            throw new ResourceNotFoundException();
        }
    }
}

internal sealed class EventImageUploadService(
    GonesDbContext database,
    IEventImageProcessor processor,
    IEventImageObjectStore objects,
    EventImageCleanupService cleanup,
    IClock clock,
    ILogger<EventImageUploadService> logger)
{
    public async Task<EventImageUploadResponse> UploadAsync(
        Guid userId,
        IFormFile file,
        CancellationToken cancellationToken)
    {
        var verified = await database.Users.AsNoTracking()
            .AnyAsync(user => user.Id == userId && user.EmailConfirmed, cancellationToken);
        if (!verified) throw new EmailVerificationRequiredException();
        if (file.Length > EventImageUploadLimits.MaximumBytes) throw new EventImageTooLargeException();
        if (file.Length <= 0) throw new EventImageInvalidException();
        if (!EventImageUploadLimits.ContentTypes.Contains(file.ContentType)) throw new EventImageTypeUnsupportedException();

        ProcessedEventImage processed;
        await using (var source = file.OpenReadStream())
        {
            processed = await processor.ProcessAsync(source, file.ContentType, cancellationToken);
        }
        ValidateProcessorResult(processed);

        var imageId = Guid.NewGuid();
        var uploadedKeys = new List<string>(processed.Variants.Count);
        try
        {
            foreach (var variant in processed.Variants)
            {
                var key = EventImageObjectKeys.Variant(imageId, variant.Width);
                uploadedKeys.Add(key);
                await using var content = new MemoryStream(variant.WebP.ToArray(), writable: false);
                await objects.PutAsync(key, content, "image/webp", cancellationToken);
            }

            var image = EventImage.CreateTemporary(imageId, userId, processed.Width, processed.Height, clock.GetCurrentInstant());
            database.EventImages.Add(image);
            await database.SaveChangesAsync(cancellationToken);
            return new EventImageUploadResponse(
                image.Id,
                "Temporary",
                image.Width,
                image.Height,
                image.ExpiresAt!.Value,
                processed.Variants.Select(variant => new EventImageVariantResponse(
                    variant.Width,
                    variant.Height,
                    $"/api/event-images/{image.Id:D}/variants/{variant.Width}")).ToArray());
        }
        catch
        {
            using var compensationTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await CompensateAsync(imageId, uploadedKeys, compensationTimeout.Token);
            throw;
        }
    }

    private async Task CompensateAsync(Guid imageId, IReadOnlyCollection<string> uploadedKeys, CancellationToken cancellationToken)
    {
        if (uploadedKeys.Count == 0) return;
        database.ChangeTracker.Clear();
        var now = clock.GetCurrentInstant();
        try
        {
            foreach (var key in uploadedKeys)
            {
                database.EventImageObjectDeletions.Add(EventImageObjectDeletion.Create(imageId, key, now));
            }
            await database.SaveChangesAsync(cancellationToken);
            await cleanup.ProcessImageObjectDeletionsAsync(imageId, cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogError(
                EventImageUploadLogEvents.CompensationFailed,
                "Event image upload compensation queue failed; Event={Event}; ImageId={ImageId}; ObjectCount={ObjectCount}; ExceptionType={ExceptionType}",
                "event_image.upload.compensation_queue_failed",
                imageId,
                uploadedKeys.Count,
                exception.GetType().Name);
            foreach (var key in uploadedKeys)
            {
                try
                {
                    await objects.DeleteAsync(key, cancellationToken);
                }
                catch (Exception deleteException)
                {
                    logger.LogError(
                        EventImageUploadLogEvents.CompensationFailed,
                        "Event image upload direct compensation failed; Event={Event}; ImageId={ImageId}; ObjectKey={ObjectKey}; ExceptionType={ExceptionType}",
                        "event_image.upload.compensation_delete_failed",
                        imageId,
                        key,
                        deleteException.GetType().Name);
                }
            }
        }
    }

    private static void ValidateProcessorResult(ProcessedEventImage processed)
    {
        if (processed.Width <= 0 || processed.Height <= 0 || processed.Variants.Count == 0) throw new EventImageInvalidException();
        var expectedWidths = EventImage.VariantWidthsFor(processed.Width);
        if (!processed.Variants.Select(variant => variant.Width).SequenceEqual(expectedWidths)
            || processed.Variants.Any(variant => variant.Height <= 0 || variant.WebP.IsEmpty))
        {
            throw new EventImageInvalidException();
        }
    }
}

internal sealed record EventImageUploadForm([property: Required] IFormFile File);
internal sealed record EventImageVariantResponse(int Width, int Height, string Url);
internal sealed record EventImageUploadResponse(
    Guid Id,
    string State,
    int Width,
    int Height,
    Instant ExpiresAt,
    IReadOnlyList<EventImageVariantResponse> Variants);

internal static class EventImageUploadLogEvents
{
    public static readonly EventId CompensationFailed = new(5902, "EventImageUploadCompensationFailed");
}
