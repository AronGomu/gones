using System.Security.Cryptography;
using System.Text;
using Gones.Api.Errors;
using Gones.Api.Security;
using Gones.Application.Concurrency;
using Gones.Domain.Live;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Live;

/// <summary>
/// Read side of the shared Live Tournament API.
/// Reads follow the locked public-read decision (Visitor/User may read anonymously); the pairing seed,
/// locked first-round order, and restore checkpoints are mutation details reserved for Organizer/Admin,
/// matching the security review. Write commands land in C34 under the same Organizer policy group.
/// </summary>
internal static class PublicLiveEndpoints
{
    public const int DefaultPageSize = 20;
    public const int MaximumPageSize = 100;
    private const int MaximumSearchLength = 200;
    private const string PublicCacheControl = "public, max-age=60";

    public static void MapPublicLiveEndpoints(this WebApplication app)
    {
        app.MapGet("/api/live-tournaments", ListAsync)
            .AllowAnonymous()
            .Produces<PublicLiveTournamentListResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest);
        app.MapGet("/api/live-tournaments/{id}", GetAsync)
            .AllowAnonymous()
            .Produces<PublicLiveTournamentDetailResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
        app.MapGet("/api/live-tournaments/{id}/standings", GetStandingsAsync)
            .AllowAnonymous()
            .Produces<LiveStandingsResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status404NotFound);

        // Organizer/Admin surface for shared Live mutation flows; C34 attaches the write commands here.
        var organizer = app.MapGroup("/api/live-tournaments").RequireAuthorization(AuthorizationPolicies.Organizer);
        organizer.MapGet("/{id}/document", GetDocumentAsync)
            .WithName("GetLiveTournamentDocument")
            .Produces<LiveTournamentDocumentResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status404NotFound);
    }

    private static async Task<IResult> ListAsync(
        int? page,
        int? pageSize,
        string? stage,
        string? search,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var pageNumber = page ?? 1;
        var size = pageSize ?? DefaultPageSize;
        if (pageNumber < 1) throw Validation("page", "Page must be at least 1.");
        if (size is < 1 or > MaximumPageSize) throw Validation("pageSize", $"Page size must be between 1 and {MaximumPageSize}.");
        if (search?.Length > MaximumSearchLength) throw Validation("search", $"Search must be at most {MaximumSearchLength} characters.");
        if (stage is not null && !LiveAggregate.Stages.Contains(stage, StringComparer.Ordinal))
            throw Validation("stage", "Stage must be registration, round, standings, or completed.");

        var query = database.LiveAggregates.AsNoTracking().Where(aggregate => aggregate.DeletedAt == null);
        if (stage is not null) query = query.Where(aggregate => aggregate.Stage == stage);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = EscapeLikePattern(search.Trim());
            query = query.Where(aggregate => EF.Functions.ILike(aggregate.Name, $"%{term}%", "\\"));
        }

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(aggregate => aggregate.UpdatedAt)
            .ThenBy(aggregate => aggregate.Id)
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .Select(aggregate => new PublicLiveTournamentSummaryResponse(
                aggregate.DocumentId,
                aggregate.Name,
                aggregate.TournamentDate,
                aggregate.Stage,
                aggregate.UpdatedAt,
                aggregate.Version))
            .ToListAsync(cancellationToken);
        var etag = HashETag($"{total}:{pageNumber}:{size}:{stage}:{search}:{string.Join('|', items.Select(item => $"{item.Id}:{item.DocumentVersion}:{item.UpdatedAt.ToUnixTimeTicks()}"))}");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        return Results.Ok(new PublicLiveTournamentListResponse(items, pageNumber, size, total));
    }

    private static async Task<IResult> GetAsync(
        string id,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var aggregate = await LoadAsync(id, database, cancellationToken);
        var etag = StrongETag.Encode(aggregate.Version);
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        var document = aggregate.ReadDocument();
        return Results.Ok(new PublicLiveTournamentDetailResponse(
            document.Id,
            document.Name,
            document.LeagueId,
            document.TournamentDate,
            document.Type,
            document.RoundCount,
            document.CustomRoundCount,
            document.PaidTrackingEnabled,
            document.Stage,
            document.CurrentRoundNumber,
            document.Players,
            document.Rounds,
            document.FinalizedTournamentId,
            document.CreatedAt,
            document.UpdatedAt,
            aggregate.Version,
            aggregate.UpdatedAt));
    }

    private static async Task<IResult> GetStandingsAsync(
        string id,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var aggregate = await LoadAsync(id, database, cancellationToken);
        var etag = HashETag($"{aggregate.Version}:standings");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        return Results.Ok(new LiveStandingsResponse(
            aggregate.DocumentId,
            LiveRules.CalculateStandings(aggregate.ReadDocument()),
            aggregate.Version));
    }

    private static async Task<IResult> GetDocumentAsync(
        string id,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var aggregate = await LoadAsync(id, database, cancellationToken);
        var etag = StrongETag.Encode(aggregate.Version);
        response.Headers.ETag = etag;
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        return Results.Ok(new LiveTournamentDocumentResponse(aggregate.ReadDocument(), aggregate.Version, aggregate.UpdatedAt));
    }

    private static async Task<LiveAggregate> LoadAsync(string id, GonesDbContext database, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > LiveAggregate.MaximumDocumentIdLength)
            throw Validation("id", $"Value must contain 1 to {LiveAggregate.MaximumDocumentIdLength} characters.");
        return await database.LiveAggregates.AsNoTracking()
            .SingleOrDefaultAsync(aggregate => aggregate.DocumentId == id && aggregate.DeletedAt == null, cancellationToken)
            ?? throw new ResourceNotFoundException();
    }

    private static string EscapeLikePattern(string value) =>
        value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);

    private static void SetPublicCache(HttpResponse response, string etag)
    {
        response.Headers.ETag = etag;
        response.Headers.CacheControl = PublicCacheControl;
    }

    private static bool IsNotModified(HttpRequest request, string etag) =>
        request.Headers.IfNoneMatch.Any(value => string.Equals(value, etag, StringComparison.Ordinal));

    private static string HashETag(string value) =>
        $"\"{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)))}\"";

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });
}

internal sealed record PublicLiveTournamentListResponse(
    IReadOnlyList<PublicLiveTournamentSummaryResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record PublicLiveTournamentSummaryResponse(
    string Id,
    string Name,
    string TournamentDate,
    string Stage,
    Instant UpdatedAt,
    long DocumentVersion);

internal sealed record PublicLiveTournamentDetailResponse(
    string Id,
    string Name,
    string LeagueId,
    string TournamentDate,
    string Type,
    int RoundCount,
    bool CustomRoundCount,
    bool PaidTrackingEnabled,
    string Stage,
    int CurrentRoundNumber,
    IReadOnlyList<LiveTournamentPlayerDocument> Players,
    IReadOnlyList<LiveTournamentRoundDocument> Rounds,
    string? FinalizedTournamentId,
    string CreatedAt,
    string UpdatedAt,
    long DocumentVersion,
    Instant ServerUpdatedAt);

internal sealed record LiveStandingsResponse(
    string Id,
    IReadOnlyList<LiveStandingRow> Rows,
    long DocumentVersion);

internal sealed record LiveTournamentDocumentResponse(
    LiveTournamentDocument Document,
    long DocumentVersion,
    Instant ServerUpdatedAt);
