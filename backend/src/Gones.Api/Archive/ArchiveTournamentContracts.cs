using Gones.Domain.Leagues;
using NodaTime;

namespace Gones.Api.Archive;

/// <summary>
/// One Tournament as the table prints it. Deliberately carries no <c>locked</c> flag: a row cached
/// today as unlocked would silently become locked without a refetch, so the client derives the flag
/// from <see cref="TournamentDate"/>. It also carries no Rounds and no archetypes — the detail
/// document is a different route, and a detail document is never stored in a year partition.
/// </summary>
/// <param name="TournamentDate">
/// An ISO <c>YYYY-MM-DD</c> string rather than a <c>LocalDate</c>: the client parses it to derive the
/// lock flag, and a NodaTime date on a response record surfaces in the generated TypeScript client as
/// an opaque <c>LocalDate</c> interface instead of the plain string the frontend contract names.
/// </param>
internal sealed record ArchiveTournamentSummary(
    string Id,
    string Name,
    string? SeasonId,
    string TournamentDate,
    string Status,
    Instant UpdatedAt,
    int DocumentVersion,
    int PlayerCount);

/// <summary>
/// The whole Tournament document: the wire twin of the frontend's <c>PersistedArchiveTournament</c>.
/// Never stored in a year partition — a partition holds <see cref="ArchiveTournamentSummary"/> rows —
/// so this is the only shape that carries Rounds and archetypes.
/// </summary>
/// <param name="TournamentDate">ISO <c>YYYY-MM-DD</c>, for the same reason as on the summary row.</param>
/// <param name="SeasonId"><c>null</c> for a standalone Tournament: serialized, never omitted.</param>
internal sealed record ArchiveTournamentDetailResponse(
    string Id,
    string Name,
    string? SeasonId,
    string TournamentDate,
    string Status,
    IReadOnlyList<RoundDocument> Rounds,
    IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes,
    int DocumentVersion,
    Instant UpdatedAt);

/// <summary>
/// One year of the archive. <c>Locked</c> is on the wire here, unlike on a Tournament row, because
/// this index is fetched every session and its ETag carries the current day, so the flag cannot be
/// served stale across a day boundary.
/// </summary>
internal sealed record ArchiveYearEntry(int Year, bool Locked, int TournamentCount);

internal sealed record ArchiveYearsResponse(IReadOnlyList<ArchiveYearEntry> Years);

/// <summary>The GROUP BY projection behind <see cref="ArchiveYearsResponse"/>.</summary>
internal sealed record ArchiveYearCount(int Year, int TournamentCount);
