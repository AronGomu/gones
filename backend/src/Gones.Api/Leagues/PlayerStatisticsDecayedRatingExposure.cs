namespace Gones.Api.Leagues;

/// <summary>
/// Controls whether the stored <c>decayedRating</c> column is projected onto the wire.
///
/// <para>The column is always computed during the rebuild and stored on every row — the switch is
/// presentation only. Flipping it and restarting exposes or hides the value without any rebuild.
/// See ADR 0043.</para>
/// </summary>
internal static class PlayerStatisticsDecayedRatingExposure
{
    public const string EnabledKey = "Gones:PlayerStatistics:ExposeDecayedRating";

    /// <summary>
    /// The same switch under the flat environment-variable spelling documented in <c>.env.example</c>
    /// (<c>GONES_PLAYER_STATISTICS__EXPOSE_DECAYED_RATING</c>), which the default provider turns into
    /// this key rather than the sectioned one above.
    /// </summary>
    public const string EnvironmentEnabledKey = "GONES_PLAYER_STATISTICS:EXPOSE_DECAYED_RATING";

    public static bool Enabled(IConfiguration configuration) =>
        configuration.GetValue<bool?>(EnabledKey)
        ?? configuration.GetValue<bool?>(EnvironmentEnabledKey)
        ?? false;
}
