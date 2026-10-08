using System.Text.Json;
using Marker.App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class AppSettingsTests
{
    [TestMethod]
    public void SavesAndLoadsVersionedSettings()
    {
        using var temp = new TempDirectory();
        var settings = AppSettings.Default with { Theme = "dark", FontSize = 20, LineHeight = 1.8, LineWrapping = false, ViewMode = "read" };

        settings.Save(temp.Path);
        var saved = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(temp.Path, "settings.json")));
        Assert.AreEqual(AppSettings.CurrentSchemaVersion, saved.RootElement.GetProperty("schemaVersion").GetInt32());
        Assert.IsFalse(string.IsNullOrWhiteSpace(saved.RootElement.GetProperty("applicationVersion").GetString()));

        var loaded = AppSettings.Load(temp.Path);
        Assert.IsNull(loaded.Warning);
        Assert.IsTrue(loaded.CanSave);
        Assert.AreEqual(settings, loaded.Settings);
    }

    [TestMethod]
    public void ReplacesOnlyInvalidFieldsWithDefaults()
    {
        using var temp = new TempDirectory();
        Directory.CreateDirectory(temp.Path);
        File.WriteAllText(Path.Combine(temp.Path, "settings.json"), """
            {"schemaVersion":1,"applicationVersion":"1.0","theme":"solarized","fontSize":20,"lineHeight":1.5,"lineWrapping":true,"viewMode":"read"}
            """);

        var loaded = AppSettings.Load(temp.Path);
        Assert.IsTrue(loaded.CanSave);
        Assert.IsNotNull(loaded.Warning);
        Assert.AreEqual(AppSettings.Default.Theme, loaded.Settings.Theme);
        Assert.AreEqual(20, loaded.Settings.FontSize);
        Assert.AreEqual("read", loaded.Settings.ViewMode);
    }

    [TestMethod]
    public void WrongJsonValueKindsFallBackWithoutThrowing()
    {
        using var temp = new TempDirectory();
        Directory.CreateDirectory(temp.Path);
        File.WriteAllText(Path.Combine(temp.Path, "settings.json"), """
            {"schemaVersion":1,"applicationVersion":"1.0","theme":17,"fontSize":"20","lineHeight":{},"lineWrapping":1,"viewMode":[]}
            """);

        var loaded = AppSettings.Load(temp.Path);
        Assert.IsTrue(loaded.CanSave);
        Assert.IsNotNull(loaded.Warning);
        Assert.AreEqual(AppSettings.Default.Theme, loaded.Settings.Theme);
        Assert.AreEqual(AppSettings.Default.FontSize, loaded.Settings.FontSize);
        Assert.AreEqual(AppSettings.Default.LineHeight, loaded.Settings.LineHeight);
        Assert.AreEqual(AppSettings.Default.LineWrapping, loaded.Settings.LineWrapping);
        Assert.AreEqual(AppSettings.Default.ViewMode, loaded.Settings.ViewMode);
    }

    [TestMethod]
    public void MissingSchemaOneFieldsUseDefaultsAndReportMigration()
    {
        using var temp = new TempDirectory();
        Directory.CreateDirectory(temp.Path);
        var path = Path.Combine(temp.Path, "settings.json");
        const string legacy = "{\"schemaVersion\":1}";
        File.WriteAllText(path, legacy);

        var loaded = AppSettings.Load(temp.Path);
        Assert.IsTrue(loaded.CanSave);
        Assert.IsNotNull(loaded.Warning);
        Assert.AreEqual(AppSettings.Default, loaded.Settings);
        Assert.AreEqual(legacy, File.ReadAllText(path));
    }

    [DataTestMethod]
    [DataRow("{ broken")]
    [DataRow("{\"schemaVersion\":2,\"theme\":\"dark\"}")]
    [DataRow("{\"schemaVersion\":\"1\"}")]
    [DataRow("{\"schemaVersion\":true}")]
    public void PreservesMalformedAndFutureSettingsFiles(string original)
    {
        using var temp = new TempDirectory();
        Directory.CreateDirectory(temp.Path);
        var path = Path.Combine(temp.Path, "settings.json");
        File.WriteAllText(path, original);

        var loaded = AppSettings.Load(temp.Path);
        Assert.IsFalse(loaded.CanSave);
        Assert.IsNotNull(loaded.Warning);
        Assert.AreEqual(original, File.ReadAllText(path));
    }

    private sealed class TempDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"marker-settings-tests-{Guid.NewGuid():N}");
        public TempDirectory() => Directory.CreateDirectory(Path);
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
