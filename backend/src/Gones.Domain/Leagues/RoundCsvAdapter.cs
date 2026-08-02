using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Gones.Domain.Leagues;

public static partial class RoundCsvAdapter
{
    private static readonly string[] Header = ["table", "player", "result", "opponent", "player_decklist", "opponent_decklist"];

    public static RoundImportResult Import(string? text, Func<string>? idFactory = null)
    {
        idFactory ??= () => Guid.NewGuid().ToString();
        var lines = (text ?? string.Empty)
            .Split(["\r\n", "\n"], StringSplitOptions.None)
            .Select(line => line.Trim())
            .Where(line => line.Length > 0)
            .ToArray();
        var delimiter = DetectDelimiter(lines);
        var entries = new List<RoundEntry>();

        for (var index = 0; index < lines.Length; index++)
        {
            var line = lines[index];
            var fields = ParseDelimitedLine(line, delimiter);
            if (index == 0 && IsHeader(fields)) continue;
            if (fields.Count != 6)
            {
                entries.Add(new InvalidRoundEntry(idFactory(), line, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty));
                continue;
            }

            var values = fields.Select(field => field.Trim()).ToArray();
            var parsed = ParseResult(values[2]);
            if (parsed is null)
            {
                entries.Add(new InvalidRoundEntry(idFactory(), line, values[0], values[1], values[2], values[3], values[4], values[5]));
                continue;
            }

            entries.Add(new MatchRoundEntry(
                idFactory(),
                values[0],
                LeagueNormalizer.TrimPlayerName(values[1]),
                LeagueNormalizer.TrimPlayerName(values[3]),
                parsed.Value.PlayerScore,
                parsed.Value.OpponentScore,
                LeagueNormalizer.NormalizeDeckArchetype(values[4]),
                LeagueNormalizer.NormalizeDeckArchetype(values[5])));
        }

        return new RoundImportResult(entries);
    }

    public static IReadOnlyList<string> ParseDelimitedLine(string line, char delimiter)
    {
        var fields = new List<string>();
        var current = new StringBuilder();
        var quoted = false;
        for (var index = 0; index < line.Length; index++)
        {
            var character = line[index];
            var next = index + 1 < line.Length ? line[index + 1] : '\0';
            if (character == '"' && quoted && next == '"')
            {
                current.Append('"');
                index++;
            }
            else if (character == '"') quoted = !quoted;
            else if (character == delimiter && !quoted)
            {
                fields.Add(current.ToString());
                current.Clear();
            }
            else current.Append(character);
        }
        fields.Add(current.ToString());
        return fields;
    }

    private static ParsedResult? ParseResult(string result)
    {
        var match = ResultRegex().Match((result ?? string.Empty).Trim());
        if (!match.Success
            || !int.TryParse(match.Groups[2].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var playerScore)
            || !int.TryParse(match.Groups[3].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var opponentScore)) return null;
        var outcome = match.Groups[1].Value.ToLowerInvariant();
        if (outcome == "won" && playerScore <= opponentScore) return null;
        if (outcome == "lost" && playerScore >= opponentScore) return null;
        if (outcome is "draw" or "drawn" && playerScore != opponentScore) return null;
        return new ParsedResult(playerScore, opponentScore, outcome == "drawn" ? "draw" : outcome);
    }

    private static char DetectDelimiter(IReadOnlyList<string> lines)
    {
        var firstDataLine = lines.FirstOrDefault(line => ParseDelimitedLine(line, ',').Count >= Header.Length || ParseDelimitedLine(line, ';').Count >= Header.Length) ?? string.Empty;
        return ParseDelimitedLine(firstDataLine, ';').Count > ParseDelimitedLine(firstDataLine, ',').Count ? ';' : ',';
    }

    private static bool IsHeader(IReadOnlyList<string> fields) =>
        fields.Count == Header.Length && fields.Select(field => field.Trim().ToLowerInvariant()).SequenceEqual(Header);

    private readonly record struct ParsedResult(int PlayerScore, int OpponentScore, string Outcome);

    [GeneratedRegex(@"^(won|lost|draw(?:n)?)\s+(\d+)\s*-\s*(\d+)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ResultRegex();
}
