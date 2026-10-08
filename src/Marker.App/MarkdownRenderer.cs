using System.Linq;
using System.Text;
using Markdig;
using Markdig.Extensions.Tables;
using Markdig.Extensions.EmphasisExtras;
using Markdig.Renderers.Html;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace Marker.App;

internal static class MarkdownRenderer
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UsePreciseSourceLocation()
        .UsePipeTables()
        .UseTaskLists()
        .UseAutoLinks()
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
            if (string.IsNullOrWhiteSpace(resolved)) image.Remove();
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

        return new MarkdownRenderDocument(document.ToHtml(Pipeline), outline);
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

internal sealed record MarkdownRenderDocument(string Html, IReadOnlyList<MarkdownOutlineItem> Outline);
internal sealed record MarkdownOutlineItem(string Id, string Text, int Level, int Offset);
