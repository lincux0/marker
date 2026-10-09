using Marker.App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class MarkdownLinkResolverTests
{
    [TestMethod]
    public void ResolvesRealRelativeAndAbsoluteLocalPaths()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"marker-links-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            var source = Path.Combine(directory, "source.md");
            var target = Path.Combine(directory, "note with space.txt");
            File.WriteAllText(target, "ok");
            Assert.IsTrue(MarkdownLinkResolver.TryResolveLocalPath("note%20with%20space.txt", source, out var relative));
            Assert.AreEqual(target, relative);

            Assert.IsTrue(MarkdownLinkResolver.TryResolveLocalPath(new Uri(target).AbsoluteUri, source, out var absolute));
            Assert.AreEqual(target, absolute);
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    [TestMethod]
    public void RejectsEncodedNetworkDeviceAdsAndExecutableTargets()
    {
        var source = Path.Combine(Path.GetTempPath(), "marker-source.md");
        foreach (var target in new[] { "%5c%5cserver%5cshare%5cfile.md", "%5c%5c%3f%5cC%3a%5cfile.md", "note.md:stream" })
            Assert.IsFalse(MarkdownLinkResolver.TryResolveLocalPath(target, source, out _), target);

        foreach (var extension in new[] { ".exe", ".py", ".pyw", ".rb", ".pl", ".msix", ".appx", ".lnk", ".url" })
            Assert.IsTrue(MarkdownLinkResolver.IsDangerousExtension($"file{extension}"), extension);
        Assert.IsFalse(MarkdownLinkResolver.IsDangerousExtension("notes.md"));
    }

    [TestMethod]
    public void RejectsPathsThatTraverseReparsePoints()
    {
        var root = Path.Combine(Path.GetTempPath(), $"marker-link-root-{Guid.NewGuid():N}");
        var outside = Path.Combine(Path.GetTempPath(), $"marker-link-outside-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        Directory.CreateDirectory(outside);
        File.WriteAllText(Path.Combine(outside, "secret.md"), "secret");
        try
        {
            try { Directory.CreateSymbolicLink(Path.Combine(root, "linked"), outside); }
            catch (Exception error) when (error is UnauthorizedAccessException or PlatformNotSupportedException or IOException)
            {
                Assert.Inconclusive($"This host cannot create a directory symlink: {error.GetType().Name}.");
            }
            Assert.IsFalse(MarkdownLinkResolver.TryResolveLocalPath("linked/secret.md", Path.Combine(root, "source.md"), out _));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
            Directory.Delete(outside, recursive: true);
        }
    }
}
