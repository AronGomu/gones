using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Application.Concurrency;
using Gones.Domain.Archive;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

/// <summary>
/// The Tournament write surface. Stored state is asserted through <see cref="GonesDbContext"/> and never
/// through a GET: the read endpoints belong to later tickets. Seed dates are relative to today on
/// purpose — a fixed calendar date would drift into the 365-day lock window and start failing this
/// suite a year after it was written.
/// </summary>
public sealed class ArchiveTournamentCommandApiTests : IAsyncLifetime
{
    private static readonly Guid Actor = Guid.Parse("10000000-0000-0000-0000-000000000004");
    private static readonly LocalDate Today = SystemClock.Instance.GetCurrentInstant().InUtc().Date;
    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            // audit_records.actor_id references asp_net_users since AllowAccountHardDelete, so the
            // synthetic actor these commands audit against needs a real account row.
            database.Users.Add(new ApplicationUser
            {
                Id = Actor,
                UserName = "archive-tournament-actor",
                NormalizedUserName = "ARCHIVE-TOURNAMENT-ACTOR",
                Email = "archive-tournament-actor@example.test",
                NormalizedEmail = "ARCHIVE-TOURNAMENT-ACTOR@EXAMPLE.TEST",
                SecurityStamp = Guid.NewGuid().ToString("N"),
                ConcurrencyStamp = Guid.NewGuid().ToString("N")
            });
            var seeded = Instant.FromUtc(2026, 1, 1, 12, 0);
            database.ArchiveLeagues.Add(ArchiveLeague.Create("league-1", "Ligue 1", seeded));
            database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-1", "league-1", "Saison 1", "active", seeded));
            database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-2", "league-1", "Saison 2", "active", seeded));
            database.ArchiveTournaments.Add(ArchiveTournament.Create(
                new ArchiveTournamentDocument(
                    "tournament-1",
                    "Tournoi 1",
                    "season-1",
                    ArchiveTournamentCommands.FormatDate(Today),
                    "active",
                    [new RoundDocument("round-1", [new MatchRoundEntry("entry-1", "1", "Alice", "Bob", 2, 1, "Tempo", "Control")])],
                    []),
                seeded));
            await database.SaveChangesAsync();
        }
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t4-archive-tournament-command-signing-key");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
        });
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Tournament_commands_reject_anonymous_and_plain_User_callers()
    {
        using var anonymous = await SendAsync(HttpMethod.Post, "/api/archive/tournaments", new { name = "Nope", tournamentDate = Iso(Today) }, role: null, key: "anon");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        var ifMatch = StrongETag.Encode(1);
        (HttpMethod Method, string Path, object Body, string? IfMatch, string? Key)[] routes =
        [
            (HttpMethod.Post, "/api/archive/tournaments", new { name = "Nope", tournamentDate = Iso(Today) }, null, "user-1"),
            (HttpMethod.Patch, "/api/archive/tournaments/tournament-1", new { name = "Nope", tournamentDate = Iso(Today) }, ifMatch, null),
            (HttpMethod.Patch, "/api/archive/tournaments/tournament-1/season", new { seasonId = "season-2" }, ifMatch, null),
            (HttpMethod.Delete, "/api/archive/tournaments/tournament-1", new { }, ifMatch, null),
            (HttpMethod.Post, "/api/archive/tournaments/tournament-1/rounds", new { }, ifMatch, null),
            (HttpMethod.Post, "/api/archive/tournaments/tournament-1/edit-batch", EmptyBatch(), ifMatch, null),
            (HttpMethod.Post, "/api/archive/restore", new { kind = "archive", version = 5, leagues = Array.Empty<object>(), leagueSeasons = Array.Empty<object>(), tournaments = Array.Empty<object>() }, null, "user-2")
        ];

        foreach (var (method, path, body, routeIfMatch, key) in routes)
        {
            using var response = await SendAsync(method, path, body, "User", ifMatch: routeIfMatch, key: key);
            await AssertProblem(response, HttpStatusCode.Forbidden, "forbidden");
        }

        await using var database = CreateContext();
        Assert.Equal(1, (await TournamentAsync(database, "tournament-1")).Version);
    }

    [Fact]
    public async Task Tournament_create_requires_an_Idempotency_Key_and_replays_the_same_row()
    {
        using var noKey = await SendAsync(HttpMethod.Post, "/api/archive/tournaments", new { name = "Sans clef", tournamentDate = Iso(Today) }, "Organizer");
        await AssertProblem(noKey, HttpStatusCode.BadRequest, "validation_failed");

        using var first = await SendAsync(HttpMethod.Post, "/api/archive/tournaments", new { name = "Avec clef", tournamentDate = Iso(Today) }, "Organizer", key: "k1");
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        using var replay = await SendAsync(HttpMethod.Post, "/api/archive/tournaments", new { name = "Avec clef", tournamentDate = Iso(Today) }, "Organizer", key: "k1");
        Assert.Equal(HttpStatusCode.Created, replay.StatusCode);
        var firstId = (await Body(first)).GetProperty("id").GetString();
        Assert.Equal(firstId, (await Body(replay)).GetProperty("id").GetString());

        using var conflicting = await SendAsync(HttpMethod.Post, "/api/archive/tournaments", new { name = "Autre corps", tournamentDate = Iso(Today) }, "Organizer", key: "k1");
        await AssertProblem(conflicting, HttpStatusCode.Conflict, "idempotency_conflict");

        await using var database = CreateContext();
        Assert.Equal(1, await database.ArchiveTournaments.CountAsync(item => item.Name == "Avec clef"));
    }

    [Fact]
    public async Task Tournament_create_accepts_a_standalone_row()
    {
        using var created = await SendAsync(
            HttpMethod.Post,
            "/api/archive/tournaments",
            new { name = "  Standalone  ", tournamentDate = Iso(Today), seasonId = (string?)null },
            "Organizer",
            key: "standalone");

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await Body(created);
        var id = body.GetProperty("id").GetString()!;
        Assert.Equal($"/api/archive/tournaments/{id}", created.Headers.Location!.ToString());
        Assert.Equal(StrongETag.Encode(1), created.Headers.ETag!.Tag);
        Assert.Equal(created.Headers.ETag!.Tag, body.GetProperty("eTag").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("seasonId").ValueKind);
        Assert.Equal("Standalone", body.GetProperty("name").GetString());
        Assert.Equal("active", body.GetProperty("status").GetString());
        Assert.Equal(1, body.GetProperty("documentVersion").GetInt32());

        await using var database = CreateContext();
        var stored = await TournamentAsync(database, id);
        Assert.Null(stored.SeasonId);
        Assert.Equal(Today, stored.TournamentDate);
    }

    [Fact]
    public async Task Tournament_create_rejects_an_unknown_season()
    {
        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/archive/tournaments",
            new { name = "Orpheline", tournamentDate = Iso(Today), seasonId = "missing-season" },
            "Organizer",
            key: "orphan");

        await AssertProblem(response, HttpStatusCode.NotFound, "not_found");
        await using var database = CreateContext();
        Assert.Equal(1, await database.ArchiveTournaments.CountAsync());
    }

    [Fact]
    public async Task Tournament_create_stamps_the_owning_Season_counters()
    {
        var first = Today.PlusDays(-60);
        var last = Today.PlusDays(-10);
        using var early = await SendAsync(HttpMethod.Post, "/api/archive/tournaments", new { name = "Manche 1", tournamentDate = Iso(first), seasonId = "season-2" }, "Organizer", key: "counters-1");
        Assert.Equal(HttpStatusCode.Created, early.StatusCode);
        using var late = await SendAsync(HttpMethod.Post, "/api/archive/tournaments", new { name = "Manche 2", tournamentDate = Iso(last), seasonId = "season-2" }, "Organizer", key: "counters-2");
        Assert.Equal(HttpStatusCode.Created, late.StatusCode);

        await using var database = CreateContext();
        var season = await SeasonAsync(database, "season-2");
        Assert.Equal(2, season.TournamentCount);
        Assert.Equal(first, season.FirstTournamentDate);
        Assert.Equal(last, season.LastTournamentDate);
        Assert.Equal(ArchiveCatalogCounts.Version, season.CountsVersion);
        // Concurrency is per row: filling a Season never invalidates a client's copy of the Season.
        Assert.Equal(1, season.Version);
    }

    [Fact]
    public async Task Tournament_metadata_edit_and_delete_bump_only_the_Tournament_version()
    {
        var before = await SeasonAsync("season-1");

        using var edited = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/tournament-1", new { name = "Tournoi renommé", tournamentDate = Iso(Today.PlusDays(-1)), status = "completed" }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        var editedBody = await Body(edited);
        Assert.Equal(2, editedBody.GetProperty("documentVersion").GetInt32());
        Assert.Equal("Tournoi renommé", editedBody.GetProperty("name").GetString());
        Assert.Equal("completed", editedBody.GetProperty("status").GetString());
        Assert.Equal(StrongETag.Encode(2), edited.Headers.ETag!.Tag);

        using var deleted = await SendAsync(HttpMethod.Delete, "/api/archive/tournaments/tournament-1", new { }, "Organizer", ifMatch: StrongETag.Encode(2));
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        var deletedBody = await Body(deleted);
        Assert.True(deletedBody.GetProperty("deleted").GetBoolean());
        Assert.Equal(3, deletedBody.GetProperty("documentVersion").GetInt32());

        await using var database = CreateContext();
        var stored = await TournamentAsync(database, "tournament-1");
        Assert.Equal(3, stored.Version);
        Assert.NotNull(stored.DeletedAt);
        var after = await SeasonAsync(database, "season-1");
        Assert.Equal(before.Version, after.Version);
        Assert.Equal(before.UpdatedAt, after.UpdatedAt);
        // The delete is what emptied the Season, so its derived counters must have followed.
        Assert.Equal(0, after.TournamentCount);
        Assert.Null(after.FirstTournamentDate);
        Assert.Null(after.LastTournamentDate);
    }

    [Fact]
    public async Task Tournament_writes_refuse_a_stale_If_Match_with_412()
    {
        using var stale = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/tournament-1", new { name = "Stale", tournamentDate = Iso(Today) }, "Organizer", ifMatch: StrongETag.Encode(99));
        await AssertProblem(stale, HttpStatusCode.PreconditionFailed, "stale_version");

        using var missing = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/tournament-1", new { name = "Missing", tournamentDate = Iso(Today) }, "Organizer");
        await AssertProblem(missing, HttpStatusCode.PreconditionFailed, "stale_version");

        await using var database = CreateContext();
        var stored = await TournamentAsync(database, "tournament-1");
        Assert.Equal(1, stored.Version);
        Assert.Equal("Tournoi 1", stored.Name);
    }

    [Fact]
    public async Task Tournament_season_move_attaches_detaches_and_recomputes_both_Seasons()
    {
        using var moved = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/tournament-1/season", new { seasonId = "season-2" }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        var movedBody = await Body(moved);
        Assert.Equal("season-2", movedBody.GetProperty("seasonId").GetString());
        Assert.Equal(2, movedBody.GetProperty("documentVersion").GetInt32());

        await using (var database = CreateContext())
        {
            Assert.Equal("season-2", (await TournamentAsync(database, "tournament-1")).SeasonId);
            var source = await SeasonAsync(database, "season-1");
            var destination = await SeasonAsync(database, "season-2");
            Assert.Equal(0, source.TournamentCount);
            Assert.Null(source.FirstTournamentDate);
            Assert.Equal(1, destination.TournamentCount);
            Assert.Equal(Today, destination.FirstTournamentDate);
            Assert.Equal(2, destination.PlayerCount);
            Assert.Equal(1, source.Version);
            Assert.Equal(1, destination.Version);
        }

        using var detached = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/tournament-1/season", new { seasonId = (string?)null }, "Organizer", ifMatch: StrongETag.Encode(2));
        Assert.Equal(HttpStatusCode.OK, detached.StatusCode);
        Assert.Equal(JsonValueKind.Null, (await Body(detached)).GetProperty("seasonId").ValueKind);

        await using (var database = CreateContext())
        {
            var stored = await TournamentAsync(database, "tournament-1");
            Assert.Null(stored.SeasonId);
            Assert.Null(stored.ReadDocument().SeasonId);
            Assert.Equal(3, stored.Version);
            var emptied = await SeasonAsync(database, "season-2");
            Assert.Equal(0, emptied.TournamentCount);
            Assert.Equal(1, emptied.Version);
        }

        using var nowhere = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/tournament-1/season", new { seasonId = "missing-season" }, "Organizer", ifMatch: StrongETag.Encode(3));
        await AssertProblem(nowhere, HttpStatusCode.NotFound, "not_found");
    }

    [Fact]
    public async Task Round_add_import_replace_delete_commands_match_current_source_semantics()
    {
        using var added = await SendAsync(HttpMethod.Post, "/api/archive/tournaments/tournament-1/rounds", new { }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, added.StatusCode);
        var rounds = (await Body(added)).GetProperty("rounds");
        Assert.Equal(2, rounds.GetArrayLength());
        var roundId = rounds[1].GetProperty("id").GetString()!;
        Assert.True(Guid.TryParseExact(roundId, "D", out _), roundId);

        const string csv = "Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist\n2, Carol ,Won 2-0,Dan, Aggro ,Control";
        using var imported = await SendAsync(HttpMethod.Post, $"/api/archive/tournaments/tournament-1/rounds/{roundId}/import", new { text = csv }, "Organizer", ifMatch: StrongETag.Encode(2));
        Assert.Equal(HttpStatusCode.OK, imported.StatusCode);
        var importedBody = await Body(imported);
        var importedEntry = importedBody.GetProperty("rounds")[1].GetProperty("entries")[0];
        Assert.Equal("match", importedEntry.GetProperty("kind").GetString());
        Assert.Equal("Carol", importedEntry.GetProperty("player1Name").GetString());
        Assert.Equal("Dan", importedEntry.GetProperty("player2Name").GetString());
        Assert.Equal(2, importedEntry.GetProperty("player1Score").GetInt32());
        Assert.Contains(
            importedBody.GetProperty("playerArchetypes").EnumerateArray(),
            item => item.GetProperty("playerName").GetString() == "Carol" && item.GetProperty("archetype").GetString() == "Aggro");

        using var replaced = await SendAsync(
            HttpMethod.Post,
            $"/api/archive/tournaments/tournament-1/rounds/{roundId}/replace",
            new { entries = new[] { new { kind = "bye", id = "bye-1", table = "1", playerName = "Erin", deckArchetype = "Ramp" } } },
            "Organizer",
            ifMatch: StrongETag.Encode(3));
        Assert.Equal(HttpStatusCode.OK, replaced.StatusCode);
        var replacedEntry = (await Body(replaced)).GetProperty("rounds")[1].GetProperty("entries")[0];
        Assert.Equal("bye", replacedEntry.GetProperty("kind").GetString());
        Assert.Equal("Erin", replacedEntry.GetProperty("playerName").GetString());

        using var removed = await SendAsync(HttpMethod.Delete, $"/api/archive/tournaments/tournament-1/rounds/{roundId}", new { }, "Organizer", ifMatch: StrongETag.Encode(4));
        Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
        var remaining = (await Body(removed)).GetProperty("rounds");
        Assert.Equal(1, remaining.GetArrayLength());
        Assert.Equal("round-1", remaining[0].GetProperty("id").GetString());
    }

    [Fact]
    public async Task Entry_add_edit_delete_and_archetype_update_are_intent_scoped()
    {
        using var added = await SendAsync(
            HttpMethod.Post,
            "/api/archive/tournaments/tournament-1/rounds/round-1/entries",
            new { kind = "bye", id = "ignored-client-id", table = "3", playerName = "Carol", deckArchetype = "Aggro" },
            "Organizer",
            ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, added.StatusCode);
        var entries = (await Body(added)).GetProperty("rounds")[0].GetProperty("entries");
        var entryId = entries[1].GetProperty("id").GetString()!;
        Assert.NotEqual("ignored-client-id", entryId);
        Assert.True(Guid.TryParseExact(entryId, "D", out _), entryId);

        using var patched = await SendAsync(
            HttpMethod.Patch,
            $"/api/archive/tournaments/tournament-1/rounds/round-1/entries/{entryId}",
            new { kind = "bye", id = "another-ignored-id", table = "4", playerName = "Carole", deckArchetype = "Control" },
            "Organizer",
            ifMatch: StrongETag.Encode(2));
        Assert.Equal(HttpStatusCode.OK, patched.StatusCode);
        var patchedEntry = (await Body(patched)).GetProperty("rounds")[0].GetProperty("entries")[1];
        Assert.Equal(entryId, patchedEntry.GetProperty("id").GetString());
        Assert.Equal("Carole", patchedEntry.GetProperty("playerName").GetString());

        using var archetype = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/tournament-1/archetypes/Carole", new { archetype = "Midrange" }, "Organizer", ifMatch: StrongETag.Encode(3));
        Assert.Equal(HttpStatusCode.OK, archetype.StatusCode);
        Assert.Contains(
            (await Body(archetype)).GetProperty("playerArchetypes").EnumerateArray(),
            item => item.GetProperty("playerName").GetString() == "Carole" && item.GetProperty("archetype").GetString() == "Midrange");

        using var removed = await SendAsync(HttpMethod.Delete, $"/api/archive/tournaments/tournament-1/rounds/round-1/entries/{entryId}", new { }, "Organizer", ifMatch: StrongETag.Encode(4));
        Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
        Assert.Equal(1, (await Body(removed)).GetProperty("rounds")[0].GetProperty("entries").GetArrayLength());
    }

    [Fact]
    public async Task Tournament_player_rename_is_scoped_to_one_Tournament()
    {
        var second = await CreateTournamentWithAliceAsync();

        using var renamed = await SendAsync(HttpMethod.Post, "/api/archive/tournaments/tournament-1/players/rename", new { fromName = "Alice", toName = "Alicia" }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        var entry = (await Body(renamed)).GetProperty("rounds")[0].GetProperty("entries")[0];
        Assert.Equal("Alicia", entry.GetProperty("player1Name").GetString());

        await using var database = CreateContext();
        var other = (await TournamentAsync(database, second)).ReadDocument();
        Assert.Equal("Alice", Assert.IsType<MatchRoundEntry>(other.Rounds.Single().Entries.Single()).Player1Name);
    }

    [Fact]
    public async Task Tournament_edit_batch_applies_every_intent_with_one_version_bump()
    {
        using var extraRound = await SendAsync(HttpMethod.Post, "/api/archive/tournaments/tournament-1/rounds", new { }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, extraRound.StatusCode);
        var keptRoundId = (await Body(extraRound)).GetProperty("rounds")[1].GetProperty("id").GetString()!;
        var addedRoundId = Guid.NewGuid().ToString("D");

        using var applied = await SendAsync(
            HttpMethod.Post,
            "/api/archive/tournaments/tournament-1/edit-batch",
            new
            {
                editTournament = new { name = "Batch", tournamentDate = Iso(Today.PlusDays(-2)), status = "completed" },
                addRounds = new[] { new { roundId = addedRoundId, entries = new[] { new { kind = "bye", id = "b1", table = "1", playerName = "Dan", deckArchetype = "Control" } } } },
                deleteRoundIds = new[] { "round-1" },
                replaceRounds = new[] { new { roundId = keptRoundId, entries = new[] { new { kind = "bye", id = "b2", table = "1", playerName = "Erin", deckArchetype = "Ramp" } } } },
                updateArchetypes = new[] { new { playerName = "Dan", archetype = "Midrange" } }
            },
            "Organizer",
            ifMatch: StrongETag.Encode(2));

        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);
        var tournament = (await Body(applied)).GetProperty("tournament");
        Assert.Equal(3, tournament.GetProperty("documentVersion").GetInt32());
        Assert.Equal(StrongETag.Encode(3), applied.Headers.ETag!.Tag);
        Assert.Equal(applied.Headers.ETag!.Tag, tournament.GetProperty("eTag").GetString());
        Assert.Equal("Batch", tournament.GetProperty("name").GetString());
        Assert.Equal("completed", tournament.GetProperty("status").GetString());
        Assert.Equal(Iso(Today.PlusDays(-2)), tournament.GetProperty("tournamentDate").GetString());
        Assert.Equal([keptRoundId, addedRoundId], tournament.GetProperty("rounds").EnumerateArray().Select(round => round.GetProperty("id").GetString()));
        Assert.Contains(
            tournament.GetProperty("playerArchetypes").EnumerateArray(),
            item => item.GetProperty("playerName").GetString() == "Dan" && item.GetProperty("archetype").GetString() == "Midrange");
    }

    [Fact]
    public async Task Tournament_edit_batch_refuses_an_empty_batch()
    {
        using var response = await SendAsync(HttpMethod.Post, "/api/archive/tournaments/tournament-1/edit-batch", EmptyBatch(), "Organizer", ifMatch: StrongETag.Encode(1));

        await AssertProblem(response, HttpStatusCode.BadRequest, "validation_failed");
        await using var database = CreateContext();
        Assert.Equal(1, (await TournamentAsync(database, "tournament-1")).Version);
    }

    [Fact]
    public async Task Tournament_edit_batch_rolls_back_completely_on_an_invalid_intent()
    {
        string before;
        await using (var database = CreateContext()) before = (await TournamentAsync(database, "tournament-1")).Document;

        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/archive/tournaments/tournament-1/edit-batch",
            new
            {
                deleteRoundIds = new[] { "round-1" },
                replaceRounds = new[] { new { roundId = "round-1", entries = Array.Empty<object>() } },
                addRounds = Array.Empty<object>(),
                updateArchetypes = Array.Empty<object>()
            },
            "Organizer",
            ifMatch: StrongETag.Encode(1));

        await AssertProblem(response, HttpStatusCode.BadRequest, "validation_failed");
        await using var after = CreateContext();
        var stored = await TournamentAsync(after, "tournament-1");
        Assert.Equal(1, stored.Version);
        Assert.Equal(before, stored.Document);
    }

    [Fact]
    public async Task Tournament_edit_batch_moves_to_a_Season_and_recomputes_both_Seasons()
    {
        using var applied = await SendAsync(
            HttpMethod.Post,
            "/api/archive/tournaments/tournament-1/edit-batch",
            new
            {
                moveToSeason = new { seasonId = "season-2" },
                editTournament = new { name = "Déplacé", tournamentDate = Iso(Today) },
                addRounds = Array.Empty<object>(),
                deleteRoundIds = Array.Empty<string>(),
                replaceRounds = Array.Empty<object>(),
                updateArchetypes = Array.Empty<object>()
            },
            "Organizer",
            ifMatch: StrongETag.Encode(1));

        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);
        var tournament = (await Body(applied)).GetProperty("tournament");
        // ADR 0037: one staged batch, one bump — even when it both edits and moves.
        Assert.Equal(2, tournament.GetProperty("documentVersion").GetInt32());
        Assert.Equal("season-2", tournament.GetProperty("seasonId").GetString());
        Assert.Equal("Déplacé", tournament.GetProperty("name").GetString());

        await using var database = CreateContext();
        Assert.Equal("season-2", (await TournamentAsync(database, "tournament-1")).SeasonId);
        var source = await SeasonAsync(database, "season-1");
        var destination = await SeasonAsync(database, "season-2");
        Assert.Equal(0, source.TournamentCount);
        Assert.Equal(0, source.PlayerCount);
        Assert.Null(source.FirstTournamentDate);
        Assert.Equal(1, destination.TournamentCount);
        Assert.Equal(2, destination.PlayerCount);
        Assert.Equal(Today, destination.FirstTournamentDate);
        Assert.Equal(1, source.Version);
        Assert.Equal(1, destination.Version);
    }

    [Fact]
    public async Task Tournament_edit_batch_detaches_to_standalone()
    {
        using var applied = await SendAsync(
            HttpMethod.Post,
            "/api/archive/tournaments/tournament-1/edit-batch",
            new
            {
                moveToSeason = new { seasonId = (string?)null },
                addRounds = Array.Empty<object>(),
                deleteRoundIds = Array.Empty<string>(),
                replaceRounds = Array.Empty<object>(),
                updateArchetypes = Array.Empty<object>()
            },
            "Organizer",
            ifMatch: StrongETag.Encode(1));

        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);
        Assert.Equal(JsonValueKind.Null, (await Body(applied)).GetProperty("tournament").GetProperty("seasonId").ValueKind);

        await using var database = CreateContext();
        var stored = await TournamentAsync(database, "tournament-1");
        Assert.Null(stored.SeasonId);
        Assert.Null(stored.ReadDocument().SeasonId);
        var source = await SeasonAsync(database, "season-1");
        Assert.Equal(0, source.TournamentCount);
        Assert.Null(source.FirstTournamentDate);
        Assert.Null(source.LastTournamentDate);
    }

    [Fact]
    public async Task Round_replace_refuses_a_missing_entries_array()
    {
        using var response = await SendAsync(HttpMethod.Post, "/api/archive/tournaments/tournament-1/rounds/round-1/replace", new { }, "Organizer", ifMatch: StrongETag.Encode(1));

        await AssertProblem(response, HttpStatusCode.BadRequest, "validation_failed");
        await using var database = CreateContext();
        Assert.Equal(1, (await TournamentAsync(database, "tournament-1")).Version);
    }

    [Fact]
    public async Task Unknown_tournament_round_or_entry_returns_404()
    {
        var ifMatch = StrongETag.Encode(1);
        using var unknownTournament = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/missing", new { name = "Ghost", tournamentDate = Iso(Today) }, "Organizer", ifMatch: ifMatch);
        await AssertProblem(unknownTournament, HttpStatusCode.NotFound, "not_found");

        using var unknownRound = await SendAsync(HttpMethod.Delete, "/api/archive/tournaments/tournament-1/rounds/missing", new { }, "Organizer", ifMatch: ifMatch);
        await AssertProblem(unknownRound, HttpStatusCode.NotFound, "not_found");

        using var unknownEntry = await SendAsync(HttpMethod.Delete, "/api/archive/tournaments/tournament-1/rounds/round-1/entries/missing", new { }, "Organizer", ifMatch: ifMatch);
        await AssertProblem(unknownEntry, HttpStatusCode.NotFound, "not_found");
    }

    [Fact]
    public async Task Tournament_write_rebuilds_player_statistics_in_every_scope_it_touches()
    {
        // The seeded Tournament is active, so the startup rebuild found nothing to count.
        Assert.Empty(await StatisticsAsync());

        await CompleteTournamentOneAsync();

        var rows = await StatisticsAsync();
        Assert.Equal([("global", ""), ("league", "league-1"), ("season", "season-1")], Scopes(rows));
        foreach (var (scopeKind, scopeId) in Scopes(rows))
        {
            Assert.Equal(["Alice", "Bob"], Names(rows, scopeKind, scopeId));
            Assert.Equal(1, Row(rows, scopeKind, scopeId, "Alice").MatchWins);
            Assert.Equal(0, Row(rows, scopeKind, scopeId, "Bob").MatchWins);
        }
    }

    [Fact]
    public async Task Tournament_entry_edit_rewrites_the_scoped_rows_without_a_restart()
    {
        await CompleteTournamentOneAsync();
        Assert.Equal(1, Row(await StatisticsAsync(), "season", "season-1", "Alice").MatchWins);

        using var edited = await SendAsync(
            HttpMethod.Patch,
            "/api/archive/tournaments/tournament-1/rounds/round-1/entries/entry-1",
            new { kind = "match", id = "entry-1", table = "1", player1Name = "Alice", player2Name = "Bob", player1Score = 0, player2Score = 2, player1DeckArchetype = "Tempo", player2DeckArchetype = "Control" },
            "Organizer",
            ifMatch: StrongETag.Encode(2));
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);

        var rows = await StatisticsAsync();
        foreach (var (scopeKind, scopeId) in Scopes(rows))
        {
            Assert.Equal(0, Row(rows, scopeKind, scopeId, "Alice").MatchWins);
            Assert.Equal(1, Row(rows, scopeKind, scopeId, "Bob").MatchWins);
        }
    }

    [Fact]
    public async Task Tournament_delete_empties_every_scope_it_was_counted_in()
    {
        await CompleteTournamentOneAsync();
        Assert.NotEmpty(await StatisticsAsync());

        using var deleted = await SendAsync(HttpMethod.Delete, "/api/archive/tournaments/tournament-1", new { }, "Organizer", ifMatch: StrongETag.Encode(2));
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);

        Assert.Empty(await StatisticsAsync());
    }

    [Fact]
    public async Task Tournament_season_move_re_keys_the_scoped_rows()
    {
        await CompleteTournamentOneAsync();
        Assert.Equal([("global", ""), ("league", "league-1"), ("season", "season-1")], Scopes(await StatisticsAsync()));

        using var moved = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/tournament-1/season", new { seasonId = "season-2" }, "Organizer", ifMatch: StrongETag.Encode(2));
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);

        // Both Seasons hang off the same League, so only the Season scope moves.
        Assert.Equal([("global", ""), ("league", "league-1"), ("season", "season-2")], Scopes(await StatisticsAsync()));
    }

    [Fact]
    public async Task A_created_Tournament_reaches_the_read_model_as_soon_as_it_carries_a_completed_result()
    {
        using var created = await SendAsync(HttpMethod.Post, "/api/archive/tournaments", new { name = "Nouvelle manche", tournamentDate = Iso(Today), seasonId = "season-2" }, "Organizer", key: "statistics-create");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await Body(created)).GetProperty("id").GetString()!;
        // A create mints an empty Tournament: no Round, no Match, so no player's rating can have moved.
        Assert.Empty(await StatisticsAsync());

        using var round = await SendAsync(HttpMethod.Post, $"/api/archive/tournaments/{id}/rounds", new { }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, round.StatusCode);
        var roundId = (await Body(round)).GetProperty("rounds")[0].GetProperty("id").GetString()!;

        const string csv = "Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist\n1,Carol,Won 2-0,Dan,Aggro,Control";
        using var imported = await SendAsync(HttpMethod.Post, $"/api/archive/tournaments/{id}/rounds/{roundId}/import", new { text = csv }, "Organizer", ifMatch: StrongETag.Encode(2));
        Assert.Equal(HttpStatusCode.OK, imported.StatusCode);
        // ADR 0040 counts a Tournament, not a League: an active one contributes nothing yet.
        Assert.Empty(await StatisticsAsync());

        using var completed = await SendAsync(HttpMethod.Patch, $"/api/archive/tournaments/{id}", new { name = "Nouvelle manche", tournamentDate = Iso(Today), status = "completed" }, "Organizer", ifMatch: StrongETag.Encode(3));
        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);

        var rows = await StatisticsAsync();
        Assert.Equal([("global", ""), ("league", "league-1"), ("season", "season-2")], Scopes(rows));
        Assert.Equal(["Carol", "Dan"], Names(rows, "season", "season-2"));
    }

    [Fact]
    public async Task Tournament_commands_audit_the_actor_without_leaking_names()
    {
        using var edited = await SendAsync(HttpMethod.Patch, "/api/archive/tournaments/tournament-1", new { name = "Nom Secret", tournamentDate = Iso(Today) }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        using var renamed = await SendAsync(HttpMethod.Post, "/api/archive/tournaments/tournament-1/players/rename", new { fromName = "Alice", toName = "Joueuse Secrète" }, "Organizer", ifMatch: StrongETag.Encode(2));
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);

        await using var database = CreateContext();
        var audits = await database.AuditRecords.AsNoTracking().Where(item => item.EntityType == "archiveTournament").ToListAsync();
        Assert.Contains(audits, audit => audit.Action == "archive.tournament.edited");
        Assert.Contains(audits, audit => audit.Action == "archive.tournament.player_name.renamed");
        Assert.All(audits, audit =>
        {
            Assert.Equal(Actor, audit.ActorId);
            Assert.Equal("tournament-1", audit.EntityId);
            Assert.DoesNotContain("Nom Secret", audit.RedactedDiff, StringComparison.Ordinal);
            Assert.DoesNotContain("Joueuse Secrète", audit.RedactedDiff, StringComparison.Ordinal);
        });
    }

    /// <summary>Flips the seeded Tournament to <c>completed</c>, which is what makes its Match countable.</summary>
    private async Task CompleteTournamentOneAsync()
    {
        using var completed = await SendAsync(
            HttpMethod.Patch,
            "/api/archive/tournaments/tournament-1",
            new { name = "Tournoi 1", tournamentDate = Iso(Today), status = "completed" },
            "Organizer",
            ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
    }

    /// <summary>Every materialized row, sorted ordinally so the scope tuples compare deterministically.</summary>
    private async Task<IReadOnlyList<PlayerStatisticsRow>> StatisticsAsync()
    {
        await using var database = CreateContext();
        var rows = await database.PlayerStatistics.AsNoTracking().ToListAsync();
        return [.. rows
            .OrderBy(row => row.ScopeKind, StringComparer.Ordinal)
            .ThenBy(row => row.ScopeId, StringComparer.Ordinal)
            .ThenBy(row => row.PlayerName, StringComparer.Ordinal)];
    }

    private static (string ScopeKind, string ScopeId)[] Scopes(IReadOnlyList<PlayerStatisticsRow> rows) =>
        [.. rows.Select(row => (row.ScopeKind, row.ScopeId)).Distinct()];

    private static string[] Names(IReadOnlyList<PlayerStatisticsRow> rows, string scopeKind, string scopeId) =>
        [.. rows.Where(row => row.ScopeKind == scopeKind && row.ScopeId == scopeId).Select(row => row.PlayerName)];

    private static PlayerStatisticsRow Row(IReadOnlyList<PlayerStatisticsRow> rows, string scopeKind, string scopeId, string playerName) =>
        rows.Single(row => row.ScopeKind == scopeKind && row.ScopeId == scopeId && row.PlayerName == playerName);

    private async Task<string> CreateTournamentWithAliceAsync()
    {
        using var created = await SendAsync(HttpMethod.Post, "/api/archive/tournaments", new { name = "Second", tournamentDate = Iso(Today), seasonId = "season-1" }, "Organizer", key: "second");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await Body(created)).GetProperty("id").GetString()!;

        using var round = await SendAsync(HttpMethod.Post, $"/api/archive/tournaments/{id}/rounds", new { }, "Organizer", ifMatch: StrongETag.Encode(1));
        Assert.Equal(HttpStatusCode.OK, round.StatusCode);
        var roundId = (await Body(round)).GetProperty("rounds")[0].GetProperty("id").GetString()!;

        using var entry = await SendAsync(
            HttpMethod.Post,
            $"/api/archive/tournaments/{id}/rounds/{roundId}/entries",
            new { kind = "match", id = "seed", table = "1", player1Name = "Alice", player2Name = "Bob", player1Score = 2, player2Score = 0, player1DeckArchetype = "Tempo", player2DeckArchetype = "Control" },
            "Organizer",
            ifMatch: StrongETag.Encode(2));
        Assert.Equal(HttpStatusCode.OK, entry.StatusCode);
        return id;
    }

    private static object EmptyBatch() => new
    {
        addRounds = Array.Empty<object>(),
        deleteRoundIds = Array.Empty<string>(),
        replaceRounds = Array.Empty<object>(),
        updateArchetypes = Array.Empty<object>()
    };

    private static string Iso(LocalDate date) => ArchiveTournamentCommands.FormatDate(date);

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object body, string? role, string? ifMatch = null, string? key = null)
    {
        var request = new HttpRequestMessage(method, path)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
        };
        if (role is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Test-User", Actor.ToString("D"));
            request.Headers.TryAddWithoutValidation("X-Test-Roles", role);
        }
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return await Client.SendAsync(request);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await Body(response)).GetProperty("code").GetString());
    }

    private static async Task<ArchiveTournament> TournamentAsync(GonesDbContext database, string documentId) =>
        await database.ArchiveTournaments.AsNoTracking().SingleAsync(item => item.DocumentId == documentId);

    private static async Task<ArchiveLeagueSeason> SeasonAsync(GonesDbContext database, string documentId) =>
        await database.ArchiveLeagueSeasons.AsNoTracking().SingleAsync(item => item.DocumentId == documentId);

    private async Task<ArchiveLeagueSeason> SeasonAsync(string documentId)
    {
        await using var database = CreateContext();
        return await SeasonAsync(database, documentId);
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);
}
