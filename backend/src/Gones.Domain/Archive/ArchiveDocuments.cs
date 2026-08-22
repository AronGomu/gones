using Gones.Domain.Leagues;

namespace Gones.Domain.Archive;

/// <summary>Top tier. Groups Seasons. Carries no Tournaments — they are fetched as their own rows.</summary>
public sealed record ArchiveLeagueDocument(string Id, string Name, string CreatedAt);

/// <summary>Middle tier. Mandatory parent League. What used to be called a League.</summary>
public sealed record ArchiveLeagueSeasonDocument(string Id, string Name, string LeagueId, string Status);

/// <summary>
/// Bottom tier, now top-level: every Tournament is its own row. <c>SeasonId</c> is <c>null</c> for a
/// standalone Tournament. There is deliberately no League ID — the League is derived by joining
/// through <c>SeasonId</c>.
/// </summary>
public sealed record ArchiveTournamentDocument(
    string Id,
    string Name,
    string? SeasonId,
    string TournamentDate,
    string Status,
    IReadOnlyList<RoundDocument> Rounds,
    IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes);

internal static class ArchiveValidation
{
    public static void ValidateString(string? value, string field, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
            throw new ArgumentException($"{field} must contain 1 to {maximumLength} characters.", field);
    }

    public static void ValidateStatus(string? status, string subject)
    {
        if (status is not ("active" or "completed"))
            throw new ArgumentException($"{subject} status must be active or completed.", "status");
    }

    /// <summary>Null, empty and whitespace all mean "standalone"; everything else is validated as an ID.</summary>
    public static string? NormalizeSeasonId(string? seasonId, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(seasonId)) return null;
        ValidateString(seasonId, "seasonId", maximumLength);
        return seasonId;
    }
}
