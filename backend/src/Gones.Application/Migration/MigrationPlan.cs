using Gones.Domain.Calendar;
using Gones.Domain.Leagues;
using Gones.Domain.Live;

namespace Gones.Application.Migration;

/// <summary>Everything the planner needs to know about the target database, DB-access free.</summary>
public sealed record MigrationTargetState(
    string DatabaseIdentity,
    IReadOnlySet<string> ExistingLeagueIds,
    IReadOnlySet<string> StandaloneTournamentIds,
    IReadOnlySet<string> ExistingLiveTournamentIds,
    IReadOnlySet<string> ExistingDeckArchetypeKeys,
    IReadOnlySet<string> ExistingTournamentSlugs,
    bool OrganizationExists,
    bool OwnerIsOrganizationOwner,
    IReadOnlyDictionary<string, Guid> FormatIdsBySlug);

public sealed record PlannedScheduledTournament(
    string SourceEventId,
    ScheduledTournamentDraft Draft,
    IReadOnlyList<string> FormatSlugs,
    string StatusPolicy);

public sealed record MigrationPlan(
    string BatchHash,
    IReadOnlyList<LeagueDocument> LeaguesToCreate,
    /// <summary>
    /// Bundle Tournaments that belonged to no League. The fixed `placeholder-league` row they used to
    /// merge into is retired, so they import as standalone Archive Tournaments (`season_id IS NULL`).
    /// </summary>
    IReadOnlyList<TournamentDocument> StandaloneTournaments,
    IReadOnlyList<PlannedScheduledTournament> ScheduledTournaments,
    IReadOnlyList<LiveTournamentDocument> LiveTournamentsToCreate,
    IReadOnlyList<string> DeckArchetypesToAdd);

public sealed record MigrationEvaluation(MigrationPlan Plan, MigrationReport Report);
