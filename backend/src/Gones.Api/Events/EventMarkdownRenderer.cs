using System.Xml;
using System.Xml.Linq;
using Markdig;
using Markdig.Extensions.EmphasisExtras;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace Gones.Api.Events;

public interface IEventMarkdownRenderer
{
    string RenderAndSanitize(string markdown);
}

internal sealed class EventMarkdownRenderer : IEventMarkdownRenderer
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UsePipeTables()
        .UseTaskLists()
        .UseEmphasisExtras(EmphasisExtraOptions.Strikethrough)
        .UseAutoLinks()
        .Build();

    private static readonly HashSet<string> AllowedElements = new(StringComparer.Ordinal)
    {
        "p", "br", "strong", "em", "ul", "ol", "li", "h2", "h3", "h4", "a",
        "blockquote", "pre", "code", "hr", "table", "thead", "tbody", "tr", "th", "td",
        "del", "input"
    };

    public string RenderAndSanitize(string markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown)) return string.Empty;
        var normalizedMarkdown = RemoveXmlInvalidCharacters(markdown);
        var markdownDocument = Markdown.Parse(normalizedMarkdown, Pipeline);
        foreach (var block in markdownDocument.Descendants<HtmlBlock>().ToArray()) block.Remove();
        foreach (var inline in markdownDocument.Descendants<HtmlInline>().ToArray()) inline.Remove();
        foreach (var image in markdownDocument.Descendants<LinkInline>().Where(link => link.IsImage).ToArray()) image.Remove();
        var rendered = Markdown.ToHtml(markdownDocument, Pipeline);
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
        using var reader = XmlReader.Create(new StringReader($"<root>{rendered}</root>"), settings);
        var document = XDocument.Load(reader, LoadOptions.None);
        return string.Concat(document.Root!.Nodes()
            .Where(node => node is not XText text || !IsStructuralWhitespace(text))
            .Select(RenderNode));
    }

    private static string RenderNode(XNode node) => node switch
    {
        XText text when IsStructuralWhitespace(text) => string.Empty,
        XText text => RenderText(text),
        XElement element => RenderElement(element),
        _ => string.Empty
    };

    private static string RenderElement(XElement element)
    {
        if (!string.IsNullOrEmpty(element.Name.NamespaceName)) return RenderChildren(element);
        var sourceName = element.Name.LocalName.ToLowerInvariant();
        if (sourceName == "img") return string.Empty;
        var name = sourceName switch
        {
            "h1" => "h2",
            "h2" => "h3",
            "h3" or "h4" or "h5" or "h6" => "h4",
            _ => sourceName
        };
        if (!AllowedElements.Contains(name)) return RenderChildren(element);

        if (name is "br" or "hr") return $"<{name}>";
        if (name == "input") return RenderCheckbox(element);

        var attributes = name == "a" ? RenderLinkAttributes(element) : string.Empty;
        return $"<{name}{attributes}>{RenderChildren(element)}</{name}>";
    }

    private static string RenderCheckbox(XElement element)
    {
        var type = Attribute(element, "type");
        var disabled = element.Attributes().Any(attribute =>
            string.IsNullOrEmpty(attribute.Name.NamespaceName)
            && attribute.Name.LocalName.Equals("disabled", StringComparison.OrdinalIgnoreCase));
        if (!type.Equals("checkbox", StringComparison.OrdinalIgnoreCase) || !disabled) return string.Empty;
        var isChecked = element.Attributes().Any(attribute =>
            string.IsNullOrEmpty(attribute.Name.NamespaceName)
            && attribute.Name.LocalName.Equals("checked", StringComparison.OrdinalIgnoreCase));
        return isChecked
            ? "<input type=\"checkbox\" disabled=\"\" checked=\"\">"
            : "<input type=\"checkbox\" disabled=\"\">";
    }

    private static string RenderLinkAttributes(XElement element)
    {
        var href = Attribute(element, "href");
        if (!IsAllowedHref(href)) return string.Empty;
        var escaped = EscapeAttribute(href);
        return href.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || href.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            ? $" href=\"{escaped}\" target=\"_blank\" rel=\"noopener noreferrer\""
            : $" href=\"{escaped}\"";
    }

    private static bool IsAllowedHref(string href) =>
        href.StartsWith("/", StringComparison.Ordinal)
        || href.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
        || href.StartsWith("https://", StringComparison.OrdinalIgnoreCase);

    private static string Attribute(XElement element, string name) => element.Attributes()
        .FirstOrDefault(attribute =>
            string.IsNullOrEmpty(attribute.Name.NamespaceName)
            && attribute.Name.LocalName.Equals(name, StringComparison.OrdinalIgnoreCase))?.Value ?? string.Empty;

    private static string RenderChildren(XElement element) => string.Concat(element.Nodes().Select(RenderNode));

    private static string RenderText(XText text)
    {
        var value = text.PreviousNode is XElement element && element.Name.LocalName.Equals("br", StringComparison.OrdinalIgnoreCase)
            ? text.Value.TrimStart('\r', '\n')
            : text.Value;
        return EscapeText(value);
    }

    private static bool IsStructuralWhitespace(XText text) =>
        string.IsNullOrWhiteSpace(text.Value)
        && (text.Value.Contains('\n') || text.Value.Contains('\r'))
        && text.Parent?.Name.LocalName is not ("pre" or "code");

    private static string EscapeText(string value) => value
        .Replace("&", "&amp;", StringComparison.Ordinal)
        .Replace("<", "&lt;", StringComparison.Ordinal)
        .Replace(">", "&gt;", StringComparison.Ordinal);

    private static string EscapeAttribute(string value) => EscapeText(value).Replace("\"", "&quot;", StringComparison.Ordinal);

    private static string RemoveXmlInvalidCharacters(string value)
    {
        var normalized = new char[value.Length];
        var length = 0;
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (char.IsHighSurrogate(character))
            {
                if (index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]))
                {
                    normalized[length++] = character;
                    normalized[length++] = value[++index];
                }
                continue;
            }
            if (char.IsLowSurrogate(character)) continue;
            if (character is '\t' or '\n' or '\r'
                || character is >= ' ' and <= '\uD7FF'
                || character is >= '\uE000' and <= '\uFFFD')
            {
                normalized[length++] = character;
            }
        }
        return new string(normalized, 0, length);
    }
}
