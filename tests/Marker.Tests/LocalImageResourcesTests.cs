using System;
using System.IO;
using System.Security;
using Marker.App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class LocalImageResourcesTests
{
    private static readonly byte[] PngHeader = [137, 80, 78, 71, 13, 10, 26, 10];

    [TestMethod]
    public void ResolvesOnlyBoundedRasterFilesAndRevokesThemWhenSessionChanges()
    {
        var root = NewTempDirectory();
        try
        {
            File.WriteAllBytes(Path.Combine(root, "image.png"), PngHeader);
            Directory.CreateDirectory(Path.Combine(root, "assets"));
            File.WriteAllBytes(Path.Combine(root, "assets", "a.png"), PngHeader);
            File.WriteAllText(Path.Combine(root, "fake.png"), "not a PNG");
            File.WriteAllBytes(Path.Combine(root, "vector.svg"), "<svg/>"u8.ToArray());
            using (var oversized = new FileStream(Path.Combine(root, "large.png"), FileMode.CreateNew))
                oversized.SetLength(16 * 1024 * 1024 + 1);

            var resources = new LocalImageResources();
            const string session = "0123456789abcdef0123456789abcdef";
            resources.SetRoot(root, session);
            var staleResolver = resources.CreateResolver(session);
            resources.SetRoot(root, session);
            Assert.IsNull(staleResolver("image.png"), "A background render from before a root reset must not register resources against the new root.");
            var url = resources.Resolve("image.png");
            var dotRelativeUrl = resources.Resolve("./assets/a.png");
            Assert.IsNotNull(dotRelativeUrl);
            Assert.AreEqual(dotRelativeUrl, resources.Resolve("assets/a.png"));
            Assert.IsTrue(resources.TryRead(dotRelativeUrl, out _, out _));

            Assert.IsNotNull(url);
            StringAssert.StartsWith(url, $"https://document.marker.example/{session}/image/");
            Assert.IsFalse(url.Contains(root, StringComparison.OrdinalIgnoreCase));
            resources.SetRoot(root, session);
            Assert.IsFalse(resources.TryRead(url, out _, out _), "Resetting the root must revoke previously issued opaque URLs.");
            url = resources.Resolve("image.png");
            Assert.IsNotNull(url);
            Assert.IsTrue(resources.TryRead(url, out var bytes, out var mime));
            CollectionAssert.AreEqual(PngHeader, bytes);
            Assert.AreEqual("image/png", mime);

            Assert.IsNull(resources.Resolve("%2e%2e%2foutside.png"));
            Assert.IsNull(resources.Resolve("%252e%252e%252foutside.png"));
            Assert.IsNull(resources.Resolve("https://example.com/remote.png"));
            Assert.IsNull(resources.Resolve("\\\\server\\share\\image.png"));
            Assert.IsNull(resources.Resolve("vector.svg"));
            Assert.IsNull(resources.Resolve("fake.png"));
            Assert.IsNull(resources.Resolve("large.png"));
            Assert.IsFalse(resources.TryRead(url + "?anything", out _, out _));

            resources.SetRoot(root, "fedcba9876543210fedcba9876543210");
            Assert.IsFalse(resources.TryRead(url, out _, out _));
            resources.SetRoot(null, "fedcba9876543210fedcba9876543210");
            Assert.IsNull(resources.Resolve("image.png"));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [TestMethod]
    public void RejectsResourcesReachedThroughReparsePoints()
    {
        var root = NewTempDirectory();
        var outside = NewTempDirectory();
        try
        {
            File.WriteAllBytes(Path.Combine(outside, "image.png"), PngHeader);
            try
            {
                Directory.CreateSymbolicLink(Path.Combine(root, "linked"), outside);
            }
            catch (Exception exception) when (exception is UnauthorizedAccessException or IOException or PlatformNotSupportedException or SecurityException)
            {
                Assert.Inconclusive($"This host cannot create a directory symlink for the reparse-point check: {exception.GetType().Name}.");
            }

            var resources = new LocalImageResources();
            resources.SetRoot(root, "0123456789abcdef0123456789abcdef");
            Assert.IsNull(resources.Resolve("linked/image.png"));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
            Directory.Delete(outside, recursive: true);
        }
    }

    private static string NewTempDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "Marker.ImageTests." + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        return directory;
    }
}
