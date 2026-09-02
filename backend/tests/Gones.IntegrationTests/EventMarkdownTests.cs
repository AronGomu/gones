using System.Text.Json;
using Gones.Api.Events;

namespace Gones.IntegrationTests;

public sealed class EventMarkdownTests
{
    public static IEnumerable<object?[]> GoldenCases() => JsonSerializer
        .Deserialize<GoldenCase[]>(File.ReadAllText(FixturePath()), new JsonSerializerOptions(JsonSerializerDefaults.Web))!
        .Select(item => new object?[] { item.Name, item.Markdown, item.MarkdownCodeUnits, item.Html });

    [Theory]
    [MemberData(nameof(GoldenCases))]
    public void EventMarkdown_golden_corpus_matches_frontend_contract(
        string name,
        string? markdown,
        int[]? markdownCodeUnits,
        string expectedHtml)
    {
        _ = name;
        markdown ??= new string(markdownCodeUnits!.Select(codeUnit => (char)codeUnit).ToArray());
        var renderer = new EventMarkdownRenderer();

        Assert.Equal(expectedHtml, renderer.RenderAndSanitize(markdown));
    }

    [Fact]
    public void EventMarkdown_malformed_and_hostile_input_never_returns_executable_markup()
    {
        var html = new EventMarkdownRenderer().RenderAndSanitize("<img src=x onerror=alert(1)>\n\n![x](javascript:alert(2))\n\n[link](javascript:alert(3))");

        Assert.DoesNotContain("<img", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("onerror", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("javascript:", html, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("link", html, StringComparison.Ordinal);
    }

    private static string FixturePath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "package.json")))
        {
            directory = directory.Parent;
        }

        return Path.Combine(directory?.FullName ?? throw new InvalidOperationException("Repository root not found."), "fixtures", "event-markdown-golden.json");
    }

    private sealed record GoldenCase(string Name, string? Markdown, int[]? MarkdownCodeUnits, string Html);
}
