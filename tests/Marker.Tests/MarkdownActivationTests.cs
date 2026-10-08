using Marker.App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class MarkdownActivationTests
{
    [TestMethod]
    public void AcceptsOnlyFullyQualifiedMarkdownPaths()
    {
        var root = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "Marker Activation"));
        Assert.IsTrue(MarkdownActivation.TryNormalizePath(Path.Combine(root, "note.MD"), out var md));
        Assert.AreEqual(Path.Combine(root, "note.MD"), md);
        Assert.IsTrue(MarkdownActivation.TryNormalizePath(Path.Combine(root, "note.markdown"), out _));
        Assert.IsFalse(MarkdownActivation.TryNormalizePath("note.md", out _));
        Assert.IsFalse(MarkdownActivation.TryNormalizePath(Path.Combine(root, "note.txt"), out _));
        Assert.IsFalse(MarkdownActivation.TryNormalizePath(null, out _));
    }
}
