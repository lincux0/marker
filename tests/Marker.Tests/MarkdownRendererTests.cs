using System;
using System.Diagnostics;
using System.Linq;
using Marker.App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class MarkdownRendererTests
{
    public TestContext TestContext { get; set; } = null!;

    [TestMethod]
    public void RendersLongControlledDocumentWithoutLosingTail()
    {
        var markdown = string.Concat(Enumerable.Repeat("## 中文标题 😀\n\n一段 **加粗** 与 `代码`。\n\n- 列表项\n\n", 3000)) + "\n末尾标记\n";
        MarkdownRenderer.Render("# warmup");
        var timer = Stopwatch.StartNew();
        var html = MarkdownRenderer.Render(markdown);
        timer.Stop();
        StringAssert.Contains(html, "末尾标记");
        StringAssert.Contains(html, "<strong>加粗</strong>");
        TestContext.WriteLine($"Controlled document: {markdown.Length} UTF-16 units, {html.Length} HTML units, parse {timer.Elapsed.TotalMilliseconds:F2} ms. Not an end-to-end latency/IME benchmark.");
    }

    [TestMethod]
    public void RendersCommonMarkdownAndSelectedGfmWithoutPassingThroughRawHtml()
    {
        var markdown = "# 标题\n\n- 普通列表\n- [x] 任务\n\n| 列 | 值 |\n| --- | --- |\n| A | B |\n\n~~删除~~ https://example.com\n\n<script>alert(1)</script>";
        var html = MarkdownRenderer.Render(markdown);

        StringAssert.Contains(html, "<h1 id=\"heading-标题\">标题</h1>");
        StringAssert.Contains(html, "<ul class=\"contains-task-list\">");
        StringAssert.Contains(html, "<table>");
        StringAssert.Contains(html, "<del>删除</del>");
        StringAssert.Contains(html, "href=\"https://example.com\"");
        Assert.IsFalse(html.Contains("<script>", StringComparison.OrdinalIgnoreCase));
        StringAssert.Contains(html, "&lt;script&gt;");
    }

    [TestMethod]
    public void RewritesControlledImagesAndKeepsRejectedImagesAsSafeText()
    {
        var html = MarkdownRenderer.Render("[link](https://example.com) ![allowed](photo.png) ![rejected](https://evil.example/x.png)",
            url => url == "photo.png" ? "https://document.marker.example/0123456789abcdef0123456789abcdef/image/0123456789abcdef0123456789abcdef0123456789abcdef" : null);

        StringAssert.Contains(html, "href=\"https://example.com\"");
        StringAssert.Contains(html, "src=\"https://document.marker.example/0123456789abcdef0123456789abcdef/image/0123456789abcdef0123456789abcdef0123456789abcdef\"");
        Assert.IsFalse(html.Contains("evil.example", StringComparison.Ordinal));
        StringAssert.Contains(html, "[图片不可用：rejected]");
        Assert.AreEqual(1, html.Split("<img", StringSplitOptions.None).Length - 1);
    }

    [TestMethod]
    public void ShowsUnavailableImageAltWithoutExposingRejectedSource()
    {
        const string privatePath = "C:/Users/alice/private/photo.png";
        var html = MarkdownRenderer.Render($"![诊断图]({privatePath}) ![]({privatePath}) ![诊断 **粗体** `代码`](missing.png)");

        StringAssert.Contains(html, "[图片不可用：诊断图]");
        StringAssert.Contains(html, "[图片不可用]");
        StringAssert.Contains(html, "[图片不可用：诊断 粗体 代码]");
        Assert.IsFalse(html.Contains(privatePath, StringComparison.Ordinal));
        Assert.IsFalse(html.Contains("<img", StringComparison.Ordinal));
    }

    [TestMethod]
    public void BuildsOutlineAndHtmlFromTheSameAstWithUtf16HeadingOffsets()
    {
        var markdown = "前言 😀\n\n# 标题 **加粗**\n\n### 标题 **加粗**\n\n## [链接](https://example.com)";
        var result = MarkdownRenderer.RenderDocument(markdown);

        Assert.AreEqual(3, result.Outline.Count);
        Assert.AreEqual("标题 加粗", result.Outline[0].Text);
        Assert.AreEqual(1, result.Outline[0].Level);
        Assert.AreEqual(markdown.IndexOf("# 标题", StringComparison.Ordinal), result.Outline[0].Offset);
        Assert.AreEqual("heading-标题-加粗", result.Outline[0].Id);
        Assert.AreEqual("heading-标题-加粗-2", result.Outline[1].Id);
        Assert.AreEqual("链接", result.Outline[2].Text);
        StringAssert.Contains(result.Html, "id=\"heading-标题-加粗\"");
        StringAssert.Contains(result.Html, "id=\"heading-标题-加粗-2\"");
        StringAssert.Contains(result.Html, "<h2 id=\"heading-链接\">");
    }

    [TestMethod]
    public void DecodesHtmlEntitiesInOutlineWithoutDecodingLiteralCode()
    {
        var result = MarkdownRenderer.RenderDocument("# A &amp; B &#x1F600; and `&amp;`");

        Assert.AreEqual("A & B 😀 and &amp;", result.Outline.Single().Text);
        StringAssert.Contains(result.Html, "A &amp; B 😀 and <code>&amp;amp;</code>");
    }

    [TestMethod]
    public void MeasuresM3ControlledDocumentSizesAndPreservesTheTail()
    {
        foreach (var size in new[] { 65_536, 262_144, 1_000_000 })
        {
            const string paragraph = "一段中文 😀 **加粗** 与 `代码`，用于长文基线。\n\n";
            var text = "# 基线\n\n" + string.Concat(Enumerable.Repeat(paragraph, (size + paragraph.Length - 1) / paragraph.Length));
            text = text[..(size - 5)] + "\n末尾标记";
            var timer = Stopwatch.StartNew();
            var result = MarkdownRenderer.RenderDocument(text);
            timer.Stop();
            StringAssert.Contains(result.Html, "末尾标记");
            Assert.AreEqual(1, result.Outline.Count);
            TestContext.WriteLine($"M3 baseline: {text.Length} UTF-16 units, {result.Html.Length} HTML units, parse {timer.Elapsed.TotalMilliseconds:F2} ms. Controlled single sample, not UI latency or a performance guarantee.");
        }
    }

    [TestMethod]
    public void KeepsCommonMarkAndSelectedGfmOutputWithPlainCodeBlocks()
    {
        var markdown = "Setext\n---\n\n> quote\n\n1. ordered\n\n```csharp\nvar x = 1;\n```\n\n~~gone~~ ++literal++";
        var result = MarkdownRenderer.RenderDocument(markdown);

        Assert.AreEqual(1, result.Outline.Count);
        Assert.AreEqual("Setext", result.Outline[0].Text);
        StringAssert.Contains(result.Html, "<blockquote>");
        StringAssert.Contains(result.Html, "<ol>");
        StringAssert.Contains(result.Html, "<pre><code class=\"language-csharp\">var x = 1;");
        StringAssert.Contains(result.Html, "<del>gone</del>");
        StringAssert.Contains(result.Html, "++literal++");
    }

    [TestMethod]
    public void PreservesPipeTableAlignmentWithSanitizerSafeAttributes()
    {
        var result = MarkdownRenderer.RenderDocument("| 左对齐 | 居中 | 右对齐 |\n| :--- | :---: | ---: |\n| 左 | 中 | 右 |");

        StringAssert.Contains(result.Html, "align=\"left\"");
        StringAssert.Contains(result.Html, "align=\"center\"");
        StringAssert.Contains(result.Html, "align=\"right\"");
    }
}
