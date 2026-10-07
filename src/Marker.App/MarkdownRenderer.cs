using System.Linq;
using Markdig;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace Marker.App;

internal static class MarkdownRenderer
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UsePipeTables()
        .UseTaskLists()
        .UseAutoLinks()
        .UseEmphasisExtras()
        .DisableHtml()
        .Build();

    public static string Render(string markdown) => Render(markdown, null);

    public static string Render(string markdown, Func<string, string?>? resolveImage)
    {
        var document = Markdown.Parse(markdown, Pipeline);
        foreach (var image in document.Descendants<LinkInline>().Where(inline => inline.IsImage).ToArray())
        {
            var resolved = image.Url is null ? null : resolveImage?.Invoke(image.Url);
            if (string.IsNullOrWhiteSpace(resolved)) image.Remove();
            else image.Url = resolved;
        }
        return document.ToHtml(Pipeline);
    }
}
