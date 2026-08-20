using System.Globalization;
using NodaTime;

namespace Gones.Api.Leagues;

/// <summary>
/// The two rules that decide where a rated player is listed: too new to be ranked, or ranked but idle.
/// They live in one class because the browser mirrors them on the rankings page, and two copies of
/// "five Tournaments" that drift apart is a table that disagrees with its own badges.
///
/// <para>Neither flag is stored. A player who stops playing has to go inactive on the day the twelve
/// months run out, not at whatever later moment the next rebuild happens to run, so both are derived
/// from the stored columns and the request clock every time a row is served.</para>
/// </summary>
internal static class PlayerRankingRules
{
    /// <summary>Fewer completed Tournaments than this and the rating is not rankable yet.</summary>
    public const int ProvisionalTournamentThreshold = 5;

    /// <summary>Months without a completed Tournament before a ranked player is listed as inactive.</summary>
    public const int InactiveMonths = 12;

    /// <summary>Ranked and playing: the top of the default order, by rating.</summary>
    public const int ActiveRankedBucket = 0;

    /// <summary>Ranked but idle: still by rating, still listed, below every active player.</summary>
    public const int InactiveRankedBucket = 1;

    /// <summary>Not rankable yet: last, by Tournaments played and then Matches played.</summary>
    public const int ProvisionalBucket = 2;

    public static bool IsProvisional(int tournamentsPlayed) => tournamentsPlayed < ProvisionalTournamentThreshold;

    /// <summary>
    /// The newest last-played date that still counts as inactive. Stored dates are ISO
    /// <c>YYYY-MM-DD</c> and therefore fixed-width, so comparing one against this string is the same
    /// test as "twelve whole months have passed" — and it is a test Postgres can run on the column
    /// itself, which is what keeps the ordering and the flag from ever disagreeing.
    /// </summary>
    public static string InactiveCutoff(LocalDate today) => Iso(today.PlusMonths(-InactiveMonths));

    public static string Iso(LocalDate date) => date.ToString("uuuu-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>
    /// A provisional player is never also inactive: the provisional bucket already sits last, and
    /// badging a newcomer as idle would say the wrong thing about why they are not ranked.
    /// </summary>
    public static bool IsInactive(string? lastPlayedDate, int tournamentsPlayed, LocalDate today) =>
        !IsProvisional(tournamentsPlayed)
        && (lastPlayedDate is null || string.CompareOrdinal(lastPlayedDate, InactiveCutoff(today)) <= 0);

    public static int Bucket(string? lastPlayedDate, int tournamentsPlayed, LocalDate today) =>
        IsProvisional(tournamentsPlayed) ? ProvisionalBucket
        : IsInactive(lastPlayedDate, tournamentsPlayed, today) ? InactiveRankedBucket
        : ActiveRankedBucket;
}
