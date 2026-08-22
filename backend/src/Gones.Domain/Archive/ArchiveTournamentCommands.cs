using Gones.Domain.Leagues;
using NodaTime;
using NodaTime.Text;

namespace Gones.Domain.Archive;

/// <summary>
/// The Tournament-tier command functions. They own no mutation rules: rounds, entries, archetype
/// merging and player renaming already live in <see cref="LeagueCommands"/>, so every transform is
/// delegated through a synthetic carrier League rather than forked onto this tier.
/// </summary>
public static class ArchiveTournamentCommands
{
    /// <summary>
    /// Synthetic carrier League. It exists only for the length of one call, and it is always
    /// <c>active</c>: <see cref="LeagueCommands"/> gates content writes on the carrier League's status,
    /// but in the three-tier archive the freeze mechanism is <see cref="ArchiveLockRule"/>, not a
    /// Season or League status.
    /// </summary>
    private const string CarrierId = "archive-carrier";
    private const string CarrierName = "Archive Carrier";

    public static ArchiveTournamentDocument Create(string tournamentId, string? seasonId, string name, string tournamentDate)
    {
        var carrier = LeagueCommands.AddTournament(EmptyCarrier(), tournamentId, name, tournamentDate);
        var created = carrier.Tournaments.Single();
        _ = ParseDate(created.TournamentDate);
        return new ArchiveTournamentDocument(
            created.Id,
            created.Name,
            seasonId,
            created.TournamentDate,
            created.Status,
            created.Rounds,
            created.PlayerArchetypes);
    }

    public static ArchiveTournamentDocument Edit(ArchiveTournamentDocument tournament, string name, string tournamentDate, string? status)
    {
        _ = ParseDate(tournamentDate);
        return Delegate(tournament, carrier => LeagueCommands.EditTournament(carrier, tournament.Id, name, tournamentDate, status));
    }

    public static ArchiveTournamentDocument MoveToSeason(ArchiveTournamentDocument tournament, string? seasonId) =>
        tournament with { SeasonId = seasonId };

    public static ArchiveTournamentDocument AddRound(ArchiveTournamentDocument tournament, string roundId) =>
        Delegate(tournament, carrier => LeagueCommands.AddRound(carrier, tournament.Id, roundId));

    public static ArchiveTournamentDocument DeleteRound(ArchiveTournamentDocument tournament, string roundId) =>
        Delegate(tournament, carrier => LeagueCommands.DeleteRound(carrier, tournament.Id, roundId));

    public static ArchiveTournamentDocument ReplaceRound(ArchiveTournamentDocument tournament, string roundId, IReadOnlyList<RoundEntry> entries, bool mergeImportedArchetypes) =>
        Delegate(tournament, carrier => LeagueCommands.ReplaceRound(carrier, tournament.Id, roundId, entries, mergeImportedArchetypes));

    public static ArchiveTournamentDocument AddEntry(ArchiveTournamentDocument tournament, string roundId, RoundEntry entry) =>
        Delegate(tournament, carrier => LeagueCommands.AddEntry(carrier, tournament.Id, roundId, entry));

    public static ArchiveTournamentDocument EditEntry(ArchiveTournamentDocument tournament, string roundId, string entryId, RoundEntry entry) =>
        Delegate(tournament, carrier => LeagueCommands.EditEntry(carrier, tournament.Id, roundId, entryId, entry));

    public static ArchiveTournamentDocument DeleteEntry(ArchiveTournamentDocument tournament, string roundId, string entryId) =>
        Delegate(tournament, carrier => LeagueCommands.DeleteEntry(carrier, tournament.Id, roundId, entryId));

    public static ArchiveTournamentDocument UpdateArchetype(ArchiveTournamentDocument tournament, string playerName, string archetype) =>
        Delegate(tournament, carrier => LeagueCommands.UpdateArchetype(carrier, tournament.Id, playerName, archetype));

    public static ArchiveTournamentDocument RenamePlayer(ArchiveTournamentDocument tournament, string fromName, string toName) =>
        Delegate(tournament, carrier => LeagueCommands.RenamePlayer(carrier, fromName, toName));

    public static ArchiveTournamentDocument ApplyEditBatch(ArchiveTournamentDocument tournament, ArchiveTournamentEditBatch command) =>
        Delegate(tournament, carrier => LeagueCommands.ApplyTournamentEditBatch(carrier, tournament.Id, command));

    /// <summary>
    /// Remaps Tournament, Round and Round Entry IDs through the existing restore path. Callers pass
    /// documents whose <see cref="ArchiveTournamentDocument.SeasonId"/> is already the new Season ID;
    /// order is preserved, so the Season IDs are zipped back by index.
    /// </summary>
    public static IReadOnlyList<ArchiveTournamentDocument> Restore(IReadOnlyList<ArchiveTournamentDocument> tournaments, Func<string> idFactory)
    {
        ArgumentNullException.ThrowIfNull(tournaments);
        ArgumentNullException.ThrowIfNull(idFactory);
        if (tournaments.Count == 0) return [];
        var carrier = new LeagueDocument(CarrierId, CarrierName, "active", [.. tournaments.Select(ToCarrierTournament)]);
        var restored = LeagueCommands.Restore(carrier, idFactory(), CarrierName, idFactory);
        return
        [
            .. restored.Tournaments.Select((item, index) => new ArchiveTournamentDocument(
                item.Id,
                item.Name,
                tournaments[index].SeasonId,
                item.TournamentDate,
                item.Status,
                item.Rounds,
                item.PlayerArchetypes))
        ];
    }

    public static LocalDate ParseDate(string value)
    {
        var parsed = LocalDatePattern.Iso.Parse(value?.Trim() ?? string.Empty);
        if (!parsed.Success) throw new ArgumentException("Tournament date must be an ISO 8601 calendar date.", "tournamentDate");
        return parsed.Value;
    }

    public static string FormatDate(LocalDate value) => LocalDatePattern.Iso.Format(value);

    private static LeagueDocument EmptyCarrier() => new(CarrierId, CarrierName, "active", []);

    private static TournamentDocument ToCarrierTournament(ArchiveTournamentDocument tournament) =>
        ArchiveDocumentAdapter.ToLegacyTournament(tournament, CarrierId);

    private static ArchiveTournamentDocument Delegate(ArchiveTournamentDocument tournament, Func<LeagueDocument, LeagueDocument> command)
    {
        ArgumentNullException.ThrowIfNull(tournament);
        var carrier = command(new LeagueDocument(CarrierId, CarrierName, "active", [ToCarrierTournament(tournament)]));
        var changed = carrier.Tournaments.Single(item => item.Id == tournament.Id);
        // The Season is never read or written by a carrier transform, so it survives untouched.
        return tournament with
        {
            Name = changed.Name,
            TournamentDate = changed.TournamentDate,
            Status = changed.Status,
            Rounds = changed.Rounds,
            PlayerArchetypes = changed.PlayerArchetypes
        };
    }
}
