using System.Security.Claims;
using Gones.Api.Errors;
using Gones.Api.Security;
using Gones.Domain.Notifications;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Notifications;

internal static class NotificationAdminEndpoints
{
    public static void MapNotificationAdminEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/notifications").RequireAuthorization(AuthorizationPolicies.Admin);
        admin.MapGet("/history", ListHistoryAsync)
            .Produces<AdminNotificationListResponse>();
        admin.MapGet("/dead-letters", ListDeadLettersAsync)
            .Produces<AdminNotificationListResponse>();
        admin.MapPost("/dead-letters/{outboxId:guid}/retry", RetryAsync)
            .Produces<AdminNotificationRetryResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }

    private static Task<IResult> ListHistoryAsync(
        string? status,
        int? page,
        int? pageSize,
        GonesDbContext database,
        CancellationToken cancellationToken) =>
        ListAsync(database.NotificationOutboxRecords.AsNoTracking(), status, page, pageSize, cancellationToken);

    private static Task<IResult> ListDeadLettersAsync(
        string? status,
        int? page,
        int? pageSize,
        GonesDbContext database,
        CancellationToken cancellationToken) =>
        ListAsync(
            database.NotificationOutboxRecords.AsNoTracking().Where(item => item.Status == NotificationOutboxStatus.DeadLetter || item.Status == NotificationOutboxStatus.Reconciliation),
            status,
            page,
            pageSize,
            cancellationToken);

    private static async Task<IResult> ListAsync(
        IQueryable<NotificationOutboxRecord> query,
        string? status,
        int? page,
        int? pageSize,
        CancellationToken cancellationToken)
    {
        var pageNumber = page is null or < 1 ? 1 : page.Value;
        var size = pageSize is null or < 1 ? 20 : Math.Min(pageSize.Value, 100);
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!Enum.TryParse<NotificationOutboxStatus>(status, true, out var parsed) || !Enum.IsDefined(parsed))
            {
                throw new ApiValidationException(new Dictionary<string, string[]> { ["status"] = ["Status is invalid."] });
            }
            query = query.Where(item => item.Status == parsed);
        }
        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(item => item.CreatedAt)
            .ThenByDescending(item => item.Id)
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .Select(item => new AdminNotificationResponse(
                item.Id,
                item.TemplateKey,
                item.UserId,
                item.TournamentId,
                item.Status.ToString(),
                item.DeliveryStatus == null ? null : item.DeliveryStatus.ToString(),
                item.ProviderMessageId,
                item.AttemptCount,
                item.LastErrorCode,
                item.CreatedAt,
                item.LastAttemptAt,
                item.SentAt,
                item.DeadLetteredAt,
                item.Status == NotificationOutboxStatus.Reconciliation))
            .ToListAsync(cancellationToken);
        return Results.Ok(new AdminNotificationListResponse(items, pageNumber, size, total));
    }

    private static async Task<IResult> RetryAsync(
        Guid outboxId,
        AdminNotificationRetryRequest request,
        ClaimsPrincipal principal,
        GonesDbContext database,
        IClock clock,
        CancellationToken cancellationToken)
    {
        if (!request.OperatorApproved)
        {
            throw new ApiValidationException(new Dictionary<string, string[]> { ["operatorApproved"] = ["Operator approval is required."] });
        }
        var actorId = CurrentUserId(principal);
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var original = await database.NotificationOutboxRecords
            .FromSqlInterpolated($"SELECT * FROM notification_outbox WHERE id = {outboxId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken) ?? throw new ResourceNotFoundException();
        NotificationOutboxRecord retry;
        try
        {
            retry = original.CreateOperatorRetry(clock.GetCurrentInstant());
        }
        catch (InvalidOperationException exception) when (exception.Message == "notification_retry_not_allowed")
        {
            throw new ResourceConflictException();
        }
        database.NotificationOutboxRecords.Add(retry);
        database.AuditRecords.Add(new AuditRecord
        {
            ActorId = actorId,
            Action = "notification.delivery.retry",
            EntityType = nameof(NotificationOutboxRecord),
            EntityId = original.Id.ToString("D"),
            RedactedDiff = "{\"fields\":[\"status\"],\"reason\":\"operator-approved\"}",
            OccurredAt = clock.GetCurrentInstant()
        });
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.Created("/api/admin/notifications/history", new AdminNotificationRetryResponse(retry.Id));
    }

    private static Guid CurrentUserId(ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue("sub") ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(value, out var userId) ? userId : throw new AuthenticationFailedException();
    }
}

internal sealed record AdminNotificationListResponse(
    IReadOnlyList<AdminNotificationResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record AdminNotificationResponse(
    Guid Id,
    string TemplateKey,
    Guid? UserId,
    Guid? TournamentId,
    string Status,
    string? DeliveryStatus,
    string? ProviderMessageId,
    int AttemptCount,
    string? LastErrorCode,
    Instant CreatedAt,
    Instant? LastAttemptAt,
    Instant? SentAt,
    Instant? DeadLetteredAt,
    bool CanRetry);

internal sealed record AdminNotificationRetryRequest(bool OperatorApproved);
internal sealed record AdminNotificationRetryResponse(Guid AttemptId);
