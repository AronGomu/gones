using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Leagues;
using Gones.Api.Organizations;
using Gones.Api.Security;
using Gones.Application.Concurrency;
using Gones.Domain.Archive;
using Gones.Domain.Leagues;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Serialization.SystemTextJson;

namespace Gones.Api.Archive;

/// <summary>
/// The write half of the Tournament tier, where a Tournament is its own row and may stand alone. Like
/// <see cref="ArchiveCommandEndpoints"/>, operation IDs are noun-first (<c>Archive{Tier}{Verb}</c>):
/// the verb-first names still belong to the legacy <see cref="Gones.Api.Leagues.LeagueCommandEndpoints"/>
/// surface, and two endpoints sharing a <c>WithName</c> throw at startup.
/// </summary>
internal static class ArchiveTournamentCommandEndpoints
{
    public static void MapArchiveTournamentCommandEndpoints(this WebApplication app)
    {
        var archive = app.MapGroup("/api/archive").RequireAuthorization(AuthorizationPolicies.Organizer);

        archive.MapPost("/tournaments", CreateAsync).WithName("ArchiveTournamentCreate").Produces<ArchiveTournamentCommandResponse>(StatusCodes.Status201Created);
        archive.MapPatch("/tournaments/{tournamentId}", EditAsync).WithName("ArchiveTournamentEdit").Produces<ArchiveTournamentCommandResponse>();
        archive.MapPatch("/tournaments/{tournamentId}/season", MoveToSeasonAsync).WithName("ArchiveTournamentMoveToSeason").Produces<ArchiveTournamentCommandResponse>();
        archive.MapDelete("/tournaments/{tournamentId}", DeleteAsync).WithName("ArchiveTournamentDelete").Produces<ArchiveDeleteResponse>();
        archive.MapPost("/tournaments/{tournamentId}/rounds", AddRoundAsync).WithName("ArchiveTournamentAddRound").Produces<ArchiveTournamentCommandResponse>();
        archive.MapDelete("/tournaments/{tournamentId}/rounds/{roundId}", DeleteRoundAsync).WithName("ArchiveTournamentDeleteRound").Produces<ArchiveTournamentCommandResponse>();
        archive.MapPost("/tournaments/{tournamentId}/rounds/{roundId}/import", ImportRoundAsync).WithName("ArchiveTournamentImportRound").Produces<ArchiveTournamentCommandResponse>();
        archive.MapPost("/tournaments/{tournamentId}/rounds/{roundId}/replace", ReplaceRoundAsync).WithName("ArchiveTournamentReplaceRound").Produces<ArchiveTournamentCommandResponse>();
        archive.MapPost("/tournaments/{tournamentId}/rounds/{roundId}/entries", AddEntryAsync).WithName("ArchiveTournamentAddEntry").Produces<ArchiveTournamentCommandResponse>();
        archive.MapPatch("/tournaments/{tournamentId}/rounds/{roundId}/entries/{entryId}", EditEntryAsync).WithName("ArchiveTournamentEditEntry").Produces<ArchiveTournamentCommandResponse>();
        archive.MapDelete("/tournaments/{tournamentId}/rounds/{roundId}/entries/{entryId}", DeleteEntryAsync).WithName("ArchiveTournamentDeleteEntry").Produces<ArchiveTournamentCommandResponse>();
        archive.MapPatch("/tournaments/{tournamentId}/archetypes/{playerName}", UpdateArchetypeAsync).WithName("ArchiveTournamentUpdateArchetype").Produces<ArchiveTournamentCommandResponse>();
        archive.MapPost("/tournaments/{tournamentId}/edit-batch", ApplyEditBatchAsync).WithName("ArchiveTournamentApplyEditBatch").Produces<ArchiveTournamentBatchEditResponse>();
        archive.MapPost("/tournaments/{tournamentId}/players/rename", RenamePlayerAsync).WithName("ArchiveTournamentRenamePlayer").Produces<ArchiveTournamentCommandResponse>();
        archive.MapPost("/restore", RestoreAsync).WithName("ArchiveRestore").Produces<ArchiveRestoreResponse>(StatusCodes.Status201Created);
        archive.MapPost("/restore-full", RestoreFullAsync)
            .WithName("ArchiveRestoreFull")
            .RequireAuthorization(AuthorizationPolicies.Admin)
            .Produces<ArchiveRestoreResponse>(StatusCodes.Status201Created);
    }

    private static async Task<IResult> CreateAsync(
        CreateArchiveTournamentRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        ClaimsPrincipal principal,
        HttpResponse httpResponse,
        ArchiveTournamentCommandService service,
        CancellationToken cancellationToken)
    {
        var response = await service.CreateAsync(
            OrganizationPrincipal.UserId(principal),
            OrganizationPrincipal.IsAdmin(principal),
            RequiredIdempotencyKey(idempotencyKey),
            request,
            cancellationToken);
        httpResponse.Headers.ETag = response.ETag;
        return Results.Created($"/api/archive/tournaments/{response.Id}", response);
    }

    private static Task<IResult> EditAsync(string tournamentId, EditArchiveTournamentRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken) =>
        OkAsync(response, service.MutateAsync(tournamentId, principal, RequiredVersion(ifMatch), "archive.tournament.edited", ["name", "tournamentDate", "status"], document => ArchiveTournamentCommands.Edit(document, request.Name!, request.TournamentDate!, request.Status), cancellationToken));

    private static Task<IResult> MoveToSeasonAsync(string tournamentId, MoveArchiveTournamentRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken)
    {
        var seasonId = ArchiveTournamentCommandService.MoveTarget(request.SeasonId);
        return OkAsync(response, service.MutateAsync(tournamentId, principal, RequiredVersion(ifMatch), "archive.tournament.season.changed", ["seasonId"], document => ArchiveTournamentCommands.MoveToSeason(document, seasonId), cancellationToken));
    }

    private static async Task<IResult> DeleteAsync(string tournamentId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken)
    {
        var result = await service.DeleteAsync(tournamentId, principal, RequiredVersion(ifMatch), cancellationToken);
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static Task<IResult> AddRoundAsync(string tournamentId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken)
    {
        var roundId = NewId();
        return OkAsync(response, service.MutateAsync(tournamentId, principal, RequiredVersion(ifMatch), "archive.tournament.round.added", ["rounds"], document => ArchiveTournamentCommands.AddRound(document, roundId), cancellationToken));
    }

    private static Task<IResult> DeleteRoundAsync(string tournamentId, string roundId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken) =>
        OkAsync(response, service.MutateAsync(tournamentId, principal, RequiredVersion(ifMatch), "archive.tournament.round.deleted", ["rounds"], document => ArchiveTournamentCommands.DeleteRound(document, roundId), cancellationToken));

    private static Task<IResult> ImportRoundAsync(string tournamentId, string roundId, ImportArchiveRoundRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken)
    {
        var imported = RoundCsvAdapter.Import(request.Text, NewId);
        return OkAsync(response, service.MutateAsync(tournamentId, principal, RequiredVersion(ifMatch), "archive.tournament.round.imported", ["rounds", "playerArchetypes"], document => ArchiveTournamentCommands.ReplaceRound(document, roundId, imported.Entries, true), cancellationToken));
    }

    private static Task<IResult> ReplaceRoundAsync(string tournamentId, string roundId, ReplaceArchiveRoundRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken)
    {
        var entries = ArchiveTournamentCommandService.RequiredEntries(request.Entries);
        return OkAsync(response, service.MutateAsync(tournamentId, principal, RequiredVersion(ifMatch), "archive.tournament.round.replaced", ["rounds"], document => ArchiveTournamentCommands.ReplaceRound(document, roundId, entries, false), cancellationToken));
    }

    private static Task<IResult> AddEntryAsync(string tournamentId, string roundId, RoundEntry request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken)
    {
        // Entry IDs are server-owned: a client-supplied ID is discarded on add and forced to the route
        // ID on edit, exactly as the legacy surface does.
        var entry = WithId(request, NewId());
        return OkAsync(response, service.MutateAsync(tournamentId, principal, RequiredVersion(ifMatch), "archive.tournament.entry.added", ["entries"], document => ArchiveTournamentCommands.AddEntry(document, roundId, entry), cancellationToken));
    }

    private static Task<IResult> EditEntryAsync(string tournamentId, string roundId, string entryId, RoundEntry request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken)
    {
        var entry = WithId(request, entryId);
        return OkAsync(response, service.MutateAsync(tournamentId, principal, RequiredVersion(ifMatch), "archive.tournament.entry.edited", ["entries"], document => ArchiveTournamentCommands.EditEntry(document, roundId, entryId, entry), cancellationToken));
    }

    private static Task<IResult> DeleteEntryAsync(string tournamentId, string roundId, string entryId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken) =>
        OkAsync(response, service.MutateAsync(tournamentId, principal, RequiredVersion(ifMatch), "archive.tournament.entry.deleted", ["entries"], document => ArchiveTournamentCommands.DeleteEntry(document, roundId, entryId), cancellationToken));

    private static Task<IResult> UpdateArchetypeAsync(string tournamentId, string playerName, UpdateArchivePlayerArchetypeRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken) =>
        OkAsync(response, service.MutateAsync(tournamentId, principal, RequiredVersion(ifMatch), "archive.tournament.archetype.updated", ["playerArchetypes"], document => ArchiveTournamentCommands.UpdateArchetype(document, playerName, request.Archetype!), cancellationToken));

    private static Task<IResult> RenamePlayerAsync(string tournamentId, RenameArchivePlayerRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken) =>
        OkAsync(response, service.MutateAsync(tournamentId, principal, RequiredVersion(ifMatch), "archive.tournament.player_name.renamed", ["playerNames"], document => ArchiveTournamentCommands.RenamePlayer(document, request.FromName!, request.ToName!), cancellationToken));

    private static async Task<IResult> ApplyEditBatchAsync(string tournamentId, ArchiveTournamentBatchEditRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken)
    {
        var result = await service.ApplyEditBatchAsync(tournamentId, principal, RequiredVersion(ifMatch), request, cancellationToken);
        response.Headers.ETag = result.Tournament.ETag;
        return Results.Ok(result);
    }

    private static Task<IResult> RestoreAsync(ArchiveRestoreRequest request, [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken) =>
        CreatedAsync(service.RestoreAsync(OrganizationPrincipal.UserId(principal), RequiredIdempotencyKey(idempotencyKey), request, "archive", "restore", cancellationToken));

    private static Task<IResult> RestoreFullAsync(ArchiveRestoreRequest request, [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey, ClaimsPrincipal principal, ArchiveTournamentCommandService service, CancellationToken cancellationToken) =>
        CreatedAsync(service.RestoreAsync(OrganizationPrincipal.UserId(principal), RequiredIdempotencyKey(idempotencyKey), request, "fullArchive", "restore-full", cancellationToken));

    private static async Task<IResult> OkAsync(HttpResponse response, Task<ArchiveTournamentCommandResponse> pending)
    {
        var result = await pending;
        response.Headers.ETag = result.ETag;
        return Results.Ok(result);
    }

    private static async Task<IResult> CreatedAsync(Task<ArchiveRestoreResponse> pending) =>
        Results.Json(await pending, statusCode: StatusCodes.Status201Created);

    private static RoundEntry WithId(RoundEntry entry, string id) => entry switch
    {
        MatchRoundEntry match => match with { Id = id },
        ByeRoundEntry bye => bye with { Id = id },
        InvalidRoundEntry invalid => invalid with { Id = id },
        _ => entry
    };

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

/// <summary>
/// Every Tournament write funnels through <see cref="MutateAsync"/>: lock the row, check the version,
/// check the derived 365-day lock, transform, apply in one version bump, then recompute the owning
/// Season counters and rebuild <c>player_statistics</c> inside the same transaction.
/// </summary>
internal sealed class ArchiveTournamentCommandService(GonesDbContext database, IClock clock, PlayerStatisticsRebuildService playerStatistics)
{
    public const int MaximumIdLength = 200;
    public const int ArchiveBundleVersion = 5;
    public const int MaximumRestoreLeagues = 100;
    public const int MaximumRestoreLeagueSeasons = 1_000;
    public const int MaximumRestoreTournaments = 10_000;

    private const string LeagueEntityType = "archiveLeague";
    private const string SeasonEntityType = "archiveLeagueSeason";
    private const string TournamentEntityType = "archiveTournament";

    private static readonly JsonSerializerOptions StoredJsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        .ConfigureForNodaTime(DateTimeZoneProviders.Tzdb);

    public Task<ArchiveTournamentCommandResponse> CreateAsync(Guid actorId, bool isAdmin, string key, CreateArchiveTournamentRequest request, CancellationToken cancellationToken) =>
        ExecuteIdempotentAsync(actorId, key, "tournament-create", request, async () =>
        {
            RequireUnlocked(RequiredDate(request.TournamentDate), isAdmin);
            var seasonId = MoveTarget(request.SeasonId);
            await RequireSeasonAsync(seasonId, cancellationToken);
            var tournament = Guarded(() => ArchiveTournament.Create(
                ArchiveTournamentCommands.Create(NewId(), seasonId, request.Name!, request.TournamentDate!),
                clock.GetCurrentInstant()));
            database.ArchiveTournaments.Add(tournament);
            AddAudit(actorId, "archive.tournament.created", TournamentEntityType, tournament.DocumentId, ["tournament"]);
            await SaveAsync(cancellationToken);
            await RecomputeSeasonCountsAsync([tournament.SeasonId], cancellationToken);
            // No rebuild: a create mints an empty Tournament, and ADR 0040 counts Matches. With no Round
            // there is no Match, no rating period and no player, so not one row of the read model can
            // differ — and a rebuild is a full recompute of every scope. The first write that gives this
            // Tournament a result goes through MutateAsync, which does rebuild.
            return Response(tournament);
        }, cancellationToken);

    public async Task<ArchiveTournamentCommandResponse> MutateAsync(
        string tournamentId,
        ClaimsPrincipal principal,
        long expectedVersion,
        string auditAction,
        IReadOnlyList<string> fields,
        Func<ArchiveTournamentDocument, ArchiveTournamentDocument> command,
        CancellationToken cancellationToken)
    {
        var isAdmin = OrganizationPrincipal.IsAdmin(principal);
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var tournament = await LockTournamentAsync(tournamentId, cancellationToken);
        RequireVersion(tournament.Version, expectedVersion);
        RequireUnlocked(tournament.TournamentDate, isAdmin);
        var previousSeasonId = tournament.SeasonId;

        ArchiveTournamentDocument changed;
        LocalDate changedDate;
        try
        {
            changed = command(tournament.ReadDocument());
            changedDate = ArchiveTournamentCommands.ParseDate(changed.TournamentDate);
        }
        catch (ArgumentException exception) { throw Validation(exception.ParamName ?? "command", exception.Message); }
        catch (KeyNotFoundException) { throw new ResourceNotFoundException(); }
        catch (InvalidOperationException) { throw new ResourceConflictException(); }

        // Guarded on the requested date too, so a non-Admin can never back-date a row into the window
        // they are then forbidden to touch.
        RequireUnlocked(changedDate, isAdmin);
        // Only a real move needs the existence check: re-validating an unchanged Season would spend a
        // query per content write, and would 404 a content edit whose Season was deleted underneath it.
        if (!string.Equals(changed.SeasonId, previousSeasonId, StringComparison.Ordinal))
            await RequireSeasonAsync(changed.SeasonId, cancellationToken);
        // One call, so one bump: an edit-batch that both edits and moves owes its caller exactly one.
        Guarded(() => tournament.ApplyAndMove(changed, changed.SeasonId, clock.GetCurrentInstant()));
        AddAudit(actorId: OrganizationPrincipal.UserId(principal), auditAction, TournamentEntityType, tournament.DocumentId, fields);
        await SaveAsync(cancellationToken);
        await RecomputeSeasonCountsAsync([previousSeasonId, tournament.SeasonId], cancellationToken);
        await RebuildPlayerStatisticsAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Response(tournament);
    }

    public async Task<ArchiveDeleteResponse> DeleteAsync(string tournamentId, ClaimsPrincipal principal, long expectedVersion, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var tournament = await LockTournamentAsync(tournamentId, cancellationToken);
        RequireVersion(tournament.Version, expectedVersion);
        RequireUnlocked(tournament.TournamentDate, OrganizationPrincipal.IsAdmin(principal));
        var seasonId = tournament.SeasonId;
        Guarded(() => tournament.SoftDelete(clock.GetCurrentInstant()));
        AddAudit(OrganizationPrincipal.UserId(principal), "archive.tournament.deleted", TournamentEntityType, tournament.DocumentId, ["deletedAt"]);
        await SaveAsync(cancellationToken);
        await RecomputeSeasonCountsAsync([seasonId], cancellationToken);
        await RebuildPlayerStatisticsAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new ArchiveDeleteResponse(tournament.DocumentId, true, tournament.Version, StrongETag.Encode(tournament.Version));
    }

    /// <summary>
    /// ADR 0037: one fixed explicit intent batch, one <see cref="MutateAsync"/> call, one version bump —
    /// including when the batch also moves the Tournament to another Season.
    /// </summary>
    public async Task<ArchiveTournamentBatchEditResponse> ApplyEditBatchAsync(string tournamentId, ClaimsPrincipal principal, long expectedVersion, ArchiveTournamentBatchEditRequest request, CancellationToken cancellationToken)
    {
        var batch = ValidateEditBatch(request);
        var move = request.MoveToSeason;
        var seasonId = move is null ? null : MoveTarget(move.SeasonId);
        var tournament = await MutateAsync(
            tournamentId,
            principal,
            expectedVersion,
            "archive.tournament.edit_batch.applied",
            EditBatchIntentNames(request),
            document =>
            {
                var edited = ArchiveTournamentCommands.ApplyEditBatch(document, batch);
                return move is null ? edited : ArchiveTournamentCommands.MoveToSeason(edited, seasonId);
            },
            cancellationToken);
        return new ArchiveTournamentBatchEditResponse(tournament);
    }

    /// <summary>
    /// Historical bulk import. Deliberately exempt from the 365-day lock: it mints brand-new IDs for
    /// every tier in one shot and rewrites no protected row.
    /// </summary>
    public Task<ArchiveRestoreResponse> RestoreAsync(Guid actorId, string key, ArchiveRestoreRequest request, string expectedKind, string command, CancellationToken cancellationToken) =>
        ExecuteIdempotentAsync(actorId, key, command, request, () => RestoreBundleAsync(actorId, request, expectedKind, cancellationToken), cancellationToken);

    private async Task<ArchiveRestoreResponse> RestoreBundleAsync(Guid actorId, ArchiveRestoreRequest request, string expectedKind, CancellationToken cancellationToken)
    {
        ValidateBundle(request, expectedKind);
        var now = clock.GetCurrentInstant();
        var leagueIds = request.Leagues.ToDictionary(item => item.Id, _ => NewId(), StringComparer.Ordinal);
        var seasonIds = request.LeagueSeasons.ToDictionary(item => item.Id, _ => NewId(), StringComparer.Ordinal);
        foreach (var season in request.LeagueSeasons)
            if (!leagueIds.ContainsKey(season.LeagueId ?? string.Empty))
                throw Validation("leagueSeasons", "Bundle link does not resolve inside the bundle.");
        foreach (var tournament in request.Tournaments)
            if (tournament.SeasonId is not null && !seasonIds.ContainsKey(tournament.SeasonId))
                throw Validation("tournaments", "Bundle link does not resolve inside the bundle.");

        var leagueNames = await database.ArchiveLeagues.AsNoTracking().Select(item => item.Name).ToListAsync(cancellationToken);
        var leagues = new List<ArchiveRestoredId>(request.Leagues.Count);
        foreach (var source in request.Leagues)
        {
            var league = Guarded(() => ArchiveLeague.Create(leagueIds[source.Id], UniqueName(source.Name, leagueNames), now));
            leagueNames.Add(league.Name);
            database.ArchiveLeagues.Add(league);
            AddAudit(actorId, "archive.league.restored", LeagueEntityType, league.DocumentId, ["league"]);
            leagues.Add(Restored(source.Id, league.DocumentId, league.Name, league.Version));
        }

        var seasonNames = await database.ArchiveLeagueSeasons.AsNoTracking().Select(item => item.Name).ToListAsync(cancellationToken);
        var seasons = new List<ArchiveRestoredId>(request.LeagueSeasons.Count);
        foreach (var source in request.LeagueSeasons)
        {
            var season = Guarded(() => ArchiveLeagueSeason.Create(seasonIds[source.Id], leagueIds[source.LeagueId], UniqueName(source.Name, seasonNames), source.Status, now));
            seasonNames.Add(season.Name);
            database.ArchiveLeagueSeasons.Add(season);
            AddAudit(actorId, "archive.league_season.restored", SeasonEntityType, season.DocumentId, ["leagueSeason"]);
            seasons.Add(Restored(source.Id, season.DocumentId, season.Name, season.Version));
        }

        // Round and entry IDs are remapped by the existing restore path, so the bundle can never smuggle
        // a colliding ID in.
        var remapped = Guarded(() => ArchiveTournamentCommands.Restore(
            [.. request.Tournaments.Select(item => item with { SeasonId = item.SeasonId is null ? null : seasonIds[item.SeasonId] })],
            NewId));
        var tournaments = new List<ArchiveRestoredId>(remapped.Count);
        for (var index = 0; index < remapped.Count; index++)
        {
            var tournament = Guarded(() => ArchiveTournament.Create(remapped[index], now));
            database.ArchiveTournaments.Add(tournament);
            AddAudit(actorId, "archive.tournament.restored", TournamentEntityType, tournament.DocumentId, ["tournament"]);
            tournaments.Add(Restored(request.Tournaments[index].Id, tournament.DocumentId, tournament.Name, tournament.Version));
        }

        await SaveAsync(cancellationToken);
        await RecomputeSeasonCountsAsync([.. seasonIds.Values], cancellationToken);
        await RebuildPlayerStatisticsAsync(cancellationToken);
        return new ArchiveRestoreResponse(leagues, seasons, tournaments);
    }

    /// <summary>
    /// Serializes two concurrent writers of the same Tournament before either transform runs, so the
    /// version check and the transform see the same row.
    /// </summary>
    private async Task<ArchiveTournament> LockTournamentAsync(string tournamentId, CancellationToken cancellationToken) =>
        await database.ArchiveTournaments
            .FromSqlInterpolated($"SELECT * FROM archive_tournaments WHERE document_id = {tournamentId} AND deleted_at IS NULL FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
        ?? throw new ResourceNotFoundException();

    /// <summary>Existence only, and never tracked, so a Tournament write can never bump a Season row.</summary>
    private async Task RequireSeasonAsync(string? seasonId, CancellationToken cancellationToken)
    {
        if (seasonId is null) return;
        var exists = await database.ArchiveLeagueSeasons.AsNoTracking()
            .AnyAsync(item => item.DocumentId == seasonId && item.DeletedAt == null, cancellationToken);
        if (!exists) throw new ResourceNotFoundException();
    }

    /// <summary>
    /// Rewrites the derived Season counters from the Season's live Tournaments, after the Tournament
    /// write has been saved and before the transaction commits. <c>RefreshCatalogCounts</c> touches
    /// neither <c>version</c> nor <c>updated_at</c>, which is what keeps concurrency per row. Each Season
    /// row is locked FOR UPDATE before its Tournaments are counted, so a concurrent writer recounts after
    /// this one commits instead of overwriting it with a stale snapshot; Seasons are processed in
    /// ascending ID order so two opposing concurrent moves take the two row locks in the same order and
    /// cannot deadlock.
    /// </summary>
    private async Task RecomputeSeasonCountsAsync(IEnumerable<string?> seasonIds, CancellationToken cancellationToken)
    {
        foreach (var seasonId in seasonIds.OfType<string>().Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal))
        {
            var season = (await database.ArchiveLeagueSeasons
                .FromSqlInterpolated($"SELECT * FROM archive_league_seasons WHERE document_id = {seasonId} AND deleted_at IS NULL FOR UPDATE")
                .ToListAsync(cancellationToken)).SingleOrDefault();
            if (season is null) continue;
            var stored = await database.ArchiveTournaments.AsNoTracking()
                .Where(item => item.SeasonId == seasonId && item.DeletedAt == null)
                .ToListAsync(cancellationToken);
            season.RefreshCatalogCounts(ArchiveCatalogCounts.ForSeason(seasonId, [.. stored.Select(item => item.ReadDocument())]));
            await SaveAsync(cancellationToken);
        }
    }

    private async Task<T> ExecuteIdempotentAsync<T>(Guid actorId, string key, string command, object request, Func<Task<T>> execute, CancellationToken cancellationToken)
    {
        var scope = $"archive-command:{actorId:D}:{command}";
        var requestHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request, StoredJsonOptions))));
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        await database.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({scope}), hashtext({key}))", cancellationToken);
        var existing = await database.IdempotencyRecords.AsNoTracking().SingleOrDefaultAsync(item => item.Scope == scope && item.Key == key, cancellationToken);
        if (existing is not null)
        {
            var stored = JsonSerializer.Deserialize<StoredArchiveCommand>(existing.ResponseBody, StoredJsonOptions)
                ?? throw new InvalidOperationException("Stored archive command response is invalid.");
            if (stored.RequestHash != requestHash) throw new IdempotencyConflictException();
            await transaction.CommitAsync(cancellationToken);
            return JsonSerializer.Deserialize<T>(stored.ResponseJson, StoredJsonOptions)!;
        }

        var response = await execute();
        var now = clock.GetCurrentInstant();
        database.IdempotencyRecords.Add(new IdempotencyRecord
        {
            Scope = scope,
            Key = key,
            ResponseStatusCode = StatusCodes.Status201Created,
            ResponseBody = JsonSerializer.Serialize(new StoredArchiveCommand(requestHash, JsonSerializer.Serialize(response, StoredJsonOptions)), StoredJsonOptions),
            CreatedAt = now,
            ExpiresAt = now + Duration.FromHours(24)
        });
        // No rebuild here: this save only stores the idempotency record, and a command routed through it
        // has already rebuilt inside this same transaction if it needed to.
        await SaveAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return response;
    }

    /// <summary>
    /// Rewrites <c>player_statistics</c> from the archive this command just changed, inside the caller's
    /// transaction and before the <c>SaveChangesAsync</c> that stages the new rows, so the read model and
    /// the write commit or roll back together — the same guarantee
    /// <see cref="Gones.Api.Leagues.LeagueCommandService"/> gives the legacy surface (ADR 0040).
    ///
    /// <para>Called <b>after</b> the archive write has been saved, never before it. The rebuild takes a
    /// transaction-scoped advisory lock and every archive row this command touches is already locked by
    /// then, so the order is always rows first and statistics last: two concurrent writers can queue on
    /// the rebuild, but neither can hold it while waiting for the other's rows.</para>
    /// </summary>
    private async Task RebuildPlayerStatisticsAsync(CancellationToken cancellationToken)
    {
        await playerStatistics.RebuildAsync(database, cancellationToken);
        await SaveAsync(cancellationToken);
    }

    private LocalDate Today() => clock.GetCurrentInstant().InUtc().Date;

    private void RequireUnlocked(LocalDate tournamentDate, bool isAdmin)
    {
        if (isAdmin) return;
        if (ArchiveLockRule.IsLocked(tournamentDate, Today())) throw new ArchiveTournamentLockedException();
    }

    /// <summary>
    /// Null means "standalone"; blank does not, because a caller who sent an empty string almost
    /// certainly meant to send an ID.
    /// </summary>
    public static string? MoveTarget(string? seasonId)
    {
        if (seasonId is null) return null;
        var trimmed = seasonId.Trim();
        if (trimmed.Length == 0 || trimmed.Length > MaximumIdLength)
            throw Validation("seasonId", "Season ID cannot be blank; use null for a standalone Tournament.");
        return trimmed;
    }

    private static LocalDate RequiredDate(string? value)
    {
        try
        {
            return ArchiveTournamentCommands.ParseDate(value ?? string.Empty);
        }
        catch (ArgumentException exception)
        {
            throw Validation("tournamentDate", exception.Message);
        }
    }

    private static ArchiveTournamentEditBatch ValidateEditBatch(ArchiveTournamentBatchEditRequest request)
    {
        if (request.AddRounds is null || request.DeleteRoundIds is null || request.ReplaceRounds is null || request.UpdateArchetypes is null)
            throw Validation("command", "All intent arrays are required.");
        if (request.AddRounds.Any(intent => intent is null || intent.Entries is null)
            || request.ReplaceRounds.Any(intent => intent is null || intent.Entries is null)
            || request.UpdateArchetypes.Any(intent => intent is null))
            throw Validation("command", "Intent rows and Round entries arrays are required.");
        if (request.MoveToSeason is null
            && request.EditTournament is null
            && request.Status is null
            && request.AddRounds.Count == 0
            && request.DeleteRoundIds.Count == 0
            && request.ReplaceRounds.Count == 0
            && request.UpdateArchetypes.Count == 0)
            throw Validation("command", "Edit batch cannot be empty.");
        return new ArchiveTournamentEditBatch(request.EditTournament, request.AddRounds, request.DeleteRoundIds, request.ReplaceRounds, request.UpdateArchetypes, request.Status);
    }

    private static IReadOnlyList<string> EditBatchIntentNames(ArchiveTournamentBatchEditRequest request)
    {
        var names = new List<string>();
        if (request.EditTournament is not null) names.Add("editTournament");
        if (request.DeleteRoundIds.Count > 0) names.Add("deleteRounds");
        if (request.AddRounds.Count > 0) names.Add("addRounds");
        if (request.ReplaceRounds.Count > 0) names.Add("replaceRounds");
        if (request.UpdateArchetypes.Count > 0) names.Add("updateArchetypes");
        if (request.MoveToSeason is not null) names.Add("moveToSeason");
        if (request.Status is not null) names.Add("status");
        return names;
    }

    private static void ValidateBundle(ArchiveRestoreRequest request, string expectedKind)
    {
        if (request.Kind != expectedKind) throw Validation("kind", $"Expected {expectedKind} export.");
        if (request.Version != ArchiveBundleVersion) throw Validation("version", "Archive bundle version is unsupported.");
        if (request.Leagues is null || request.LeagueSeasons is null || request.Tournaments is null)
            throw Validation("bundle", "Bundle collections are required.");
        if (request.Leagues.Count > MaximumRestoreLeagues) throw Validation("leagues", $"Bundle supports at most {MaximumRestoreLeagues} Leagues.");
        if (request.LeagueSeasons.Count > MaximumRestoreLeagueSeasons) throw Validation("leagueSeasons", $"Bundle supports at most {MaximumRestoreLeagueSeasons} League Seasons.");
        if (request.Tournaments.Count > MaximumRestoreTournaments) throw Validation("tournaments", $"Bundle supports at most {MaximumRestoreTournaments} Tournaments.");
        RequireUniqueIds(request.Leagues.Select(item => item?.Id), "leagues");
        RequireUniqueIds(request.LeagueSeasons.Select(item => item?.Id), "leagueSeasons");
        RequireUniqueIds(request.Tournaments.Select(item => item?.Id), "tournaments");
        // The remap runs before the aggregate validates, so a null collection has to be refused here or
        // it faults inside LeagueCommands.Restore instead of answering 400.
        if (request.Tournaments.Any(item => item.Rounds is null || item.PlayerArchetypes is null)
            || request.Tournaments.Any(item => item.Rounds.Any(round => round is null || round.Entries is null)))
            throw Validation("tournaments", "Tournament Rounds, Round entries and player archetypes are required.");
    }

    public static IReadOnlyList<RoundEntry> RequiredEntries(IReadOnlyList<RoundEntry>? entries) =>
        entries ?? throw Validation("entries", "Round entries are required.");

    private static void RequireUniqueIds(IEnumerable<string?> ids, string field)
    {
        var values = ids.ToArray();
        if (values.Any(string.IsNullOrWhiteSpace) || values.Any(id => id!.Length > MaximumIdLength))
            throw Validation(field, "Bundle IDs are required and bounded.");
        if (values.Distinct(StringComparer.Ordinal).Count() != values.Length)
            throw Validation(field, "Bundle IDs must be unique.");
    }

    private static string UniqueName(string? source, IEnumerable<string> existing)
    {
        var names = existing.ToHashSet(StringComparer.Ordinal);
        var candidate = source ?? string.Empty;
        if (!names.Contains(candidate)) return candidate;
        var restored = $"{candidate} (restored)";
        if (!names.Contains(restored)) return restored;
        var suffix = 2;
        while (names.Contains($"{restored} {suffix}")) suffix++;
        return $"{restored} {suffix}";
    }

    // `actual` is the aggregate's `int Version`, widened by the caller; `expected` is the decoded
    // If-Match, which StrongETag always yields as a long.
    private static void RequireVersion(long actual, long expected)
    {
        if (actual != expected) throw new ConcurrencyConflictException();
    }

    /// <summary>Maps the domain's refusals onto their wire codes: 400 for a bad argument, 409 for a refused transition.</summary>
    private static T Guarded<T>(Func<T> build)
    {
        try
        {
            return build();
        }
        catch (ArgumentException exception) { throw Validation(exception.ParamName ?? "command", exception.Message); }
        catch (InvalidOperationException) { throw new ResourceConflictException(); }
    }

    private static void Guarded(Action mutate) => Guarded<object?>(() =>
    {
        mutate();
        return null;
    });

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

    private void AddAudit(Guid actorId, string action, string entityType, string entityId, IReadOnlyList<string> fields) =>
        database.AuditRecords.Add(new AuditRecord
        {
            ActorId = actorId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            RedactedDiff = JsonSerializer.Serialize(new { fields }, StoredJsonOptions),
            OccurredAt = clock.GetCurrentInstant()
        });

    private static ArchiveRestoredId Restored(string sourceId, string id, string name, int version) =>
        new(sourceId, id, name, version, StrongETag.Encode(version));

    /// <summary>
    /// Carries the authoritative document, not just the envelope: ADR 0037 requires a successful staged
    /// save to adopt it without a refetch.
    /// </summary>
    private static ArchiveTournamentCommandResponse Response(ArchiveTournament tournament)
    {
        var document = tournament.ReadDocument();
        return new ArchiveTournamentCommandResponse(
            document.Id,
            document.SeasonId,
            document.Name,
            document.TournamentDate,
            document.Status,
            document.Rounds,
            document.PlayerArchetypes,
            tournament.Version,
            tournament.UpdatedAt,
            StrongETag.Encode(tournament.Version));
    }

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private static string NewId() => Guid.NewGuid().ToString("D");

    private sealed record StoredArchiveCommand(string RequestHash, string ResponseJson);
}

internal sealed record CreateArchiveTournamentRequest(string? Name, string? TournamentDate, string? SeasonId);
internal sealed record EditArchiveTournamentRequest(string? Name, string? TournamentDate, string? Status);
internal sealed record MoveArchiveTournamentRequest(string? SeasonId);
internal sealed record ImportArchiveRoundRequest(string? Text);
internal sealed record ReplaceArchiveRoundRequest(IReadOnlyList<RoundEntry>? Entries);
internal sealed record UpdateArchivePlayerArchetypeRequest(string? Archetype);
internal sealed record RenameArchivePlayerRequest(string? FromName, string? ToName);

/// <summary>
/// Presence of the intent is the move discriminator: a null intent means "do not move", and an intent
/// whose <see cref="SeasonId"/> is null means "detach to standalone".
/// </summary>
internal sealed record ArchiveSeasonMoveIntent(string? SeasonId);

/// <summary>
/// Named <c>BatchEdit</c> rather than <c>EditBatch</c> because
/// <see cref="Gones.Api.Leagues.ArchiveTournamentEditBatchRequest"/> already owns that OpenAPI schema ID
/// and the generated client already exports it. The shorter names free up when T19 retires the legacy
/// surface; renaming the legacy client interface now would break its existing consumers.
/// </summary>
internal sealed record ArchiveTournamentBatchEditRequest(
    ArchiveSeasonMoveIntent? MoveToSeason,
    EditArchiveTournamentIntent? EditTournament,
    string? Status,
    IReadOnlyList<AddArchiveRoundIntent> AddRounds,
    IReadOnlyList<string> DeleteRoundIds,
    IReadOnlyList<ReplaceArchiveRoundIntent> ReplaceRounds,
    IReadOnlyList<UpdateArchiveArchetypeIntent> UpdateArchetypes);

internal sealed record ArchiveRestoreRequest(
    string? Kind,
    int Version,
    IReadOnlyList<ArchiveLeagueDocument> Leagues,
    IReadOnlyList<ArchiveLeagueSeasonDocument> LeagueSeasons,
    IReadOnlyList<ArchiveTournamentDocument> Tournaments);

internal sealed record ArchiveTournamentCommandResponse(
    string Id,
    string? SeasonId,
    string Name,
    string TournamentDate,
    string Status,
    IReadOnlyList<RoundDocument> Rounds,
    IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes,
    int DocumentVersion,
    Instant UpdatedAt,
    string ETag);

internal sealed record ArchiveTournamentBatchEditResponse(ArchiveTournamentCommandResponse Tournament);

internal sealed record ArchiveRestoredId(string SourceId, string Id, string Name, int DocumentVersion, string ETag);

internal sealed record ArchiveRestoreResponse(
    IReadOnlyList<ArchiveRestoredId> Leagues,
    IReadOnlyList<ArchiveRestoredId> LeagueSeasons,
    IReadOnlyList<ArchiveRestoredId> Tournaments);

/// <summary>409. A Tournament older than the derived lock window refuses every non-Admin write.</summary>
internal sealed class ArchiveTournamentLockedException()
    : ApiException("archive_tournament_locked", "Tournament is older than the archive lock window and can only be changed by an administrator.", StatusCodes.Status409Conflict);
