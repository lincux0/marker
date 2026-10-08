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
        var settings = AppSettings.Default with
        {
            Theme = "dark", FontSize = 20, LineHeight = 1.8, LineWrapping = false, ViewMode = "read",
            ReducedMotion = true, WindowPlacement = new WindowPlacement(-1200, 80, 1100, 760, true),
            ParagraphSpacing = 0.8, BodyFont = "yahei", H1Font = "song", H2Font = "dengxian", ColorPalette = "ocean"
        };

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
    public void MissingM4SettingsRemainCompatibleWithSchemaOne()
    {
        using var temp = new TempDirectory();
        Directory.CreateDirectory(temp.Path);
        File.WriteAllText(Path.Combine(temp.Path, "settings.json"), """
            {"schemaVersion":1,"applicationVersion":"1.0","theme":"system","fontSize":16,"lineHeight":1.5,"lineWrapping":true,"viewMode":"split"}
            """);

        var loaded = AppSettings.Load(temp.Path);
        Assert.IsNull(loaded.Warning);
        Assert.IsTrue(loaded.CanSave);
        Assert.IsFalse(loaded.Settings.ReducedMotion);
        Assert.IsNull(loaded.Settings.WindowPlacement);
        Assert.AreEqual(0.5, loaded.Settings.ParagraphSpacing);
        Assert.AreEqual("system", loaded.Settings.BodyFont);
        Assert.AreEqual("song", loaded.Settings.H1Font);
        Assert.AreEqual("song", loaded.Settings.H2Font);
        Assert.AreEqual("lavender", loaded.Settings.ColorPalette);
    }

    [TestMethod]
    public void ClampsRestoredPlacementInsideSelectedMonitorWorkArea()
    {
        var saved = new WindowPlacement(-5000, 900, 1600, 1000, false);
        var clamped = WindowPlacement.ClampToWorkArea(saved, -1920, 0, 0, 1040, 800, 560);

        Assert.AreEqual(-1920, clamped.Left);
        Assert.AreEqual(40, clamped.Top);
        Assert.AreEqual(1600, clamped.Width);
        Assert.AreEqual(1000, clamped.Height);
    }

    [TestMethod]
    public void InvalidWindowPlacementFallsBackWithoutBlockingOtherSettings()
    {
        using var temp = new TempDirectory();
        Directory.CreateDirectory(temp.Path);
        File.WriteAllText(Path.Combine(temp.Path, "settings.json"), """
            {"schemaVersion":1,"applicationVersion":"1.0","theme":"dark","fontSize":16,"lineHeight":1.5,"lineWrapping":true,"viewMode":"split","windowPlacement":{"left":0,"top":0,"width":50000,"height":850,"maximized":false}}
            """);

        var loaded = AppSettings.Load(temp.Path);
        Assert.IsTrue(loaded.CanSave);
        Assert.IsNotNull(loaded.Warning);
        Assert.AreEqual("dark", loaded.Settings.Theme);
        Assert.IsNull(loaded.Settings.WindowPlacement);
    }

    [TestMethod]
    public void ClampNeverPlacesWindowOutsideSmallerThanMinimumWorkArea()
    {
        var clamped = WindowPlacement.ClampToWorkArea(new WindowPlacement(500, 500, 1200, 850, false),
            0, 0, 640, 480, 720, 480);

        Assert.AreEqual(0, clamped.Left);
        Assert.AreEqual(0, clamped.Top);
        Assert.AreEqual(640, clamped.Width);
        Assert.AreEqual(480, clamped.Height);
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
    public void InvalidNewFieldsFallBackIndividuallyAndValidFieldsRoundTrip()
    {
        using var temp = new TempDirectory();
        File.WriteAllText(Path.Combine(temp.Path, "settings.json"), """
            {"schemaVersion":1,"paragraphSpacing":3,"bodyFont":"comic","h1Font":"yahei","h2Font":7,"colorPalette":"ocean"}
            """);

        var loaded = AppSettings.Load(temp.Path);
        Assert.IsTrue(loaded.CanSave);
        Assert.IsNotNull(loaded.Warning);
        Assert.AreEqual(AppSettings.Default.ParagraphSpacing, loaded.Settings.ParagraphSpacing);
        Assert.AreEqual(AppSettings.Default.BodyFont, loaded.Settings.BodyFont);
        Assert.AreEqual("yahei", loaded.Settings.H1Font);
        Assert.AreEqual(AppSettings.Default.H2Font, loaded.Settings.H2Font);
        Assert.AreEqual("ocean", loaded.Settings.ColorPalette);

        loaded.Settings.Save(temp.Path);
        Assert.AreEqual(loaded.Settings, AppSettings.Load(temp.Path).Settings);
    }

    [TestMethod]
    public void SaveRejectsInvalidNewSettings()
    {
        using var temp = new TempDirectory();

        Assert.ThrowsException<ArgumentException>(() => (AppSettings.Default with { ParagraphSpacing = double.NaN }).Save(temp.Path));
        Assert.ThrowsException<ArgumentException>(() => (AppSettings.Default with { BodyFont = "unknown" }).Save(temp.Path));
        Assert.ThrowsException<ArgumentException>(() => (AppSettings.Default with { ColorPalette = "unknown" }).Save(temp.Path));
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
