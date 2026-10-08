using System.Text.Json;

namespace Marker.App;

public sealed record AppSettings(
    int SchemaVersion,
    string ApplicationVersion,
    string Theme,
    int FontSize,
    double LineHeight,
    bool LineWrapping,
    string ViewMode,
    bool ReducedMotion = false,
    WindowPlacement? WindowPlacement = null)
{
    public const int CurrentSchemaVersion = 1;

    public static AppSettings Default => new(CurrentSchemaVersion,
        typeof(AppSettings).Assembly.GetName().Version?.ToString() ?? "unknown",
        "system", 16, 1.5, true, "split");

    public static AppSettingsLoadResult Load(string directory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        var path = Path.Combine(Path.GetFullPath(directory), "settings.json");
        if (!File.Exists(path)) return new(Default, null, true);

        try
        {
            DocumentFile.RejectReparsePath(path, includeTarget: true);
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length > 64 * 1024)
                return new(Default, "设置文件超过 64 KiB，已保留原文件并使用默认设置。", false);
            using var json = JsonDocument.Parse(stream, new JsonDocumentOptions { MaxDepth = 8 });
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("schemaVersion", out var schema)
                || schema.ValueKind != JsonValueKind.Number || !schema.TryGetInt32(out var version) || version != CurrentSchemaVersion)
                return new(Default, "设置文件版本无法识别，已保留原文件并使用默认设置。", false);

            var warnings = new List<string>();
            var defaults = Default;
            var appVersion = ReadString(root, "applicationVersion", defaults.ApplicationVersion, warnings);
            var theme = ReadEnum(root, "theme", ["system", "light", "dark"], defaults.Theme, warnings);
            var fontSize = ReadInt(root, "fontSize", 12, 24, defaults.FontSize, warnings);
            var lineHeight = ReadDouble(root, "lineHeight", 1.2, 2, defaults.LineHeight, warnings);
            var wrapping = ReadBool(root, "lineWrapping", defaults.LineWrapping, warnings);
            var viewMode = ReadEnum(root, "viewMode", ["source", "split", "read"], defaults.ViewMode, warnings);
            var reducedMotion = root.TryGetProperty("reducedMotion", out _)
                ? ReadBool(root, "reducedMotion", defaults.ReducedMotion, warnings)
                : defaults.ReducedMotion;
            var windowPlacement = ReadWindowPlacement(root, warnings);
            return new(new AppSettings(CurrentSchemaVersion, appVersion, theme, fontSize, lineHeight, wrapping, viewMode,
                    reducedMotion, windowPlacement),
                warnings.Count == 0 ? null : $"部分设置无效，已使用默认值：{string.Join("、", warnings)}。", true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        {
            return new(Default, $"设置文件无法读取，已保留原文件并使用默认设置：{error.Message}", false);
        }
    }

    public void Save(string directory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        if (SchemaVersion != CurrentSchemaVersion || Theme is not ("system" or "light" or "dark")
            || FontSize is < 12 or > 24 || !double.IsFinite(LineHeight) || LineHeight is < 1.2 or > 2
            || ViewMode is not ("source" or "split" or "read")
            || WindowPlacement is { IsValid: false })
            throw new ArgumentException("设置值无效，未保存。", nameof(directory));

        var fullDirectory = Path.GetFullPath(directory);
        DocumentFile.RejectReparsePath(fullDirectory, includeTarget: false);
        Directory.CreateDirectory(fullDirectory);
        DocumentFile.RejectReparsePath(fullDirectory, includeTarget: true);
        var path = Path.Combine(fullDirectory, "settings.json");
        DocumentFile.RejectReparsePath(path, includeTarget: true);
        var temp = Path.Combine(fullDirectory, $".settings.{Guid.NewGuid():N}.tmp");
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(this, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }
            DocumentFile.RejectReparsePath(path, includeTarget: true);
            File.Move(temp, path, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(temp)) File.Delete(temp); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static string ReadString(JsonElement root, string name, string fallback, List<string> warnings)
    {
        if (root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString()))
            return value.GetString()!;
        warnings.Add(name);
        return fallback;
    }

    private static string ReadEnum(JsonElement root, string name, string[] allowed, string fallback, List<string> warnings)
    {
        var value = ReadString(root, name, fallback, warnings);
        if (allowed.Contains(value, StringComparer.Ordinal)) return value;
        if (root.TryGetProperty(name, out var item) && item.ValueKind == JsonValueKind.String) warnings.Add(name);
        return fallback;
    }

    private static int ReadInt(JsonElement root, string name, int minimum, int maximum, int fallback, List<string> warnings)
    {
        if (root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt32(out var number) && number >= minimum && number <= maximum)
            return number;
        warnings.Add(name);
        return fallback;
    }

    private static double ReadDouble(JsonElement root, string name, double minimum, double maximum, double fallback, List<string> warnings)
    {
        if (root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number
            && value.TryGetDouble(out var number) && double.IsFinite(number) && number >= minimum && number <= maximum)
            return number;
        warnings.Add(name);
        return fallback;
    }

    private static bool ReadBool(JsonElement root, string name, bool fallback, List<string> warnings)
    {
        if (root.TryGetProperty(name, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False)
            return value.GetBoolean();
        warnings.Add(name);
        return fallback;
    }

    private static WindowPlacement? ReadWindowPlacement(JsonElement root, List<string> warnings)
    {
        if (!root.TryGetProperty("windowPlacement", out var value) || value.ValueKind == JsonValueKind.Null)
            return null;
        if (value.ValueKind != JsonValueKind.Object)
        {
            warnings.Add("windowPlacement");
            return null;
        }

        var placementWarnings = new List<string>();
        var left = ReadInt(value, "left", -32768, 32767, 0, placementWarnings);
        var top = ReadInt(value, "top", -32768, 32767, 0, placementWarnings);
        var width = ReadInt(value, "width", 320, 16384, 1200, placementWarnings);
        var height = ReadInt(value, "height", 240, 16384, 850, placementWarnings);
        var maximized = ReadBool(value, "maximized", false, placementWarnings);
        var placement = new WindowPlacement(left, top, width, height, maximized);
        if (placementWarnings.Count == 0 && placement.IsValid) return placement;
        warnings.Add("windowPlacement");
        return null;
    }
}

public sealed record AppSettingsLoadResult(AppSettings Settings, string? Warning, bool CanSave);
