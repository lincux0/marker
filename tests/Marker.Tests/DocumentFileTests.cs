using System.Text;
using Marker.App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class DocumentFileTests
{
    [TestMethod]
    public void ReadsUtf8BomAndPreservesCrlfAndFingerprintOnSave()
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "note.md");
        var original = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes("一\r\n二\r\n")).ToArray();
        File.WriteAllBytes(path, original);

        var loaded = DocumentFile.Read(path);
        Assert.AreEqual("一\n二\n", loaded.Text);
        Assert.AreEqual("utf-8", loaded.EncodingName);
        Assert.IsTrue(loaded.HasBom);
        Assert.AreEqual("CRLF", loaded.Newline);
        Assert.AreEqual(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(original)), loaded.Fingerprint);

        var saved = DocumentFile.Save(path, "改\n写", loaded.Format, loaded.Fingerprint);
        CollectionAssert.AreEqual(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes("改\r\n写")).ToArray(), File.ReadAllBytes(path));
        Assert.AreEqual("改\n写", saved.Text);
        Assert.AreNotEqual(loaded.Fingerprint, saved.Fingerprint);
    }

    [TestMethod]
    public void DetectsMixedNewlinesAndRequiresExplicitChoiceBeforeWriting()
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "mixed.md");
        File.WriteAllText(path, "a\r\nb\nc\rd", new UTF8Encoding(false));
        var loaded = DocumentFile.Read(path);
        Assert.AreEqual("a\nb\nc\nd", loaded.Text);
        Assert.AreEqual("Mixed", loaded.Newline);
        Assert.ThrowsException<InvalidOperationException>(() => DocumentFile.Save(path, loaded.Text, loaded.Format, loaded.Fingerprint));
        Assert.AreEqual("a\r\nb\nc\rd", File.ReadAllText(path));
    }

    [TestMethod]
    public void RejectsInvalidUtf8UntilEncodingIsExplicitlySelected()
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "legacy.md");
        File.WriteAllBytes(path, [0xD6, 0xD0, 0xCE, 0xC4]);
        Assert.ThrowsException<InvalidDataException>(() => DocumentFile.Read(path));
        var loaded = DocumentFile.Read(path, "gb18030");
        Assert.AreEqual("中文", loaded.Text);
        Assert.AreEqual("gb18030", loaded.EncodingName);
    }

    [TestMethod]
    public void RejectsExternalModificationAndNeverOverwritesExistingTargetWithoutFingerprint()
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "note.md");
        File.WriteAllText(path, "原文", new UTF8Encoding(false));
        var loaded = DocumentFile.Read(path);
        File.WriteAllText(path, "外部修改", new UTF8Encoding(false));
        Assert.ThrowsException<DocumentConflictException>(() => DocumentFile.Save(path, "我的修改", loaded.Format, loaded.Fingerprint));
        Assert.ThrowsException<DocumentConflictException>(() => DocumentFile.Save(path, "覆盖", loaded.Format, null));
        Assert.AreEqual("外部修改", File.ReadAllText(path));
    }

    [TestMethod]
    public void RejectsDeletedTargetAndDoesNotRecreateIt()
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "deleted.md");
        File.WriteAllText(path, "原文", new UTF8Encoding(false));
        var loaded = DocumentFile.Read(path);
        File.Delete(path);

        Assert.ThrowsException<DocumentConflictException>(() => DocumentFile.Save(path, "草稿", loaded.Format, loaded.Fingerprint));
        Assert.IsFalse(File.Exists(path));
    }

    [TestMethod]
    public void FingerprintDetectsSameLengthAndTimestampChangesAndRejectsPrecreatedNewTarget()
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "changed.md");
        File.WriteAllText(path, "aaaa", new UTF8Encoding(false));
        var loaded = DocumentFile.Read(path);
        var lastWriteTime = File.GetLastWriteTimeUtc(path);
        File.WriteAllText(path, "bbbb", new UTF8Encoding(false));
        File.SetLastWriteTimeUtc(path, lastWriteTime);

        Assert.AreEqual(loaded.Text.Length, File.ReadAllText(path).Length);
        Assert.AreEqual(lastWriteTime, File.GetLastWriteTimeUtc(path));
        Assert.ThrowsException<DocumentConflictException>(() => DocumentFile.Save(path, "我的文本", loaded.Format, loaded.Fingerprint));
        Assert.AreEqual("bbbb", File.ReadAllText(path));

        var newPath = Path.Combine(temp.Path, "created-after-new.md");
        File.WriteAllText(newPath, "外部新文件", new UTF8Encoding(false));
        Assert.ThrowsException<DocumentConflictException>(() => DocumentFile.Save(newPath, "草稿", DocumentFileFormat.Default, null));
        Assert.AreEqual("外部新文件", File.ReadAllText(newPath));
    }

    [TestMethod]
    public void RejectsReadonlyAndLockedTargetsAndPreservesTheirContent()
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "note.md");
        File.WriteAllText(path, "原文", new UTF8Encoding(false));
        var loaded = DocumentFile.Read(path);
        File.SetAttributes(path, File.GetAttributes(path) | FileAttributes.ReadOnly);
        try { Assert.ThrowsException<IOException>(() => DocumentFile.Save(path, "改", loaded.Format, loaded.Fingerprint)); }
        finally { File.SetAttributes(path, File.GetAttributes(path) & ~FileAttributes.ReadOnly); }

        using (var locked = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            Assert.ThrowsException<IOException>(() => DocumentFile.Save(path, "改", loaded.Format, loaded.Fingerprint));
        Assert.AreEqual("原文", File.ReadAllText(path));
    }

    [TestMethod]
    public void FailedTargetWriteLeavesExistingDirectoryUntouched()
    {
        using var temp = new TempDirectory();
        var targetDirectory = Path.Combine(temp.Path, "folder.md");
        Directory.CreateDirectory(targetDirectory);
        Assert.ThrowsException<IOException>(() => DocumentFile.Save(targetDirectory, "text", DocumentFileFormat.Default, null));
        Assert.IsTrue(Directory.Exists(targetDirectory));
        Assert.AreEqual(0, Directory.GetFiles(targetDirectory).Length);
    }

    private sealed class TempDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"marker-tests-{Guid.NewGuid():N}");
        public TempDirectory() => Directory.CreateDirectory(Path);
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
