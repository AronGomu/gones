using Gones.Domain.Leagues;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Gones.Infrastructure.Persistence;

internal sealed class PlayerStatisticsRowConfiguration : IEntityTypeConfiguration<PlayerStatisticsRow>
{
    public void Configure(EntityTypeBuilder<PlayerStatisticsRow> builder)
    {
        builder.ToTable("player_statistics");
        builder.HasKey(row => row.PlayerName);
        // Player Names are exact and unbounded inside a League document, so the key is plain text: a
        // length cap here would reject an archive write the domain accepts.
        builder.Property(row => row.PlayerName).HasColumnType("text");
        ConfigureJson(builder.Property(row => row.Nemesis));
        ConfigureJson(builder.Property(row => row.Rival));
        ConfigureJson(builder.Property(row => row.MostPlayedArchetype));

        // One index per sortable rankings column (ADR 0040). The primary key already indexes
        // player_name for equality; the extra text_pattern_ops index is what lets a prefix search use
        // an index under a non-C collation.
        builder.HasIndex(row => row.PlayedMatchCount);
        builder.HasIndex(row => row.MatchWins);
        builder.HasIndex(row => row.MatchLosses);
        builder.HasIndex(row => row.MatchDraws);
        builder.HasIndex(row => row.MatchWinrate);
        builder.HasIndex(row => row.PlayedGameCount);
        builder.HasIndex(row => row.GameWins);
        builder.HasIndex(row => row.GameLosses);
        builder.HasIndex(row => row.GameWinrate);
        builder.HasIndex(row => row.PlayerName)
            .HasDatabaseName("ix_player_statistics_player_name_pattern")
            .HasOperators("text_pattern_ops");
    }

    /// <summary>
    /// Stores a nested statistics record as <c>jsonb</c>. EF never calls a converter for null, so the
    /// nullable columns stay null rather than holding a JSON <c>null</c>.
    /// </summary>
    private static void ConfigureJson<T>(PropertyBuilder<T?> builder)
        where T : class
    {
        builder
            .HasColumnType("jsonb")
            .HasConversion(
                new ValueConverter<T?, string?>(
                    value => value == null ? null : LeagueJson.Serialize(value),
                    json => json == null ? null : LeagueJson.Deserialize<T>(json)),
                new ValueComparer<T?>(
                    (left, right) => Equals(left, right),
                    value => value == null ? 0 : value.GetHashCode(),
                    value => value));
    }
}

internal sealed class PlayerStatisticsMetaConfiguration : IEntityTypeConfiguration<PlayerStatisticsMeta>
{
    public void Configure(EntityTypeBuilder<PlayerStatisticsMeta> builder)
    {
        builder.ToTable("player_statistics_meta");
        builder.HasKey(meta => meta.Id);
        builder.Property(meta => meta.Id).ValueGeneratedNever();
        builder.ToTable(table => table.HasCheckConstraint(
            "ck_player_statistics_meta_single_row",
            $"id = {PlayerStatisticsMeta.SingletonId}"));
    }
}
