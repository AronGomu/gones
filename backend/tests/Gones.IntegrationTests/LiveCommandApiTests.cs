using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Application.Concurrency;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;

namespace Gones.IntegrationTests;

public sealed class LiveCommandApiTests : IAsyncLifetime
{
    private static readonly Guid Actor = Guid.Parse("34000000-0000-0000-0000-000000000001");
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
                UserName = "live-command-actor",
                NormalizedUserName = "LIVE-COMMAND-ACTOR",
                Email = "live-command-actor@example.test",
                NormalizedEmail = "LIVE-COMMAND-ACTOR@EXAMPLE.TEST",
                SecurityStamp = Guid.NewGuid().ToString("N"),
                ConcurrencyStamp = Guid.NewGuid().ToString("N")
            });
            database.LeagueArchiveAggregates.Add(Gones.Domain.Leagues.LeagueArchiveAggregate.Create(
                new Gones.Domain.Leagues.LeagueDocument("target-league", "Target League", "active", []),
                NodaTime.Instant.FromUtc(2030, 1, 1, 12, 0)));
            await database.SaveChangesAsync();
        }
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c34-live-command-signing-key-value-long!");
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
    public async Task Live_create_enforces_roles_idempotency_key_and_returns_versioned_document()
    {
        using var anonymous = await SendJsonAsync(HttpMethod.Post, "/api/live-tournaments", new { name = "Anon" }, role: null, key: "anon");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var user = await SendJsonAsync(HttpMethod.Post, "/api/live-tournaments", new { name = "User" }, "User", key: "user");
        Assert.Equal(HttpStatusCode.Forbidden, user.StatusCode);
        using var missingKey = await SendJsonAsync(HttpMethod.Post, "/api/live-tournaments", new { name = "No Key" }, "Organizer");
        await AssertProblem(missingKey, HttpStatusCode.BadRequest, "validation_failed");

        using var created = await SendJsonAsync(HttpMethod.Post, "/api/live-tournaments", new { name = "  Friday Night  " }, "Organizer", key: "create-live");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.NotNull(created.Headers.ETag);
        var body = await Body(created);
        var document = body.GetProperty("document");
        Assert.Equal("Friday Night", document.GetProperty("name").GetString());
        Assert.Equal("registration", document.GetProperty("stage").GetString());
        Assert.Equal("swiss", document.GetProperty("type").GetString());
        Assert.Equal(3, document.GetProperty("roundCount").GetInt32());
        Assert.True(document.GetProperty("paidTrackingEnabled").GetBoolean());
        Assert.Equal(1, document.GetProperty("documentVersion").GetInt32());
        Assert.Equal(1, body.GetProperty("documentVersion").GetInt64());
        Assert.Equal(StrongETag.Encode(1), body.GetProperty("eTag").GetString());

        using var replay = await SendJsonAsync(HttpMethod.Post, "/api/live-tournaments", new { name = "  Friday Night  " }, "Organizer", key: "create-live");
        Assert.Equal(HttpStatusCode.Created, replay.StatusCode);
        Assert.Equal(document.GetProperty("id").GetString(), (await Body(replay)).GetProperty("document").GetProperty("id").GetString());
        using var conflict = await SendJsonAsync(HttpMethod.Post, "/api/live-tournaments", new { name = "Other" }, "Organizer", key: "create-live");
        await AssertProblem(conflict, HttpStatusCode.Conflict, "idempotency_conflict");

        using var badLeague = await SendJsonAsync(HttpMethod.Post, "/api/live-tournaments", new { name = "Bad", leagueId = "missing-league" }, "Organizer", key: "create-bad-league");
        await AssertProblem(badLeague, HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task Live_settings_and_player_add_edit_paid_drop_remove_follow_source_semantics()
    {
        var (id, etag) = await CreateLiveAsync("settings-live");

        using var settings = await SendJsonAsync(HttpMethod.Patch, $"/api/live-tournaments/{id}/settings", new { name = "Renamed Live", tournamentDate = "2030-06-01", leagueId = "target-league", paidTrackingEnabled = false }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, settings.StatusCode);
        var settingsBody = await Body(settings);
        Assert.Equal("Renamed Live", settingsBody.GetProperty("document").GetProperty("name").GetString());
        Assert.Equal("target-league", settingsBody.GetProperty("document").GetProperty("leagueId").GetString());
        Assert.False(settingsBody.GetProperty("document").GetProperty("paidTrackingEnabled").GetBoolean());
        Assert.Equal(2, settingsBody.GetProperty("documentVersion").GetInt64());
        etag = settings.Headers.ETag!.Tag;

        // Auto Swiss round count mirrors the client: 1 active player -> 0 rounds, 2 -> 1, 3 -> 3.
        etag = (await AddPlayerAsync(id, "Alice", etag)).ETag;
        using var oneActive = await SendJsonAsync(HttpMethod.Get, $"/api/live-tournaments/{id}/document", new { }, "Organizer");
        Assert.Equal(0, (await Body(oneActive)).GetProperty("document").GetProperty("roundCount").GetInt32());
        etag = (await AddPlayerAsync(id, "Bob", etag)).ETag;
        var (thirdBody, thirdETag) = await AddPlayerAsync(id, "Carol", etag);
        etag = thirdETag;
        Assert.Equal(3, thirdBody.GetProperty("document").GetProperty("roundCount").GetInt32());
        // Registration adds prepend the newest player, mirroring the client flow.
        Assert.Equal("Carol", thirdBody.GetProperty("document").GetProperty("players")[0].GetProperty("name").GetString());

        using var duplicate = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/players", new { name = " alice " }, "Organizer", ifMatch: etag);
        await AssertProblem(duplicate, HttpStatusCode.BadRequest, "validation_failed");

        var carolId = thirdBody.GetProperty("document").GetProperty("players")[0].GetProperty("id").GetString()!;
        using var renamed = await SendJsonAsync(HttpMethod.Patch, $"/api/live-tournaments/{id}/players/{carolId}", new { name = "Caroline", initialWins = 2 }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        var renamedPlayer = (await Body(renamed)).GetProperty("document").GetProperty("players")[0];
        Assert.Equal("Caroline", renamedPlayer.GetProperty("name").GetString());
        Assert.Equal(2, renamedPlayer.GetProperty("initialWins").GetInt32());
        etag = renamed.Headers.ETag!.Tag;

        using var duplicateRename = await SendJsonAsync(HttpMethod.Patch, $"/api/live-tournaments/{id}/players/{carolId}", new { name = "ALICE" }, "Organizer", ifMatch: etag);
        await AssertProblem(duplicateRename, HttpStatusCode.BadRequest, "validation_failed");

        using var paid = await SendJsonAsync(HttpMethod.Patch, $"/api/live-tournaments/{id}/players/{carolId}/paid", new { paid = true }, "Organizer", ifMatch: etag);
        Assert.True((await Body(paid)).GetProperty("document").GetProperty("players")[0].GetProperty("paid").GetBoolean());
        etag = paid.Headers.ETag!.Tag;

        // Drop is a standings-stage intent; registration removal deletes the row instead.
        using var dropBlocked = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/players/{carolId}/drop", new { }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.Conflict, dropBlocked.StatusCode);
        using var removed = await SendJsonAsync(HttpMethod.Delete, $"/api/live-tournaments/{id}/players/{carolId}", new { }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
        var removedBody = await Body(removed);
        Assert.DoesNotContain(removedBody.GetProperty("document").GetProperty("players").EnumerateArray(), player => player.GetProperty("id").GetString() == carolId);
        Assert.Equal(1, removedBody.GetProperty("document").GetProperty("roundCount").GetInt32());
        using var missingPlayer = await SendJsonAsync(HttpMethod.Patch, $"/api/live-tournaments/{id}/players/{carolId}", new { name = "Ghost" }, "Organizer", ifMatch: removed.Headers.ETag!.Tag);
        Assert.Equal(HttpStatusCode.NotFound, missingPlayer.StatusCode);
    }

    [Fact]
    public async Task Live_round_start_score_validate_cancel_checkpoint_restore_and_standings_run_exact_rules()
    {
        var (id, etag) = await CreateLiveAsync("round-live", "Alice", "Bob", "Carol", "Dana");

        using var started = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/start", new { }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        var startedDocument = (await Body(started)).GetProperty("document");
        Assert.Equal("round", startedDocument.GetProperty("stage").GetString());
        Assert.Equal(1, startedDocument.GetProperty("currentRoundNumber").GetInt32());
        var round = startedDocument.GetProperty("rounds")[0];
        var roundId = round.GetProperty("id").GetString()!;
        Assert.Equal(2, round.GetProperty("entries").GetArrayLength());
        Assert.All(round.GetProperty("entries").EnumerateArray(), entry => Assert.Equal("match", entry.GetProperty("entry").GetProperty("kind").GetString()));
        Assert.NotEqual(0, startedDocument.GetProperty("pairingSeed").GetInt64());
        etag = started.Headers.ETag!.Tag;

        using var startBlocked = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/start", new { }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.Conflict, startBlocked.StatusCode);

        var firstEntryId = round.GetProperty("entries")[0].GetProperty("entry").GetProperty("id").GetString()!;
        var secondEntryId = round.GetProperty("entries")[1].GetProperty("entry").GetProperty("id").GetString()!;
        using var badScore = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/{roundId}/entries/{firstEntryId}/score", new { player1Score = 3, player2Score = 0 }, "Organizer", ifMatch: etag);
        await AssertProblem(badScore, HttpStatusCode.BadRequest, "validation_failed");
        using var doubleWin = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/{roundId}/entries/{firstEntryId}/score", new { player1Score = 2, player2Score = 2 }, "Organizer", ifMatch: etag);
        await AssertProblem(doubleWin, HttpStatusCode.BadRequest, "validation_failed");
        using var fractional = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/{roundId}/entries/{firstEntryId}/score", new { player1Score = 1.5, player2Score = 0 }, "Organizer", ifMatch: etag);
        await AssertProblem(fractional, HttpStatusCode.BadRequest, "validation_failed");

        using var scoredFirst = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/{roundId}/entries/{firstEntryId}/score", new { player1Score = 2, player2Score = 1 }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, scoredFirst.StatusCode);
        etag = scoredFirst.Headers.ETag!.Tag;
        using var scoredSecond = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/{roundId}/entries/{secondEntryId}/score", new { player1Score = 0, player2Score = 2 }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, scoredSecond.StatusCode);
        etag = scoredSecond.Headers.ETag!.Tag;

        using var validated = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/validate", new { }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, validated.StatusCode);
        var validatedDocument = (await Body(validated)).GetProperty("document");
        Assert.Equal("standings", validatedDocument.GetProperty("stage").GetString());
        Assert.True(validatedDocument.GetProperty("rounds")[0].GetProperty("validated").GetBoolean());
        var checkpoint = validatedDocument.GetProperty("checkpoints").EnumerateArray().Single();
        Assert.Equal("Pairing 1", checkpoint.GetProperty("label").GetString());
        etag = validated.Headers.ETag!.Tag;

        using var standings = await Client.GetAsync($"/api/live-tournaments/{id}/standings");
        Assert.Equal(HttpStatusCode.OK, standings.StatusCode);
        var rows = (await Body(standings)).GetProperty("rows");
        Assert.Equal(4, rows.GetArrayLength());
        Assert.Equal(3, rows[0].GetProperty("points").GetInt32());

        using var next = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/start", new { }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, next.StatusCode);
        var nextDocument = (await Body(next)).GetProperty("document");
        Assert.Equal(2, nextDocument.GetProperty("currentRoundNumber").GetInt32());
        Assert.Equal("round", nextDocument.GetProperty("stage").GetString());
        Assert.Equal(2, nextDocument.GetProperty("checkpoints").GetArrayLength());
        etag = next.Headers.ETag!.Tag;

        using var regenerated = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/regenerate", new { }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, regenerated.StatusCode);
        etag = regenerated.Headers.ETag!.Tag;

        using var cancelled = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/cancel", new { }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        var cancelledDocument = (await Body(cancelled)).GetProperty("document");
        Assert.Equal("standings", cancelledDocument.GetProperty("stage").GetString());
        Assert.Equal(1, cancelledDocument.GetProperty("currentRoundNumber").GetInt32());
        Assert.Single(cancelledDocument.GetProperty("rounds").EnumerateArray());
        etag = cancelled.Headers.ETag!.Tag;

        var checkpointId = checkpoint.GetProperty("id").GetString()!;
        using var restored = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/checkpoints/{checkpointId}/restore", new { }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        var restoredDocument = (await Body(restored)).GetProperty("document");
        Assert.Equal("round", restoredDocument.GetProperty("stage").GetString());
        Assert.Equal(1, restoredDocument.GetProperty("currentRoundNumber").GetInt32());
        etag = restored.Headers.ETag!.Tag;
        using var missingCheckpoint = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/checkpoints/not-a-checkpoint/restore", new { }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.NotFound, missingCheckpoint.StatusCode);
    }

    [Fact]
    public async Task Live_concurrent_same_round_score_writes_serialize_and_stale_retry_uses_latest_etag_metadata()
    {
        var (id, etag) = await CreateLiveAsync("concurrent-live", "Alice", "Bob", "Carol", "Dana");
        using var started = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/start", new { }, "Organizer", ifMatch: etag);
        var startedBody = await Body(started);
        var roundId = startedBody.GetProperty("document").GetProperty("rounds")[0].GetProperty("id").GetString()!;
        var entryIds = startedBody.GetProperty("document").GetProperty("rounds")[0].GetProperty("entries").EnumerateArray()
            .Select(entry => entry.GetProperty("entry").GetProperty("id").GetString()!)
            .ToArray();
        etag = started.Headers.ETag!.Tag;

        var attempts = await Task.WhenAll(Enumerable.Range(0, 6).Select(index =>
            SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/{roundId}/entries/{entryIds[index % 2]}/score", new { player1Score = 2, player2Score = 0 }, "Organizer", ifMatch: etag)));
        try
        {
            Assert.Equal(1, attempts.Count(response => response.StatusCode == HttpStatusCode.OK));
            Assert.Equal(5, attempts.Count(response => response.StatusCode == HttpStatusCode.PreconditionFailed));
            var stale = attempts.First(response => response.StatusCode == HttpStatusCode.PreconditionFailed);
            var staleBody = await Body(stale);
            Assert.Equal("stale_version", staleBody.GetProperty("code").GetString());
            // create(1) + 4 player adds(5) + start(6) + the single winning score(7).
            var currentETag = staleBody.GetProperty("currentETag").GetString();
            Assert.Equal(StrongETag.Encode(7), currentETag);
            Assert.Equal(7, staleBody.GetProperty("currentDocumentVersion").GetInt64());

            using var retried = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/{roundId}/entries/{entryIds[1]}/score", new { player1Score = 1, player2Score = 2 }, "Organizer", ifMatch: currentETag);
            Assert.Equal(HttpStatusCode.OK, retried.StatusCode);
            Assert.Equal(8, (await Body(retried)).GetProperty("documentVersion").GetInt64());
        }
        finally
        {
            foreach (var response in attempts) response.Dispose();
        }

        // One persisted aggregate version per accepted command:
        // create(1) + 4 player adds(5) + start(6) + winning score(7) + retried score(8).
        await using var database = CreateContext();
        var aggregate = await database.LiveAggregates.AsNoTracking().SingleAsync(item => item.DocumentId == id);
        Assert.Equal(8, aggregate.Version);
        Assert.Equal(8, aggregate.ReadDocument().DocumentVersion);
    }

    [Fact]
    public async Task Live_finalize_is_one_transaction_idempotent_and_tombstones_the_live_view()
    {
        var (id, etag) = await CreateLiveAsync("finalize-live", "Alice", "Bob");
        using var league = await SendJsonAsync(HttpMethod.Patch, $"/api/live-tournaments/{id}/settings", new { leagueId = "target-league" }, "Organizer", ifMatch: etag);
        etag = league.Headers.ETag!.Tag;
        using var started = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/start", new { }, "Organizer", ifMatch: etag);
        var startedBody = await Body(started);
        var roundId = startedBody.GetProperty("document").GetProperty("rounds")[0].GetProperty("id").GetString()!;
        var entryId = startedBody.GetProperty("document").GetProperty("rounds")[0].GetProperty("entries")[0].GetProperty("entry").GetProperty("id").GetString()!;
        etag = started.Headers.ETag!.Tag;
        using var scored = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/{roundId}/entries/{entryId}/score", new { player1Score = 2, player2Score = 1 }, "Organizer", ifMatch: etag);
        etag = scored.Headers.ETag!.Tag;
        using var validated = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/validate", new { }, "Organizer", ifMatch: etag);
        etag = validated.Headers.ETag!.Tag;

        using var blockedFinalizeStale = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/finalize", new { }, "Organizer", key: "finalize-stale", ifMatch: StrongETag.Encode(1));
        await AssertProblem(blockedFinalizeStale, HttpStatusCode.PreconditionFailed, "stale_version");
        using var missingKey = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/finalize", new { }, "Organizer", ifMatch: etag);
        await AssertProblem(missingKey, HttpStatusCode.BadRequest, "validation_failed");

        using var finalized = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/finalize", new { }, "Organizer", key: "finalize-live", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, finalized.StatusCode);
        var finalizedBody = await Body(finalized);
        Assert.Equal("completed", finalizedBody.GetProperty("stage").GetString());
        Assert.Equal("target-league", finalizedBody.GetProperty("leagueId").GetString());
        var tournamentId = finalizedBody.GetProperty("finalizedTournamentId").GetString()!;
        Assert.False(string.IsNullOrWhiteSpace(tournamentId));
        Assert.Equal(2, finalizedBody.GetProperty("leagueDocumentVersion").GetInt64());
        Assert.Equal(StrongETag.Encode(2), finalizedBody.GetProperty("leagueETag").GetString());

        using var replay = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/finalize", new { }, "Organizer", key: "finalize-live", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var replayBody = await Body(replay);
        Assert.Equal(tournamentId, replayBody.GetProperty("finalizedTournamentId").GetString());
        Assert.Equal(finalizedBody.GetProperty("liveDocumentVersion").GetInt64(), replayBody.GetProperty("liveDocumentVersion").GetInt64());

        // Tombstoned from the active Live view but the Result Tournament lives in the target League.
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/live-tournaments/{id}")).StatusCode);
        await using (var database = CreateContext())
        {
            var live = await database.LiveAggregates.AsNoTracking().SingleAsync(item => item.DocumentId == id);
            Assert.NotNull(live.DeletedAt);
            Assert.Equal("completed", live.Stage);
            var target = await database.LeagueArchiveAggregates.AsNoTracking().SingleAsync(item => item.DocumentId == "target-league");
            var tournament = target.ReadDocument().Tournaments.Single(item => item.Id == tournamentId);
            Assert.Equal("target-league", tournament.LeagueId);
            Assert.Single(tournament.Rounds);
            Assert.Contains(tournament.PlayerArchetypes, item => item.PlayerName == "Alice");

            var audits = await database.AuditRecords.Where(item => item.EntityType == "live-tournament").ToListAsync();
            Assert.NotEmpty(audits);
            Assert.All(audits, audit =>
            {
                Assert.DoesNotContain("Alice", audit.RedactedDiff, StringComparison.Ordinal);
                Assert.DoesNotContain("Bob", audit.RedactedDiff, StringComparison.Ordinal);
                Assert.DoesNotContain("player1Score", audit.RedactedDiff, StringComparison.Ordinal);
            });
        }

        // A different key can no longer target the tombstoned Live document.
        using var late = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/finalize", new { }, "Organizer", key: "finalize-late", ifMatch: etag);
        Assert.Equal(HttpStatusCode.NotFound, late.StatusCode);
    }

    [Fact]
    public async Task Live_finalize_defaults_to_placeholder_league_and_registration_finalize_conflicts()
    {
        var (id, etag) = await CreateLiveAsync("placeholder-live", "Alice", "Bob");
        using var blocked = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/finalize", new { }, "Organizer", key: "finalize-registration", ifMatch: etag);
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);

        using var started = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/start", new { }, "Organizer", ifMatch: etag);
        var startedBody = await Body(started);
        var roundId = startedBody.GetProperty("document").GetProperty("rounds")[0].GetProperty("id").GetString()!;
        var entryId = startedBody.GetProperty("document").GetProperty("rounds")[0].GetProperty("entries")[0].GetProperty("entry").GetProperty("id").GetString()!;
        using var scored = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/{roundId}/entries/{entryId}/score", new { player1Score = 2, player2Score = 0 }, "Organizer", ifMatch: started.Headers.ETag!.Tag);
        using var validated = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/rounds/validate", new { }, "Organizer", ifMatch: scored.Headers.ETag!.Tag);
        using var finalized = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/finalize", new { }, "Organizer", key: "finalize-placeholder", ifMatch: validated.Headers.ETag!.Tag);
        Assert.Equal(HttpStatusCode.OK, finalized.StatusCode);
        var body = await Body(finalized);
        Assert.Equal("placeholder-league", body.GetProperty("leagueId").GetString());
        await using var database = CreateContext();
        var placeholder = await database.LeagueArchiveAggregates.AsNoTracking().SingleAsync(item => item.DocumentId == "placeholder-league");
        Assert.Contains(placeholder.ReadDocument().Tournaments, item => item.Id == body.GetProperty("finalizedTournamentId").GetString());
    }

    [Fact]
    public async Task Live_delete_requires_if_match_and_hides_document_from_reads()
    {
        var (id, etag) = await CreateLiveAsync("delete-live");
        using var stale = await SendJsonAsync(HttpMethod.Delete, $"/api/live-tournaments/{id}", new { }, "Organizer", ifMatch: StrongETag.Encode(99));
        var staleBody = await Body(stale);
        Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
        Assert.Equal(etag, staleBody.GetProperty("currentETag").GetString());

        using var forbidden = await SendJsonAsync(HttpMethod.Delete, $"/api/live-tournaments/{id}", new { }, "User", ifMatch: etag);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        using var deleted = await SendJsonAsync(HttpMethod.Delete, $"/api/live-tournaments/{id}", new { }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        Assert.True((await Body(deleted)).GetProperty("deleted").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/live-tournaments/{id}")).StatusCode);
        using var repeat = await SendJsonAsync(HttpMethod.Delete, $"/api/live-tournaments/{id}", new { }, "Organizer", ifMatch: deleted.Headers.ETag!.Tag);
        Assert.Equal(HttpStatusCode.NotFound, repeat.StatusCode);
    }

    private async Task<(string Id, string ETag)> CreateLiveAsync(string key, params string[] players)
    {
        using var created = await SendJsonAsync(HttpMethod.Post, "/api/live-tournaments", new { name = $"Live {key}" }, "Organizer", key: key);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await Body(created);
        var id = body.GetProperty("document").GetProperty("id").GetString()!;
        var etag = created.Headers.ETag!.Tag;
        foreach (var player in players)
        {
            var (_, nextETag) = await AddPlayerAsync(id, player, etag);
            etag = nextETag;
        }
        return (id, etag);
    }

    private async Task<(JsonElement Body, string ETag)> AddPlayerAsync(string id, string name, string etag)
    {
        using var response = await SendJsonAsync(HttpMethod.Post, $"/api/live-tournaments/{id}/players", new { name }, "Organizer", ifMatch: etag);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await Body(response), response.Headers.ETag!.Tag);
    }

    private async Task<HttpResponseMessage> SendJsonAsync(HttpMethod method, string path, object body, string? role, string? key = null, string? ifMatch = null)
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
        if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return await Client.SendAsync(request);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await Body(response)).GetProperty("code").GetString());
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
}
