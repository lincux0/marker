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

        StringAssert.Contains(html, "<h1>标题</h1>");
        StringAssert.Contains(html, "<ul class=\"contains-task-list\">");
        StringAssert.Contains(html, "<table>");
        StringAssert.Contains(html, "<del>删除</del>");
        StringAssert.Contains(html, "href=\"https://example.com\"");
        Assert.IsFalse(html.Contains("<script>", StringComparison.OrdinalIgnoreCase));
        StringAssert.Contains(html, "&lt;script&gt;");
    }
}
