using Marker.App;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class SettingsDatabaseTests
{
    [TestMethod]
    public void PersistsEverySettingAcrossIndependentLoads()
    {
        using var temp = new TempDirectory();
        _ = SettingsDatabase.Load(temp.Path);
        var expected = AppSettings.Default with
        {
            Theme = "dark", FontSize = 22, LineHeight = 1.9, LineWrapping = false, ViewMode = "read",
            ReducedMotion = true, WindowPlacement = new WindowPlacement(-900, 40, 1400, 900, true),
            ParagraphSpacing = 1.2, BodyFont = "dengxian", H1Font = "song", H2Font = "yahei",
            ColorPalette = "forest", HiddenToolbarActions = ["open", "statistics"]
        };

        SettingsDatabase.Save(temp.Path, expected);

        var reloaded = SettingsDatabase.Load(temp.Path);
        Assert.IsTrue(reloaded.CanSave);
        Assert.IsNull(reloaded.Warning);
        Assert.AreEqual(expected with { HiddenToolbarActions = reloaded.Settings.HiddenToolbarActions }, reloaded.Settings);
        CollectionAssert.AreEqual(expected.HiddenToolbarActions, reloaded.Settings.HiddenToolbarActions);
    }

    [TestMethod]
    public void ImportsValidLegacyJsonWithoutChangingIt()
    {
        using var temp = new TempDirectory();
        var legacy = AppSettings.Default with { Theme = "dark", FontSize = 18, ColorPalette = "ocean" };
        legacy.Save(temp.Path);
        var original = File.ReadAllBytes(Path.Combine(temp.Path, "settings.json"));

        var loaded = SettingsDatabase.Load(temp.Path);

        Assert.IsTrue(loaded.CanSave);
        Assert.AreEqual("dark", loaded.Settings.Theme);
        Assert.AreEqual(18, loaded.Settings.FontSize);
        CollectionAssert.AreEqual(original, File.ReadAllBytes(Path.Combine(temp.Path, "settings.json")));
        Assert.IsTrue(File.Exists(Path.Combine(temp.Path, "settings.db")));
    }

    [TestMethod]
    public void DamagedLegacyJsonIsPreservedAndDoesNotBlockDatabaseSaves()
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "settings.json");
        const string original = "{ damaged";
        File.WriteAllText(path, original);

        var first = SettingsDatabase.Load(temp.Path);
        Assert.IsTrue(first.CanSave);
        Assert.IsNotNull(first.Warning);
        Assert.AreEqual(AppSettings.Default, first.Settings);

        var changed = first.Settings with { Theme = "dark" };
        SettingsDatabase.Save(temp.Path, changed);
        Assert.AreEqual("dark", SettingsDatabase.Load(temp.Path).Settings.Theme);
        Assert.AreEqual(original, File.ReadAllText(path));
    }

    [DataTestMethod]
    [DataRow("not a database")]
    [DataRow("")]
    public void DamagedDatabaseIsPreservedAndDisablesWrites(string contents)
    {
        using var temp = new TempDirectory();
        var path = Path.Combine(temp.Path, "settings.db");
        File.WriteAllText(path, contents);
        var original = File.ReadAllBytes(path);

        var loaded = SettingsDatabase.LoadWithPendingChanges(temp.Path, AppSettings.Default,
            AppSettings.Default with { Theme = "dark" });

        Assert.IsFalse(loaded.CanSave);
        Assert.IsNotNull(loaded.Warning);
        Assert.AreEqual(AppSettings.Default.Theme, loaded.Settings.Theme);
        Assert.IsTrue(loaded.Warning.Contains("诊断：", StringComparison.Ordinal));
        if (contents.Length > 0)
            Assert.IsTrue(loaded.Warning.Contains("SQLite ", StringComparison.Ordinal));
        AssertStorageException(() => SettingsDatabase.Save(temp.Path, AppSettings.Default));
        CollectionAssert.AreEqual(original, File.ReadAllBytes(path));
    }

    [DataTestMethod]
    [DataRow(0)]
    [DataRow(2)]
    public void UnsupportedDatabaseSchemaIsPreservedAndDisablesWrites(int version)
    {
        using var temp = new TempDirectory();
        _ = SettingsDatabase.Load(temp.Path);
        var path = Path.Combine(temp.Path, "settings.db");
        using (var connection = Open(path))
        using (var command = connection.CreateCommand())
        {
            command.CommandText = $"PRAGMA user_version = {version}";
            command.ExecuteNonQuery();
        }
        var original = File.ReadAllBytes(path);

        var loaded = SettingsDatabase.LoadWithPendingChanges(temp.Path, AppSettings.Default,
            AppSettings.Default with { Theme = "dark" });
        Assert.IsFalse(loaded.CanSave);
        Assert.AreEqual(AppSettings.Default.Theme, loaded.Settings.Theme);
        Assert.IsTrue(loaded.Warning!.Contains(path, StringComparison.Ordinal));
        Assert.IsTrue(loaded.Warning.Contains($"设置数据库版本 {version} 不兼容", StringComparison.Ordinal));
        Assert.ThrowsException<InvalidDataException>(() => SettingsDatabase.Save(temp.Path, AppSettings.Default));
        CollectionAssert.AreEqual(original, File.ReadAllBytes(path));
    }

    [TestMethod]
    public void InvalidDatabasePayloadReportsSafeReasonAndPathWithoutLeakingPayload()
    {
        using var temp = new TempDirectory();
        _ = SettingsDatabase.Load(temp.Path);
        var path = Path.Combine(temp.Path, "settings.db");
        const string payload = "{\"schemaVersion\":1,\"secret\":\"PAYLOAD_SENTINEL\",";
        using (var connection = Open(path))
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "UPDATE settings SET payload = $payload WHERE id = 1";
            command.Parameters.AddWithValue("$payload", payload);
            command.ExecuteNonQuery();
        }
        var original = File.ReadAllBytes(path);

        var loaded = SettingsDatabase.LoadWithPendingChanges(temp.Path, AppSettings.Default,
            AppSettings.Default with { Theme = "dark" });

        Assert.IsFalse(loaded.CanSave);
        Assert.IsTrue(loaded.Warning!.Contains(path, StringComparison.Ordinal));
        Assert.IsTrue(loaded.Warning.Contains("设置内容无法解析", StringComparison.Ordinal));
        Assert.IsFalse(loaded.Warning.Contains("PAYLOAD_SENTINEL", StringComparison.Ordinal));
        CollectionAssert.AreEqual(original, File.ReadAllBytes(path));
    }

    [DataTestMethod]
    [DataRow(0)]
    [DataRow(2)]
    public void SameNamedTableCannotMasqueradeAsSupportedDatabaseVersion(int version)
    {
        using var temp = new TempDirectory();
        _ = SettingsDatabase.Load(temp.Path);
        var path = Path.Combine(temp.Path, "settings.db");
        using (var connection = Open(path))
        using (var command = connection.CreateCommand())
        {
            command.CommandText = $"PRAGMA user_version = {version}; CREATE TABLE pragma_user_version (user_version INTEGER); INSERT INTO pragma_user_version VALUES (1)";
            command.ExecuteNonQuery();
        }
        var original = File.ReadAllBytes(path);

        Assert.IsFalse(SettingsDatabase.Load(temp.Path).CanSave);
        Assert.ThrowsException<SqliteException>(() => SettingsDatabase.Save(temp.Path, AppSettings.Default));
        CollectionAssert.AreEqual(original, File.ReadAllBytes(path));
    }

    [TestMethod]
    public void RecoversAfterDatabaseLockAndMergesOnlyPendingChanges()
    {
        using var temp = new TempDirectory();
        var stored = AppSettings.Default with { Theme = "dark", FontSize = 21, LineWrapping = false };
        SettingsDatabase.Save(temp.Path, stored);
        var baseline = AppSettings.Default;
        var pending = baseline with { Theme = "light", AutoHideToolbar = true };
        var path = Path.Combine(temp.Path, "settings.db");

        using (var connection = Open(path))
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "BEGIN EXCLUSIVE; UPDATE settings SET payload = payload WHERE id = 1";
            command.ExecuteNonQuery();
            Assert.IsFalse(SettingsDatabase.Load(temp.Path).CanSave);
            command.CommandText = "ROLLBACK";
            command.ExecuteNonQuery();
        }

        var loaded = SettingsDatabase.LoadWithPendingChanges(temp.Path, baseline, pending);

        Assert.IsTrue(loaded.CanSave, loaded.Warning);
        Assert.AreEqual("light", loaded.Settings.Theme);
        Assert.IsTrue(loaded.Settings.AutoHideToolbar);
        Assert.AreEqual(21, loaded.Settings.FontSize);
        Assert.IsFalse(loaded.Settings.LineWrapping);
    }

    [TestMethod]
    public void FutureRecordSchemaIsPreservedAndDisablesWrites()
    {
        using var temp = new TempDirectory();
        _ = SettingsDatabase.Load(temp.Path);
        var path = Path.Combine(temp.Path, "settings.db");
        using (var connection = Open(path))
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "UPDATE settings SET schema_version = 2 WHERE id = 1";
            command.ExecuteNonQuery();
        }
        var original = File.ReadAllBytes(path);

        Assert.IsFalse(SettingsDatabase.Load(temp.Path).CanSave);
        Assert.ThrowsException<InvalidDataException>(() => SettingsDatabase.Save(temp.Path, AppSettings.Default));
        CollectionAssert.AreEqual(original, File.ReadAllBytes(path));
    }

    [TestMethod]
    public void FailedTransactionLeavesPreviouslySavedSettingsIntact()
    {
        using var temp = new TempDirectory();
        var original = AppSettings.Default with { Theme = "dark", FontSize = 19 };
        SettingsDatabase.Save(temp.Path, original);
        using (var connection = Open(Path.Combine(temp.Path, "settings.db")))
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "CREATE TRIGGER reject_settings_update BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'test failure'); END";
            command.ExecuteNonQuery();
        }

        Assert.ThrowsException<SqliteException>(() => SettingsDatabase.Save(temp.Path, original with { Theme = "light" }));

        using (var connection = Open(Path.Combine(temp.Path, "settings.db")))
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "DROP TRIGGER reject_settings_update";
            command.ExecuteNonQuery();
        }
        var reloaded = SettingsDatabase.Load(temp.Path).Settings;
        Assert.AreEqual(original.Theme, reloaded.Theme);
        Assert.AreEqual(original.FontSize, reloaded.FontSize);
    }

    [TestMethod]
    public void InvalidSettingsAreRejectedWithoutChangingStoredValue()
    {
        using var temp = new TempDirectory();
        var original = AppSettings.Default with { Theme = "dark" };
        SettingsDatabase.Save(temp.Path, original);

        Assert.ThrowsException<ArgumentException>(() => SettingsDatabase.Save(temp.Path, original with { FontSize = 100 }));

        Assert.AreEqual(original.Theme, SettingsDatabase.Load(temp.Path).Settings.Theme);
    }

    private static SqliteConnection Open(string path)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
        connection.Open();
        return connection;
    }

    private static void AssertStorageException(Action action)
    {
        try
        {
            action();
            Assert.Fail("Expected a storage exception.");
        }
        catch (Exception error) when (error is IOException or InvalidDataException or SqliteException)
        {
        }
    }

    private sealed class TempDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"marker-settings-db-tests-{Guid.NewGuid():N}");
        public TempDirectory() => Directory.CreateDirectory(Path);
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
