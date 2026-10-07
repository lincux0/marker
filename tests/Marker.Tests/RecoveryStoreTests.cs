using System.Text.Json;
using Marker.App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class RecoveryStoreTests
{
    [TestMethod]
    public void SavesLoadsListsAndDeletesDraftsAsJsonFiles()
    {
        using var temp = new TempDirectory();
        var store = new RecoveryStore(temp.Path);
        var draft = new RecoveryDraft(Guid.NewGuid(), 7, DateTimeOffset.UtcNow, "C:\\notes\\a.md", "草稿\n", DocumentFileFormat.Default, "fingerprint");

        store.Save(draft);
        var loaded = store.Load(draft.DocId);
        Assert.IsNull(loaded.Error);
        Assert.AreEqual(draft, loaded.Draft);

        var updatedDraft = draft with { Version = 8, Text = "更新草稿\n" };
        store.Save(updatedDraft);
        var updated = store.Load(draft.DocId);
        Assert.IsNull(updated.Error);
        Assert.AreEqual(8L, updated.Draft?.Version);
        Assert.AreEqual("更新草稿\n", updated.Draft?.Text);
        Assert.AreEqual(1, store.List().Count);
        store.Delete(draft.DocId);
        Assert.AreEqual(0, store.List().Count);
    }

    [TestMethod]
    public void WritesApplicationVersionAndLoadsSchemaOneDraftWithoutIt()
    {
        using var temp = new TempDirectory();
        var store = new RecoveryStore(temp.Path);
        var written = new RecoveryDraft(Guid.NewGuid(), 1, DateTimeOffset.UtcNow, null, "新草稿", DocumentFileFormat.Default, null);
        store.Save(written);

        using (var savedJson = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(temp.Path, $"{written.DocId:N}.json"))))
        {
            Assert.IsTrue(savedJson.RootElement.TryGetProperty("applicationVersion", out var version));
            Assert.IsFalse(string.IsNullOrWhiteSpace(version.GetString()));
        }

        var legacyId = Guid.NewGuid();
        var legacyPath = Path.Combine(temp.Path, $"{legacyId:N}.json");
        var legacyJson = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            docId = legacyId,
            version = 4,
            updatedUtc = DateTimeOffset.UtcNow,
            originalPath = (string?)null,
            text = "旧草稿",
            format = new { encodingName = "utf-8", hasBom = false, newline = "LF" },
            fingerprint = (string?)null
        });
        File.WriteAllText(legacyPath, legacyJson);

        var loaded = store.Load(legacyId);
        Assert.IsNull(loaded.Error);
        Assert.AreEqual("旧草稿", loaded.Draft?.Text);
        Assert.AreEqual(4L, loaded.Draft?.Version);
        Assert.AreEqual(DocumentFileFormat.Default, loaded.Draft?.Format);
        Assert.IsTrue(File.Exists(legacyPath));
    }

    [DataTestMethod]
    [DataRow("{ broken", "损坏")]
    [DataRow("{\"schemaVersion\":99}", "未知")]
    public void KeepsCorruptOrUnknownVersionFilesAndReturnsAnError(string json, string _)
    {
        using var temp = new TempDirectory();
        var store = new RecoveryStore(temp.Path);
        var id = Guid.NewGuid();
        var path = Path.Combine(temp.Path, $"{id:N}.json");
        File.WriteAllText(path, json);

        var result = store.Load(id);
        Assert.IsNull(result.Draft);
        Assert.IsNotNull(result.Error);
        Assert.IsTrue(File.Exists(path));
        Assert.AreEqual(json, File.ReadAllText(path));
        Assert.AreEqual(result.Error, store.List().Single().Error);
    }

    private sealed class TempDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"marker-recovery-tests-{Guid.NewGuid():N}");
        public TempDirectory() => Directory.CreateDirectory(Path);
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
