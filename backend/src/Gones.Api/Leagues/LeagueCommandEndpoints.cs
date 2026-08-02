using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Application.Concurrency;
using Gones.Domain.Leagues;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Serialization.SystemTextJson;

namespace Gones.Api.Leagues;

internal static class LeagueCommandEndpoints
{
    public static void MapLeagueCommandEndpoints(this WebApplication app)
    {
        var organizer = app.MapGroup("/api/leagues").RequireAuthorization(AuthorizationPolicies.Organizer);

        organizer.MapPost(string.Empty, CreateAsync).WithName("CreateLeague").Produces<LeagueCommandResponse>(StatusCodes.Status201Created);
        organizer.MapPatch("/{id}/name", RenameAsync).WithName("RenameLeague").Produces<LeagueCommandResponse>();
        organizer.MapPatch("/{id}/status", ChangeStatusAsync).WithName("ChangeLeagueStatus").Produces<LeagueCommandResponse>();
        organizer.MapDelete("/{id}", DeleteAsync).WithName("DeleteLeague").Produces<LeagueDeleteResponse>();
        organizer.MapPost("/{id}/tournaments", CreateTournamentAsync).WithName("CreateResultTournament").Produces<LeagueCommandResponse>();
        organizer.MapPatch("/{id}/tournaments/{tournamentId}", EditTournamentAsync).WithName("EditResultTournament").Produces<LeagueCommandResponse>();
        organizer.MapDelete("/{id}/tournaments/{tournamentId}", DeleteTournamentAsync).WithName("DeleteResultTournament").Produces<LeagueCommandResponse>();
        organizer.MapPost("/{id}/tournaments/{tournamentId}/move", MoveTournamentAsync).WithName("MoveResultTournament").Produces<MoveTournamentResponse>();
        organizer.MapPost("/{id}/tournaments/{tournamentId}/rounds", AddRoundAsync).WithName("AddResultRound").Produces<LeagueCommandResponse>();
        organizer.MapDelete("/{id}/tournaments/{tournamentId}/rounds/{roundId}", DeleteRoundAsync).WithName("DeleteResultRound").Produces<LeagueCommandResponse>();
        organizer.MapPost("/{id}/tournaments/{tournamentId}/rounds/{roundId}/import", ImportRoundAsync).WithName("ImportResultRound").Produces<LeagueCommandResponse>();
        organizer.MapPost("/{id}/tournaments/{tournamentId}/rounds/{roundId}/replace", ReplaceRoundAsync).WithName("ReplaceResultRound").Produces<LeagueCommandResponse>();
        organizer.MapPost("/{id}/tournaments/{tournamentId}/rounds/{roundId}/entries", AddEntryAsync).WithName("AddResultEntry").Produces<LeagueCommandResponse>();
        organizer.MapPatch("/{id}/tournaments/{tournamentId}/rounds/{roundId}/entries/{entryId}", EditEntryAsync).WithName("EditResultEntry").Produces<LeagueCommandResponse>();
        organizer.MapDelete("/{id}/tournaments/{tournamentId}/rounds/{roundId}/entries/{entryId}", DeleteEntryAsync).WithName("DeleteResultEntry").Produces<LeagueCommandResponse>();
        organizer.MapPatch("/{id}/tournaments/{tournamentId}/archetypes/{playerName}", UpdateArchetypeAsync).WithName("UpdateResultPlayerArchetype").Produces<LeagueCommandResponse>();
        organizer.MapPost("/{id}/players/rename", RenamePlayerAsync).WithName("RenameLeaguePlayerName").Produces<LeagueCommandResponse>();
        organizer.MapPost("/restore", RestoreLeagueAsync).WithName("RestoreLeague").Produces<LeagueCommandResponse>(StatusCodes.Status201Created);
        organizer.MapPost("/restore-full", RestoreFullAsync)
            .WithName("RestoreFullLeagueData")
            .RequireAuthorization(AuthorizationPolicies.Admin)
            .Produces<FullRestoreResponse>(StatusCodes.Status201Created);
    }

    private static async Task<IResult> CreateAsync(
        CreateLeagueRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        ClaimsPrincipal principal,
        HttpResponse httpResponse,
        LeagueCommandService service,
        CancellationToken cancellationToken)
    {
        var response = await service.CreateAsync(OrganizationPrincipal.UserId(principal), RequiredIdempotencyKey(idempotencyKey), request, cancellationToken);
        httpResponse.Headers.ETag = response.ETag;
        return Results.Created($"/api/leagues/{response.Id}", response);
    }

    private static Task<IResult> RenameAsync(string id, RenameLeagueRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.renamed", ["name"], league => LeagueCommands.RenameLeague(league, request.Name), cancellationToken));

    private static Task<IResult> ChangeStatusAsync(string id, ChangeLeagueStatusRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.status.changed", ["status"], league => LeagueCommands.ChangeStatus(league, request.Status), cancellationToken));

    private static async Task<IResult> DeleteAsync(string id, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken)
    {
        var result = await service.DeleteAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static Task<IResult> CreateTournamentAsync(string id, CreateResultTournamentRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken)
    {
        var tournamentId = NewId();
        return MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.tournament.created", ["tournaments"], league => LeagueCommands.AddTournament(league, tournamentId, request.Name, request.TournamentDate), cancellationToken));
    }

    private static Task<IResult> EditTournamentAsync(string id, string tournamentId, EditResultTournamentRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.tournament.edited", ["tournaments"], league => LeagueCommands.EditTournament(league, tournamentId, request.Name, request.TournamentDate), cancellationToken));

    private static Task<IResult> DeleteTournamentAsync(string id, string tournamentId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.tournament.deleted", ["tournaments"], league => LeagueCommands.DeleteTournament(league, tournamentId), cancellationToken));

    private static async Task<IResult> MoveTournamentAsync(
        string id,
        string tournamentId,
        MoveResultTournamentRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromHeader(Name = "Target-If-Match")] string? targetIfMatch,
        HttpResponse response,
        ClaimsPrincipal principal,
        LeagueCommandService service,
        CancellationToken cancellationToken)
    {
        var result = await service.MoveTournamentAsync(id, request.TargetLeagueId, tournamentId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), RequiredVersion(targetIfMatch), cancellationToken);
        response.Headers.ETag = result.Source.ETag;
        response.Headers.Append("Target-ETag", result.Target.ETag);
        return Results.Ok(result);
    }

    private static Task<IResult> AddRoundAsync(string id, string tournamentId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken)
    {
        var roundId = NewId();
        return MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.round.added", ["rounds"], league => LeagueCommands.AddRound(league, tournamentId, roundId), cancellationToken));
    }

    private static Task<IResult> DeleteRoundAsync(string id, string tournamentId, string roundId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.round.deleted", ["rounds"], league => LeagueCommands.DeleteRound(league, tournamentId, roundId), cancellationToken));

    private static Task<IResult> ImportRoundAsync(string id, string tournamentId, string roundId, ImportRoundRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken)
    {
        var imported = RoundCsvAdapter.Import(request.Text, NewId);
        return MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.round.imported", ["rounds", "playerArchetypes"], league => LeagueCommands.ReplaceRound(league, tournamentId, roundId, imported.Entries, true), cancellationToken));
    }

    private static Task<IResult> ReplaceRoundAsync(string id, string tournamentId, string roundId, ReplaceRoundRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.round.replaced", ["rounds"], league => LeagueCommands.ReplaceRound(league, tournamentId, roundId, request.Entries, false), cancellationToken));

    private static Task<IResult> AddEntryAsync(string id, string tournamentId, string roundId, RoundEntry request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken)
    {
        var entry = request switch
        {
            MatchRoundEntry match => match with { Id = NewId() },
            ByeRoundEntry bye => bye with { Id = NewId() },
            InvalidRoundEntry invalid => invalid with { Id = NewId() },
            _ => request
        };
        return MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.entry.added", ["entries"], league => LeagueCommands.AddEntry(league, tournamentId, roundId, entry), cancellationToken));
    }

    private static Task<IResult> EditEntryAsync(string id, string tournamentId, string roundId, string entryId, RoundEntry request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken)
    {
        var entry = request switch
        {
            MatchRoundEntry match => match with { Id = entryId },
            ByeRoundEntry bye => bye with { Id = entryId },
            InvalidRoundEntry invalid => invalid with { Id = entryId },
            _ => request
        };
        return MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.entry.edited", ["entries"], league => LeagueCommands.EditEntry(league, tournamentId, roundId, entryId, entry), cancellationToken));
    }

    private static Task<IResult> DeleteEntryAsync(string id, string tournamentId, string roundId, string entryId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.entry.deleted", ["entries"], league => LeagueCommands.DeleteEntry(league, tournamentId, roundId, entryId), cancellationToken));

    private static Task<IResult> UpdateArchetypeAsync(string id, string tournamentId, string playerName, UpdatePlayerArchetypeRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.archetype.updated", ["playerArchetypes"], league => LeagueCommands.UpdateArchetype(league, tournamentId, playerName, request.Archetype), cancellationToken));

    private static Task<IResult> RenamePlayerAsync(string id, RenamePlayerRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken) =>
        MutateAsync(response, service.MutateAsync(id, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), "league.player_name.renamed", ["playerNames"], league => LeagueCommands.RenamePlayer(league, request.FromName, request.ToName), cancellationToken));

    private static async Task<IResult> RestoreLeagueAsync(LeagueRestoreRequest request, [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey, ClaimsPrincipal principal, HttpResponse response, LeagueCommandService service, CancellationToken cancellationToken)
    {
        var result = await service.RestoreLeagueAsync(OrganizationPrincipal.UserId(principal), RequiredIdempotencyKey(idempotencyKey), request, cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Created($"/api/leagues/{result.Id}", result);
    }

    private static async Task<IResult> RestoreFullAsync(FullDataRestoreRequest request, [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey, ClaimsPrincipal principal, LeagueCommandService service, CancellationToken cancellationToken)
    {
        var result = await service.RestoreFullAsync(OrganizationPrincipal.UserId(principal), RequiredIdempotencyKey(idempotencyKey), request, cancellationToken);
        return Results.Json(result, statusCode: StatusCodes.Status201Created);
    }

    private static async Task<IResult> MutateAsync(HttpResponse response, Task<LeagueCommandResponse> pending)
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

internal sealed class LeagueCommandService(GonesDbContext database, IClock clock)
{
    private static readonly JsonSerializerOptions StoredJsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        .ConfigureForNodaTime(DateTimeZoneProviders.Tzdb);

    public Task<LeagueCommandResponse> CreateAsync(Guid actorId, string key, CreateLeagueRequest request, CancellationToken cancellationToken) =>
        ExecuteIdempotentAsync(
            actorId,
            key,
            "create",
            request,
            async () =>
            {
                var name = ValidateNewLeagueName(request.Name);
                var document = new LeagueDocument(NewId(), name, "active", []);
                var aggregate = LeagueAggregate.Create(document, clock.GetCurrentInstant());
                database.LeagueAggregates.Add(aggregate);
                AddAudit(actorId, "league.created", aggregate.DocumentId, ["league"]);
                await database.SaveChangesAsync(cancellationToken);
                return Response(aggregate);
            },
            cancellationToken);

    public async Task<LeagueCommandResponse> MutateAsync(
        string documentId,
        Guid actorId,
        long expectedVersion,
        string auditAction,
        IReadOnlyList<string> fields,
        Func<LeagueDocument, LeagueDocument> command,
        CancellationToken cancellationToken)
    {
        var aggregate = await RequireActiveAsync(documentId, cancellationToken);
        RequireVersion(aggregate, expectedVersion);
        try
        {
            aggregate.Apply(command(aggregate.ReadDocument()), clock.GetCurrentInstant());
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
        AddAudit(actorId, auditAction, aggregate.DocumentId, fields);
        await SaveAsync(cancellationToken);
        return Response(aggregate);
    }

    public async Task<LeagueDeleteResponse> DeleteAsync(string documentId, Guid actorId, long expectedVersion, CancellationToken cancellationToken)
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
        AddAudit(actorId, "league.deleted", aggregate.DocumentId, ["deletedAt"]);
        await SaveAsync(cancellationToken);
        return new LeagueDeleteResponse(aggregate.DocumentId, true, aggregate.Version, StrongETag.Encode(aggregate.Version));
    }

    public async Task<MoveTournamentResponse> MoveTournamentAsync(
        string sourceId,
        string targetId,
        string tournamentId,
        Guid actorId,
        long sourceVersion,
        long targetVersion,
        CancellationToken cancellationToken)
    {
        if (sourceId == targetId)
        {
            var same = await RequireActiveAsync(sourceId, cancellationToken);
            RequireVersion(same, sourceVersion);
            RequireVersion(same, targetVersion);
            var unchanged = Response(same);
            return new MoveTournamentResponse(unchanged, unchanged);
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var aggregates = await database.LeagueAggregates
            .Where(item => (item.DocumentId == sourceId || item.DocumentId == targetId) && item.DeletedAt == null)
            .OrderBy(item => item.DocumentId)
            .ToListAsync(cancellationToken);
        var source = aggregates.SingleOrDefault(item => item.DocumentId == sourceId) ?? throw new ResourceNotFoundException();
        var target = aggregates.SingleOrDefault(item => item.DocumentId == targetId) ?? throw new ResourceNotFoundException();
        RequireVersion(source, sourceVersion);
        RequireVersion(target, targetVersion);
        try
        {
            var moved = LeagueCommands.MoveTournament(source.ReadDocument(), target.ReadDocument(), tournamentId);
            var now = clock.GetCurrentInstant();
            source.Apply(moved.Source, now);
            target.Apply(moved.Target, now);
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
        AddAudit(actorId, "league.tournament.moved", source.DocumentId, ["tournaments"]);
        AddAudit(actorId, "league.tournament.moved", target.DocumentId, ["tournaments"]);
        await SaveAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new MoveTournamentResponse(Response(source), Response(target));
    }

    public Task<LeagueCommandResponse> RestoreLeagueAsync(Guid actorId, string key, LeagueRestoreRequest request, CancellationToken cancellationToken)
    {
        ValidateExport(request.Kind, request.GonesDataVersion, "league");
        return ExecuteIdempotentAsync(
            actorId,
            key,
            "restore-league",
            request,
            async () =>
            {
                var restored = await RestoreOneAsync(request.League, actorId, cancellationToken);
                await database.SaveChangesAsync(cancellationToken);
                return Response(restored);
            },
            cancellationToken);
    }

    public Task<FullRestoreResponse> RestoreFullAsync(Guid actorId, string key, FullDataRestoreRequest request, CancellationToken cancellationToken)
    {
        ValidateExport(request.Kind, request.GonesDataVersion, "fullData");
        if (request.Leagues.Count > 100) throw Validation("leagues", "Full Data Restore supports at most 100 Leagues.");
        return ExecuteIdempotentAsync(
            actorId,
            key,
            "restore-full",
            request,
            async () =>
            {
                var restored = new List<LeagueAggregate>();
                foreach (var source in request.Leagues) restored.Add(await RestoreOneAsync(source, actorId, cancellationToken));
                await database.SaveChangesAsync(cancellationToken);
                return new FullRestoreResponse(restored.Select(Response).ToArray());
            },
            cancellationToken);
    }

    private async Task<LeagueAggregate> RestoreOneAsync(LeagueDocument source, Guid actorId, CancellationToken cancellationToken)
    {
        LeagueAggregate.Create(source, clock.GetCurrentInstant());
        var names = await database.LeagueAggregates.AsNoTracking().Select(item => item.Name).ToListAsync(cancellationToken);
        names.AddRange(database.ChangeTracker.Entries<LeagueAggregate>().Where(item => item.State == EntityState.Added).Select(item => item.Entity.Name));
        var baseName = LeagueNormalizer.IsUnassignedLeagueName(source.Name) ? $"{source.Name} (restored)" : source.Name;
        var name = UniqueName(baseName, names);
        var restored = LeagueCommands.Restore(source, NewId(), name, NewId);
        var aggregate = LeagueAggregate.Create(restored, clock.GetCurrentInstant());
        database.LeagueAggregates.Add(aggregate);
        AddAudit(actorId, "league.restored", aggregate.DocumentId, ["league"]);
        return aggregate;
    }

    private async Task<T> ExecuteIdempotentAsync<T>(Guid actorId, string key, string command, object request, Func<Task<T>> execute, CancellationToken cancellationToken)
    {
        var scope = $"league-command:{actorId:D}:{command}";
        var requestHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request, StoredJsonOptions))));
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        await database.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({scope}), hashtext({key}))", cancellationToken);
        var existing = await database.IdempotencyRecords.AsNoTracking().SingleOrDefaultAsync(item => item.Scope == scope && item.Key == key, cancellationToken);
        if (existing is not null)
        {
            var stored = JsonSerializer.Deserialize<StoredLeagueCommand>(existing.ResponseBody, StoredJsonOptions)
                ?? throw new InvalidOperationException("Stored League command response is invalid.");
            if (stored.RequestHash != requestHash) throw new IdempotencyConflictException();
            await transaction.CommitAsync(cancellationToken);
            return RestoreStoredResponse<T>(stored.Leagues);
        }

        var response = await execute();
        var now = clock.GetCurrentInstant();
        database.IdempotencyRecords.Add(new IdempotencyRecord
        {
            Scope = scope,
            Key = key,
            ResponseStatusCode = StatusCodes.Status201Created,
            ResponseBody = JsonSerializer.Serialize(new StoredLeagueCommand(requestHash, StoreResponse(response)), StoredJsonOptions),
            CreatedAt = now,
            ExpiresAt = now + Duration.FromHours(24)
        });
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return response;
    }

    private async Task<LeagueAggregate> RequireActiveAsync(string documentId, CancellationToken cancellationToken) =>
        await database.LeagueAggregates.SingleOrDefaultAsync(item => item.DocumentId == documentId && item.DeletedAt == null, cancellationToken)
        ?? throw new ResourceNotFoundException();

    private static void RequireVersion(LeagueAggregate aggregate, long expectedVersion)
    {
        if (aggregate.Version != expectedVersion) throw new ConcurrencyConflictException();
    }

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConcurrencyConflictException();
        }
    }

    private void AddAudit(Guid actorId, string action, string entityId, IReadOnlyList<string> fields) => database.AuditRecords.Add(new AuditRecord
    {
        ActorId = actorId,
        Action = action,
        EntityType = "league",
        EntityId = entityId,
        RedactedDiff = JsonSerializer.Serialize(new { fields }, StoredJsonOptions),
        OccurredAt = clock.GetCurrentInstant()
    });

    private static LeagueCommandResponse Response(LeagueAggregate aggregate)
    {
        var document = aggregate.ReadDocument();
        return new LeagueCommandResponse(document.Id, document.Name, document.Status, document.Tournaments, aggregate.Version, aggregate.UpdatedAt, StrongETag.Encode(aggregate.Version));
    }

    private static string ValidateNewLeagueName(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > LeagueAggregate.MaximumNameLength || LeagueNormalizer.IsUnassignedLeagueName(name))
            throw Validation("name", "League name is required, bounded, and cannot use reserved placeholder labels.");
        return name.Trim();
    }

    private static void ValidateExport(string kind, int version, string expectedKind)
    {
        if (kind != expectedKind) throw Validation("kind", $"Expected {expectedKind} export.");
        if (version is < 1 or > LeagueNormalizer.GonesDataVersion) throw Validation("gonesDataVersion", "Gones Data Version is unsupported.");
    }

    private static string UniqueName(string source, IEnumerable<string> existing)
    {
        var names = existing.ToHashSet(StringComparer.Ordinal);
        if (!names.Contains(source)) return source;
        var restored = $"{source} (restored)";
        if (!names.Contains(restored)) return restored;
        var suffix = 2;
        while (names.Contains($"{restored} {suffix}")) suffix++;
        return $"{restored} {suffix}";
    }

    private static IReadOnlyList<StoredLeagueResponse> StoreResponse<T>(T response) => response switch
    {
        LeagueCommandResponse league => [Store(league)],
        FullRestoreResponse full => full.Leagues.Select(Store).ToArray(),
        _ => throw new InvalidOperationException("Unsupported stored League command response.")
    };

    private static T RestoreStoredResponse<T>(IReadOnlyList<StoredLeagueResponse> stored)
    {
        object response = typeof(T) == typeof(LeagueCommandResponse)
            ? Restore(stored.Single())
            : typeof(T) == typeof(FullRestoreResponse)
                ? new FullRestoreResponse(stored.Select(Restore).ToArray())
                : throw new InvalidOperationException("Unsupported stored League command response.");
        return (T)response;
    }

    private static StoredLeagueResponse Store(LeagueCommandResponse response) =>
        new(LeagueJson.Serialize(new LeagueDocument(response.Id, response.Name, response.Status, response.Tournaments)), response.DocumentVersion, response.UpdatedAt, response.ETag);

    private static LeagueCommandResponse Restore(StoredLeagueResponse stored)
    {
        var document = LeagueJson.Deserialize<LeagueDocument>(stored.CanonicalDocument);
        return new LeagueCommandResponse(document.Id, document.Name, document.Status, document.Tournaments, stored.DocumentVersion, stored.UpdatedAt, stored.ETag);
    }

    private static ApiValidationException Validation(string field, string message) => new(new Dictionary<string, string[]> { [field] = [message] });
    private static string NewId() => Guid.NewGuid().ToString("D");
    private sealed record StoredLeagueCommand(string RequestHash, IReadOnlyList<StoredLeagueResponse> Leagues);
    private sealed record StoredLeagueResponse(string CanonicalDocument, long DocumentVersion, Instant UpdatedAt, string ETag);
}

internal sealed record CreateLeagueRequest(string Name);
internal sealed record RenameLeagueRequest(string Name);
internal sealed record ChangeLeagueStatusRequest(string Status);
internal sealed record CreateResultTournamentRequest(string Name, string TournamentDate);
internal sealed record EditResultTournamentRequest(string Name, string TournamentDate);
internal sealed record MoveResultTournamentRequest(string TargetLeagueId);
internal sealed record ImportRoundRequest(string Text);
internal sealed record ReplaceRoundRequest(IReadOnlyList<RoundEntry> Entries);
internal sealed record UpdatePlayerArchetypeRequest(string Archetype);
internal sealed record RenamePlayerRequest(string FromName, string ToName);
internal sealed record LeagueRestoreRequest(string Kind, int GonesDataVersion, LeagueDocument League);
internal sealed record FullDataRestoreRequest(string Kind, int GonesDataVersion, IReadOnlyList<LeagueDocument> Leagues);
internal sealed record LeagueCommandResponse(string Id, string Name, string Status, IReadOnlyList<TournamentDocument> Tournaments, long DocumentVersion, Instant UpdatedAt, string ETag);
internal sealed record LeagueDeleteResponse(string Id, bool Deleted, long DocumentVersion, string ETag);
internal sealed record MoveTournamentResponse(LeagueCommandResponse Source, LeagueCommandResponse Target);
internal sealed record FullRestoreResponse(IReadOnlyList<LeagueCommandResponse> Leagues);
