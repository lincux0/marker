using System.Text;
using Marker.App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class PdfExportFileTests
{
    [TestMethod]
    public void ExportReplacesOnlyAnUnchangedPdfAndCleansTemporaryFiles()
    {
        var directory = Path.Combine(Path.GetTempPath(), "marker-pdf-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var path = Path.Combine(directory, "中文 导出.pdf");
            using var first = new MemoryStream(Encoding.UTF8.GetBytes("%PDF-1.7\nfirst"));
            PdfExportFile.Save(first, path, null);
            var fingerprint = PdfExportFile.Fingerprint(path);
            using var second = new MemoryStream(Encoding.UTF8.GetBytes("%PDF-1.7\nsecond"));
            PdfExportFile.Save(second, path, fingerprint);
            Assert.AreEqual("%PDF-1.7\nsecond", File.ReadAllText(path));
            second.Position = 0;
            Assert.ThrowsException<IOException>(() => PdfExportFile.Save(second, path, fingerprint));
            Assert.AreEqual("%PDF-1.7\nsecond", File.ReadAllText(path));
            var markdown = Path.Combine(directory, "source.md");
            File.WriteAllText(markdown, "原文");
            Assert.ThrowsException<IOException>(() => PdfExportFile.Save(second, markdown, null));
            Assert.AreEqual("原文", File.ReadAllText(markdown));
            using var unreadable = new MemoryStream();
            unreadable.Dispose();
            Assert.ThrowsException<ObjectDisposedException>(() => PdfExportFile.Save(unreadable, path, PdfExportFile.Fingerprint(path)));
            Assert.AreEqual("%PDF-1.7\nsecond", File.ReadAllText(path));
            CollectionAssert.AreEquivalent(new[] { "中文 导出.pdf", "source.md" }, Directory.GetFiles(directory).Select(Path.GetFileName).ToArray());
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
}
