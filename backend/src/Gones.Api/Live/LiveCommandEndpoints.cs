using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Application.Concurrency;
using Gones.Domain.Leagues;
using Gones.Domain.Live;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Serialization.SystemTextJson;
using NodaTime.Text;

namespace Gones.Api.Live;

/// <summary>
/// Write side of the shared Live Tournament API: intent commands guarded by If-Match version
/// predicates, with Idempotency-Key protection on create/finalize. Mirrors the League command
/// surface from C31 and executes the golden-parity C# Live rules.
/// </summary>
internal static class LiveCommandEndpoints
{
    public static void MapLiveCommandEndpoints(this WebApplication app)
    {
        var organizer = app.MapGroup("/api/live-tournaments").RequireAuthorization(AuthorizationPolicies.Organizer);

        organizer.MapPost(string.Empty, CreateAsync).WithName("CreateLiveTournament").Produces<LiveCommandResponse>(StatusCodes.Status201Created);
        organizer.MapPatch("/{id}/settings", UpdateSettingsAsync).WithName("UpdateLiveTournamentSettings").Produces<LiveCommandResponse>();
        organizer.MapPost("/{id}/players", AddPlayerAsync).WithName("AddLiveTournamentPlayer").Produces<LiveCommandResponse>();
        organizer.MapPatch("/{id}/players/{playerId}", EditPlayerAsync).WithName("EditLiveTournamentPlayer").Produces<LiveCommandResponse>();
        organizer.MapPatch("/{id}/players/{playerId}/paid", SetPlayerPaidAsync).WithName("SetLiveTournamentPlayerPaid").Produces<LiveCommandResponse>();
        organizer.MapPost("/{id}/players/{playerId}/drop", DropPlayerAsync).WithName("DropLiveTournamentPlayer").Produces<LiveCommandResponse>();
        organizer.MapDelete("/{id}/players/{playerId}", RemovePlayerAsync).WithName("RemoveLiveTournamentPlayer").Produces<LiveCommandResponse>();
        organizer.MapPost("/{id}/rounds/start", StartRoundAsync).WithName("StartLiveTournamentRound").Produces<LiveCommandResponse>();
        organizer.MapPost("/{id}/rounds/regenerate", RegenerateRoundAsync).WithName("RegenerateLiveTournamentRound").Produces<LiveCommandResponse>();
        organizer.MapPost("/{id}/rounds/cancel", CancelRoundAsync).WithName("CancelLiveTournamentRound").Produces<LiveCommandResponse>();
        organizer.MapPost("/{id}/rounds/validate", ValidateRoundAsync).WithName("ValidateLiveTournamentRound").Produces<LiveCommandResponse>();
        organizer.MapPost("/{id}/rounds/{roundId}/entries/{entryId}/score", ScoreEntryAsync).WithName("ScoreLiveTournamentRoundEntry").Produces<LiveCommandResponse>();
        organizer.MapPost("/{id}/checkpoints/{checkpointId}/restore", RestoreCheckpointAsync).WithName("RestoreLiveTournamentCheckpoint").Produces<LiveCommandResponse>();
        organizer.MapPost("/{id}/finalize", FinalizeAsync).WithName("FinalizeLiveTournament").Produces<LiveFinalizeResponse>();
        organizer.MapDelete("/{id}", DeleteAsync).WithName("DeleteLiveTournament").Produces<LiveDeleteResponse>();
    }

    private static async Task<IResult> CreateAsync(
        CreateLiveTournamentRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        ClaimsPrincipal principal,
        HttpResponse httpResponse,
        LiveCommandService service,
        CancellationToken cancellationToken)
    {
        var response = await service.CreateAsync(OrganizationPrincipal.UserId(principal), RequiredIdempotencyKey(idempotencyKey), request, cancellationToken);
        httpResponse.Headers.ETag = response.ETag;
        return Results.Created($"/api/live-tournaments/{response.Document.Id}", response);
    }

    private static async Task<IResult> UpdateSettingsAsync(string id, UpdateLiveSettingsRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken)
    {
        await service.RequireLeagueReferenceAsync(request.LeagueId, cancellationToken);
        return await MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.settings.updated", ["name", "leagueId", "tournamentDate", "roundCount", "customRoundCount", "paidTrackingEnabled"],
            (live, _) => LiveCommands.UpdateSettings(live, request.Name, request.LeagueId, request.TournamentDate, request.RoundCount, request.CustomRoundCount, request.PaidTrackingEnabled), cancellationToken));
    }

    private static Task<IResult> AddPlayerAsync(string id, AddLivePlayerRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.player.added", ["players", "roundCount"],
            (live, _) => LiveCommands.AddPlayer(live, NewId(), request.Name ?? string.Empty, request.InitialWins ?? 0, request.InitialDraws ?? 0, request.InitialLosses ?? 0, request.Archetype ?? string.Empty), cancellationToken));

    private static Task<IResult> EditPlayerAsync(string id, string playerId, EditLivePlayerRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.player.edited", ["players", "rounds", "roundCount"],
            (live, _) => LiveCommands.EditPlayer(live, playerId, request.Name, request.InitialWins, request.InitialDraws, request.InitialLosses, request.Archetype), cancellationToken));

    private static Task<IResult> SetPlayerPaidAsync(string id, string playerId, SetLivePlayerPaidRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.player.paid.updated", ["players"],
            (live, _) => LiveCommands.SetPlayerPaid(live, playerId, request.Paid), cancellationToken));

    private static Task<IResult> DropPlayerAsync(string id, string playerId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.player.dropped", ["players"],
            (live, _) => LiveCommands.DropPlayer(live, playerId), cancellationToken));

    private static Task<IResult> RemovePlayerAsync(string id, string playerId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.player.removed", ["players", "roundCount"],
            (live, _) => LiveCommands.RemovePlayer(live, playerId), cancellationToken));

    private static Task<IResult> StartRoundAsync(string id, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.round.started", ["stage", "currentRoundNumber", "rounds", "checkpoints"],
            (live, nowIso) =>
            {
                if (live.Stage is not ("registration" or "standings"))
                    throw new InvalidOperationException("A Round is already in progress.");
                var prepared = LiveCommands.WithAutomaticRoundCount(live);
                if (live.Stage == "registration" && !LiveRules.CanStart(prepared))
                    throw new InvalidOperationException("Live Tournament cannot start yet.");
                var result = LiveRules.GenerateNextSwissRound(prepared, LiveRules.DefaultIdFactory, LiveRules.CreatePairingSeed, nowIso);
                if (ReferenceEquals(result, prepared)) throw new InvalidOperationException("No further Round can be generated.");
                return result;
            }, cancellationToken));

    private static Task<IResult> RegenerateRoundAsync(string id, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.round.regenerated", ["rounds", "pairingSeed", "firstRoundPlayerOrder"],
            (live, nowIso) =>
            {
                var result = LiveRules.RegenerateCurrentSwissRound(live, LiveRules.DefaultIdFactory, LiveRules.CreatePairingSeed, nowIso);
                if (ReferenceEquals(result, live)) throw new InvalidOperationException("There is no open Round to regenerate.");
                return result;
            }, cancellationToken));

    private static Task<IResult> CancelRoundAsync(string id, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.round.cancelled", ["stage", "currentRoundNumber", "rounds"],
            (live, nowIso) =>
            {
                if (live.Stage != "round") throw new InvalidOperationException("There is no open Round to cancel.");
                var result = LiveRules.CancelCurrentSwissRound(live, nowIso);
                if (ReferenceEquals(result, live)) throw new InvalidOperationException("There is no open Round to cancel.");
                return result;
            }, cancellationToken));

    private static Task<IResult> ValidateRoundAsync(string id, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.round.validated", ["stage", "rounds", "checkpoints"],
            (live, nowIso) =>
            {
                if (live.Stage != "round" || LiveRules.CurrentRound(live) is null)
                    throw new InvalidOperationException("There is no open Round to validate.");
                if (!LiveRules.CurrentRoundComplete(live))
                    throw new ArgumentException("Round results are incomplete or invalid.", "round");
                var result = LiveRules.ValidateCurrentSwissRound(live, nowIso, LiveRules.DefaultIdFactory);
                if (ReferenceEquals(result, live)) throw new InvalidOperationException("There is no open Round to validate.");
                return result;
            }, cancellationToken));

    private static Task<IResult> ScoreEntryAsync(string id, string roundId, string entryId, ScoreLiveRoundEntryRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.round.score.updated", ["rounds"],
            (live, nowIso) =>
            {
                if (live.Stage != "round") throw new InvalidOperationException("Scores can only change while a Round is in progress.");
                var round = live.Rounds.FirstOrDefault(item => item.Id == roundId)
                    ?? throw new KeyNotFoundException("Round was not found.");
                if (round.Validated || round.RoundNumber != live.CurrentRoundNumber)
                    throw new InvalidOperationException("Only the current open Round accepts score changes.");
                var entry = round.Entries.FirstOrDefault(item => item.Entry.Id == entryId)
                    ?? throw new KeyNotFoundException("Round Entry was not found.");
                if (entry.Entry is not MatchRoundEntry) throw new InvalidOperationException("Only Match entries accept scores.");
                if (LiveRules.MatchScoreIssue("match", request.Player1Score, request.Player2Score) is { } issue)
                    throw new ArgumentException(issue, "score");
                return LiveRules.UpdateRoundEntryResult(live, roundId, entryId, request.Player1Score, request.Player2Score, nowIso);
            }, cancellationToken));

    private static Task<IResult> RestoreCheckpointAsync(string id, string checkpointId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "live.checkpoint.restored", ["stage", "currentRoundNumber", "roundCount", "paidTrackingEnabled", "players", "rounds", "checkpoints"],
            (live, nowIso) =>
            {
                if (live.Checkpoints.All(item => item.Id != checkpointId))
                    throw new KeyNotFoundException("Checkpoint was not found.");
                var result = LiveRules.RestoreCheckpoint(live, checkpointId, nowIso, LiveRules.DefaultIdFactory);
                if (ReferenceEquals(result, live)) throw new InvalidOperationException("Checkpoint cannot be restored.");
                return result;
            }, cancellationToken));

    private static async Task<IResult> FinalizeAsync(
        string id,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        HttpResponse response,
        ClaimsPrincipal principal,
        LiveCommandService service,
        CancellationToken cancellationToken)
    {
        var result = await service.FinalizeAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), RequiredIdempotencyKey(idempotencyKey), cancellationToken);
        response.Headers.ETag = result.LiveETag;
        return Results.Ok(result);
    }

    private static async Task<IResult> DeleteAsync(string id, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LiveCommandService service, CancellationToken cancellationToken)
    {
        var result = await service.DeleteAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static async Task<IResult> MutateAsync(HttpResponse response, Task<LiveCommandResponse> pending)
    {
        var result = await pending;
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static long RequiredVersion(string? value)
    {
        if (!StrongETag.TryDecode(value, out var version)) throw new ConcurrencyConflictException();
        return version;
    }

    private static string RequiredIdempotencyKey(string? value)
    {
        var key = value?.Trim();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200)
            throw new ApiValidationException(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["Idempotency-Key header is required and cannot exceed 200 characters."] });
        return key;
    }

    private static string NewId() => Guid.NewGuid().ToString("D");
}

internal sealed class LiveCommandService(GonesDbContext database, IClock clock)
{
    private static readonly JsonSerializerOptions StoredJsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        .ConfigureForNodaTime(DateTimeZoneProviders.Tzdb);

    /// <summary>Millisecond ISO instants matching JavaScript's Date.prototype.toISOString.</summary>
    private static readonly InstantPattern JsIsoPattern = InstantPattern.CreateWithInvariantCulture("uuuu-MM-dd'T'HH:mm:ss.fff'Z'");
    private static readonly LocalDatePattern DateInputPattern = LocalDatePattern.CreateWithInvariantCulture("uuuu-MM-dd");

    public Task<LiveCommandResponse> CreateAsync(Guid actorId, string key, CreateLiveTournamentRequest request, CancellationToken cancellationToken) =>
        ExecuteIdempotentAsync(
            actorId,
            key,
            "create",
            request,
            async () =>
            {
                await RequireLeagueReferenceAsync(request.LeagueId, cancellationToken);
                var now = clock.GetCurrentInstant();
                var nowIso = JsIsoPattern.Format(now);
                var document = new LiveTournamentDocument(
                    NewId(),
                    LiveCommands.CoercedName(request.Name),
                    request.LeagueId ?? string.Empty,
                    string.IsNullOrWhiteSpace(request.TournamentDate) ? Today(now) : request.TournamentDate,
                    "swiss",
                    Math.Max(0, request.RoundCount ?? 3),
                    request.CustomRoundCount ?? false,
                    request.PaidTrackingEnabled ?? true,
                    0,
                    [],
                    "registration",
                    0,
                    [],
                    [],
                    [],
                    null,
                    1,
                    nowIso,
                    nowIso);
                var aggregate = LiveAggregate.Create(document, now);
                database.LiveAggregates.Add(aggregate);
                AddAudit(actorId, "live.created", "live-tournament", aggregate.DocumentId, ["live-tournament"]);
                await database.SaveChangesAsync(cancellationToken);
                return Response(aggregate);
            },
            cancellationToken);

    public async Task<LiveCommandResponse> MutateAsync(
        string documentId,
        Guid actorId,
        long expectedVersion,
        string auditAction,
        IReadOnlyList<string> fields,
        Func<LiveTournamentDocument, string, LiveTournamentDocument> command,
        CancellationToken cancellationToken)
    {
        var aggregate = await RequireActiveAsync(documentId, cancellationToken);
        RequireVersion(aggregate, expectedVersion);
        var now = clock.GetCurrentInstant();
        var nowIso = JsIsoPattern.Format(now);
        var current = aggregate.ReadDocument();
        LiveTournamentDocument updated;
        try
        {
            updated = command(current, nowIso);
        }
        catch (ArgumentException exception)
        {
            throw Validation(exception.ParamName ?? "command", exception.Message);
        }
        catch (KeyNotFoundException)
        {
            throw new ResourceNotFoundException();
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }
        ApplyCommand(aggregate, current, updated, now, nowIso);
        AddAudit(actorId, auditAction, "live-tournament", aggregate.DocumentId, fields);
        await SaveAsync(documentId, cancellationToken);
        return Response(aggregate);
    }

    public Task<LiveFinalizeResponse> FinalizeAsync(string documentId, Guid actorId, long expectedVersion, string key, CancellationToken cancellationToken) =>
        ExecuteIdempotentAsync(
            actorId,
            key,
            $"finalize:{documentId}",
            new { id = documentId },
            async () =>
            {
                var live = await RequireActiveAsync(documentId, cancellationToken);
                RequireVersion(live, expectedVersion);
                var document = live.ReadDocument();
                if (document.Stage != "standings")
                    throw new ResourceConflictException();
                var targetLeagueId = document.LeagueId.Length > 0 ? document.LeagueId : LeagueNormalizer.PlaceholderLeagueId;
                var league = await database.LeagueAggregates
                    .SingleOrDefaultAsync(item => item.DocumentId == targetLeagueId && item.DeletedAt == null, cancellationToken)
                    ?? throw Validation("leagueId", "Target League was not found.");

                var now = clock.GetCurrentInstant();
                var nowIso = JsIsoPattern.Format(now);
                var stable = document with
                {
                    LeagueId = targetLeagueId,
                    FinalizedTournamentId = document.FinalizedTournamentId ?? NewId()
                };
                var tournament = LiveRules.Finalize(stable, LiveRules.DefaultIdFactory, DefaultTournamentName(now)) with { LeagueId = league.DocumentId };
                var leagueDocument = league.ReadDocument();
                IReadOnlyList<TournamentDocument> tournaments = leagueDocument.Tournaments.Any(item => item.Id == tournament.Id)
                    ? leagueDocument.Tournaments.Select(item => item.Id == tournament.Id ? tournament : item).ToArray()
                    : [.. leagueDocument.Tournaments, tournament];
                league.Apply(leagueDocument with { Tournaments = tournaments }, now);
                ApplyCommand(live, document, stable with { Stage = "completed" }, now, nowIso);
                live.SoftDelete(now);
                AddAudit(actorId, "live.finalized", "live-tournament", live.DocumentId, ["stage", "finalizedTournamentId", "leagueId", "deletedAt"]);
                AddAudit(actorId, "league.tournament.finalized", "league", league.DocumentId, ["tournaments"]);
                await SaveAsync(documentId, cancellationToken);
                return new LiveFinalizeResponse(
                    live.DocumentId,
                    "completed",
                    targetLeagueId,
                    stable.FinalizedTournamentId!,
                    live.Version,
                    StrongETag.Encode(live.Version),
                    league.Version,
                    StrongETag.Encode(league.Version));
            },
            cancellationToken);

    public async Task<LiveDeleteResponse> DeleteAsync(string documentId, Guid actorId, long expectedVersion, CancellationToken cancellationToken)
    {
        var aggregate = await RequireActiveAsync(documentId, cancellationToken);
        RequireVersion(aggregate, expectedVersion);
        try
        {
            aggregate.SoftDelete(clock.GetCurrentInstant());
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }
        AddAudit(actorId, "live.deleted", "live-tournament", aggregate.DocumentId, ["deletedAt"]);
        await SaveAsync(documentId, cancellationToken);
        return new LiveDeleteResponse(aggregate.DocumentId, true, aggregate.Version, StrongETag.Encode(aggregate.Version));
    }

    public async Task RequireLeagueReferenceAsync(string? leagueId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(leagueId)) return;
        var exists = await database.LeagueAggregates.AsNoTracking()
            .AnyAsync(item => item.DocumentId == leagueId && item.DeletedAt == null, cancellationToken);
        if (!exists) throw Validation("leagueId", "League was not found.");
    }

    /// <summary>One accepted command == one new document version, mirroring the client save cadence.</summary>
    private static void ApplyCommand(LiveAggregate aggregate, LiveTournamentDocument current, LiveTournamentDocument updated, Instant now, string nowIso)
    {
        try
        {
            aggregate.Apply(updated with { DocumentVersion = current.DocumentVersion + 1, UpdatedAt = nowIso }, now);
        }
        catch (ArgumentException exception)
        {
            throw Validation(exception.ParamName ?? "document", exception.Message);
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }
    }

    private async Task<T> ExecuteIdempotentAsync<T>(Guid actorId, string key, string command, object request, Func<Task<T>> execute, CancellationToken cancellationToken)
    {
        var scope = $"live-command:{actorId:D}:{command}";
        var requestHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request, StoredJsonOptions))));
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        await database.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({scope}), hashtext({key}))", cancellationToken);
        var existing = await database.IdempotencyRecords.AsNoTracking().SingleOrDefaultAsync(item => item.Scope == scope && item.Key == key, cancellationToken);
        if (existing is not null)
        {
            var stored = JsonSerializer.Deserialize<StoredLiveCommand>(existing.ResponseBody, StoredJsonOptions)
                ?? throw new InvalidOperationException("Stored Live command response is invalid.");
            if (stored.RequestHash != requestHash) throw new IdempotencyConflictException();
            await transaction.CommitAsync(cancellationToken);
            return stored.Response.Deserialize<T>(StoredJsonOptions)
                ?? throw new InvalidOperationException("Stored Live command response is invalid.");
        }

        var response = await execute();
        var now = clock.GetCurrentInstant();
        database.IdempotencyRecords.Add(new IdempotencyRecord
        {
            Scope = scope,
            Key = key,
            ResponseStatusCode = StatusCodes.Status201Created,
            ResponseBody = JsonSerializer.Serialize(new StoredLiveCommand(requestHash, JsonSerializer.SerializeToElement(response, StoredJsonOptions)), StoredJsonOptions),
            CreatedAt = now,
            ExpiresAt = now + Duration.FromHours(24)
        });
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return response;
    }

    private async Task<LiveAggregate> RequireActiveAsync(string documentId, CancellationToken cancellationToken) =>
        await database.LiveAggregates.SingleOrDefaultAsync(item => item.DocumentId == documentId && item.DeletedAt == null, cancellationToken)
        ?? throw new ResourceNotFoundException();

    private static void RequireVersion(LiveAggregate aggregate, long expectedVersion)
    {
        if (aggregate.Version != expectedVersion)
            throw new ConcurrencyConflictException(StrongETag.Encode(aggregate.Version), aggregate.Version);
    }

    private async Task SaveAsync(string documentId, CancellationToken cancellationToken)
    {
        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            var latest = await database.LiveAggregates.AsNoTracking()
                .Where(item => item.DocumentId == documentId && item.DeletedAt == null)
                .Select(item => (long?)item.Version)
                .SingleOrDefaultAsync(cancellationToken);
            throw latest is { } version
                ? new ConcurrencyConflictException(StrongETag.Encode(version), version)
                : new ConcurrencyConflictException();
        }
    }

    private void AddAudit(Guid actorId, string action, string entityType, string entityId, IReadOnlyList<string> fields) => database.AuditRecords.Add(new AuditRecord
    {
        ActorId = actorId,
        Action = action,
        EntityType = entityType,
        EntityId = entityId,
        RedactedDiff = JsonSerializer.Serialize(new { fields }, StoredJsonOptions),
        OccurredAt = clock.GetCurrentInstant()
    });

    private static LiveCommandResponse Response(LiveAggregate aggregate) =>
        new(aggregate.ReadDocument(), aggregate.Version, aggregate.UpdatedAt, StrongETag.Encode(aggregate.Version));

    private static string Today(Instant now) => DateInputPattern.Format(now.InUtc().Date);

    private static string DefaultTournamentName(Instant now) => Today(now).Replace('-', '/');

    private static ApiValidationException Validation(string field, string message) => new(new Dictionary<string, string[]> { [field] = [message] });
    private static string NewId() => Guid.NewGuid().ToString("D");
    private sealed record StoredLiveCommand(string RequestHash, JsonElement Response);
}

internal sealed record CreateLiveTournamentRequest(
    string? Name,
    string? LeagueId,
    string? TournamentDate,
    int? RoundCount,
    bool? CustomRoundCount,
    bool? PaidTrackingEnabled);

internal sealed record UpdateLiveSettingsRequest(
    string? Name,
    string? LeagueId,
    string? TournamentDate,
    int? RoundCount,
    bool? CustomRoundCount,
    bool? PaidTrackingEnabled);

internal sealed record AddLivePlayerRequest(string? Name, int? InitialWins, int? InitialDraws, int? InitialLosses, string? Archetype);
internal sealed record EditLivePlayerRequest(string? Name, int? InitialWins, int? InitialDraws, int? InitialLosses, string? Archetype);
internal sealed record SetLivePlayerPaidRequest(bool Paid);
internal sealed record ScoreLiveRoundEntryRequest(double Player1Score, double Player2Score);

internal sealed record LiveCommandResponse(
    LiveTournamentDocument Document,
    long DocumentVersion,
    Instant ServerUpdatedAt,
    string ETag);

internal sealed record LiveDeleteResponse(string Id, bool Deleted, long DocumentVersion, string ETag);

internal sealed record LiveFinalizeResponse(
    string Id,
    string Stage,
    string LeagueId,
    string FinalizedTournamentId,
    long LiveDocumentVersion,
    string LiveETag,
    long LeagueDocumentVersion,
    string LeagueETag);
