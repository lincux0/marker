using System.Linq;
using System.Text;
using Markdig;
using Markdig.Extensions.Footnotes;
using Markdig.Extensions.Mathematics;
using Markdig.Extensions.Tables;
using Markdig.Extensions.EmphasisExtras;
using Markdig.Renderers.Html;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace Marker.App;

internal static class MarkdownRenderer
{
    private static readonly string[] AlertKinds = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UsePreciseSourceLocation()
        .UsePipeTables()
        .UseTaskLists()
        .UseAutoLinks()
        .UseFootnotes()
        .UseMathematics()
        .UseEmphasisExtras(EmphasisExtraOptions.Strikethrough)
        .DisableHtml()
        .Build();

    public static string Render(string markdown) => Render(markdown, null);

    public static string Render(string markdown, Func<string, string?>? resolveImage) =>
        RenderDocument(markdown, resolveImage).Html;

    internal static MarkdownRenderDocument RenderDocument(string markdown, Func<string, string?>? resolveImage = null)
    {
        var document = Markdown.Parse(markdown, Pipeline);
        foreach (var image in document.Descendants<LinkInline>().Where(inline => inline.IsImage).ToArray())
        {
            var resolved = image.Url is null ? null : resolveImage?.Invoke(image.Url);
            if (string.IsNullOrWhiteSpace(resolved)) image.ReplaceBy(new LiteralInline(GetImageUnavailableText(image)));
            else image.Url = resolved;
        }

        foreach (var table in document.Descendants<Table>())
        {
            var definitions = table.ColumnDefinitions;
            if (definitions is null) continue;

            foreach (var block in table)
            {
                if (block is not TableRow row) continue;

                var nextColumn = 0;
                foreach (var child in row)
                {
                    if (child is not TableCell cell) continue;

                    var columnIndex = cell.ColumnIndex >= 0 ? cell.ColumnIndex : nextColumn;
                    if (columnIndex < definitions.Count && definitions[columnIndex].Alignment is { } alignment)
                        cell.GetAttributes().AddProperty("align", alignment.ToString().ToLowerInvariant());

                    nextColumn = Math.Max(nextColumn, columnIndex + Math.Max(1, cell.ColumnSpan));
                }
            }
        }

        var usedIds = new HashSet<string>(StringComparer.Ordinal);
        var nextSuffix = new Dictionary<string, int>(StringComparer.Ordinal);
        var outline = new List<MarkdownOutlineItem>();
        foreach (var heading in document.Descendants<HeadingBlock>())
        {
            var text = GetHeadingText(heading.Inline);
            var baseId = "heading-" + Slug(text);
            var id = baseId;
            if (!usedIds.Add(id))
            {
                var suffix = nextSuffix.TryGetValue(baseId, out var previousSuffix) ? previousSuffix : 2;
                do id = $"{baseId}-{suffix++}"; while (!usedIds.Add(id));
                nextSuffix[baseId] = suffix;
            }
            heading.GetAttributes().Id = id;
            outline.Add(new MarkdownOutlineItem(id, text.Length <= 2000 ? text : text[..1999] + "…", heading.Level, heading.Span.Start));
        }

        return new MarkdownRenderDocument(document.ToHtml(Pipeline), outline, GetRichNodes(markdown, document));
    }

    private static IReadOnlyList<MarkdownRichNode> GetRichNodes(string markdown, MarkdownDocument document)
    {
        var nodes = new List<MarkdownRichNode>();
        foreach (var math in document.Descendants<MathInline>())
            AddRange(nodes, math.Span, "math-inline", math.Content.ToString(), string.Empty, 0, markdown.Length);
        foreach (var math in document.Descendants<MathBlock>())
            AddRange(nodes, math.Span, "math-block", math.Lines.ToString(), string.Empty, 0, markdown.Length);

        foreach (var footnote in document.Descendants<Footnote>())
        {
            var references = footnote.Links.Where(link => !link.IsBackLink).ToArray();
            if (references.Length == 0) continue;
            var firstReference = references.Min(link => link.Span.Start);
            var label = (footnote.Label?.ToString() ?? string.Empty).TrimStart('^');
            var labelStart = footnote.LabelSpan.Start;
            var lineStart = markdown.LastIndexOf('\n', Math.Max(0, labelStart - 1)) + 1;
            var definitionFrom = labelStart;
            while (definitionFrom > lineStart && markdown[definitionFrom] != '[') definitionFrom--;
            AddRange(nodes, definitionFrom, footnote.Span.End, "footnote-definition", footnote.Order.ToString(), label, firstReference, markdown.Length);
            foreach (var reference in references)
                AddRange(nodes, reference.Span, "footnote-reference", footnote.Order.ToString(), label, definitionFrom, markdown.Length);
        }

        foreach (var quote in document.Descendants<QuoteBlock>())
        {
            if (quote.Count == 0 || quote[0] is not ParagraphBlock paragraph) continue;
            var markerStart = GetAlertMarkerStart(markdown, paragraph.Span, out var kind, out var marker);
            if (markerStart < 0) continue;
            AddRange(nodes, quote.Span, "alert", kind, marker, markerStart + marker.Length, markdown.Length);
        }

        return nodes.OrderBy(node => node.From).ThenByDescending(node => node.To).ToArray();
    }

    private static int GetAlertMarkerStart(string markdown, SourceSpan paragraphSpan, out string kind, out string marker)
    {
        kind = string.Empty;
        marker = string.Empty;
        var start = paragraphSpan.Start;
        if (start < 0 || paragraphSpan.End < start || start >= markdown.Length) return -1;
        var lineEnd = markdown.IndexOf('\n', start, Math.Min(markdown.Length - start, paragraphSpan.End - start + 1));
        if (lineEnd < 0) lineEnd = Math.Min(markdown.Length, paragraphSpan.End + 1);
        var position = start;
        while (position < lineEnd)
        {
            while (position < lineEnd && markdown[position] == '>') position++;
            while (position < lineEnd && markdown[position] is ' ' or '\t') position++;
            if (position >= lineEnd || markdown[position] != '>') break;
        }
        foreach (var candidate in AlertKinds)
        {
            var candidateMarker = $"[!{candidate}]";
            if (position + candidateMarker.Length > lineEnd || !markdown.AsSpan(position, candidateMarker.Length).SequenceEqual(candidateMarker)) continue;
            if (!markdown.AsSpan(position + candidateMarker.Length, lineEnd - position - candidateMarker.Length).Trim().IsEmpty) continue;
            kind = candidate;
            marker = candidateMarker;
            return position;
        }
        return -1;
    }

    private static void AddRange(List<MarkdownRichNode> nodes, SourceSpan span, string kind, string text, string label, int target, int sourceLength)
    {
        AddRange(nodes, span.Start, span.End, kind, text, label, target, sourceLength);
    }

    private static void AddRange(List<MarkdownRichNode> nodes, int from, int endInclusive, string kind, string text, string label, int target, int sourceLength)
    {
        if (from < 0 || endInclusive < from || from >= sourceLength) return;
        var to = Math.Min(sourceLength, endInclusive + 1);
        if (to <= from) return;
        nodes.Add(new MarkdownRichNode(kind, from, to, text, label, Math.Clamp(target, 0, sourceLength)));
    }

    private static string GetHeadingText(ContainerInline? inline)
    {
        var text = new StringBuilder();
        for (var child = inline?.FirstChild; child is not null; child = child.NextSibling)
        {
            switch (child)
            {
                case LiteralInline literal:
                    text.Append(literal.Content.ToString());
                    break;
                case CodeInline code:
                    text.Append(code.Content);
                    break;
                case MathInline math:
                    text.Append(math.Content.ToString());
                    break;
                case HtmlEntityInline entity:
                    text.Append(entity.Transcoded.ToString());
                    break;
                case LineBreakInline:
                    text.Append(' ');
                    break;
                case ContainerInline container:
                    text.Append(GetHeadingText(container));
                    break;
            }
        }
        return text.ToString().Trim();
    }

    private static string GetImageUnavailableText(LinkInline image)
    {
        var alt = new StringBuilder();
        AppendInlineText(image.FirstChild, alt);
        return alt.Length == 0 ? "[图片不可用]" : $"[图片不可用：{alt}]";
    }

    private static void AppendInlineText(Inline? inline, StringBuilder text)
    {
        for (var child = inline; child is not null; child = child.NextSibling)
        {
            switch (child)
            {
                case LiteralInline literal:
                    text.Append(literal.Content.ToString());
                    break;
                case CodeInline code:
                    text.Append(code.Content);
                    break;
                case HtmlEntityInline entity:
                    text.Append(entity.Transcoded.ToString());
                    break;
                case LineBreakInline:
                    text.Append(' ');
                    break;
            }
            if (child is ContainerInline nested)
                AppendInlineText(nested.FirstChild, text);
        }
    }

    private static string Slug(string text)
    {
        var slug = new StringBuilder();
        var separator = false;
        foreach (var character in text.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character))
            {
                if (separator && slug.Length > 0) slug.Append('-');
                slug.Append(character);
                separator = false;
            }
            else separator = true;
            if (slug.Length >= 100) break;
        }
        return slug.Length == 0 ? "section" : slug.ToString();
    }
}

internal sealed record MarkdownRenderDocument(string Html, IReadOnlyList<MarkdownOutlineItem> Outline, IReadOnlyList<MarkdownRichNode> RichNodes);
internal sealed record MarkdownOutlineItem(string Id, string Text, int Level, int Offset);
internal sealed record MarkdownRichNode(string Kind, int From, int To, string Text, string Label, int Target);
