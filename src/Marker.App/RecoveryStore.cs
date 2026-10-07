using System.Text.Json;

namespace Marker.App;

public sealed record RecoveryDraft(
    Guid DocId,
    long Version,
    DateTimeOffset UpdatedUtc,
    string? OriginalPath,
    string Text,
    DocumentFileFormat Format,
    string? Fingerprint);

public sealed record RecoveryEntry(Guid DocId, RecoveryDraft? Draft, string? Error);

public sealed class RecoveryStore
{
    private const int CurrentSchemaVersion = 1;
    private const int MaxRecoveryBytes = 8 * 1024 * 1024;
    private readonly string _directory;
    private readonly JsonSerializerOptions _jsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    public RecoveryStore(string directory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        _directory = Path.GetFullPath(directory);
    }

    public void Save(RecoveryDraft draft)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (draft.DocId == Guid.Empty || draft.Version < 0)
            throw new ArgumentException("恢复草稿必须包含有效的文档 ID 和非负版本号。", nameof(draft));
        ArgumentNullException.ThrowIfNull(draft.Text);
        ArgumentNullException.ThrowIfNull(draft.Format);

        DocumentFile.RejectReparsePath(_directory, includeTarget: false);
        Directory.CreateDirectory(_directory);
        DocumentFile.RejectReparsePath(_directory, includeTarget: true);
        var path = GetPath(draft.DocId);
        DocumentFile.RejectReparsePath(path, includeTarget: true);
        var payload = new RecoveryEnvelope(CurrentSchemaVersion, draft.DocId, draft.Version, draft.UpdatedUtc.ToUniversalTime(),
            draft.OriginalPath, draft.Text, draft.Format, draft.Fingerprint,
            typeof(RecoveryStore).Assembly.GetName().Version?.ToString() ?? "unknown");
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, _jsonOptions);
        if (bytes.Length > MaxRecoveryBytes) throw new IOException("恢复草稿超过 8 MiB 限制，未替换原草稿。");
        var tempPath = Path.Combine(_directory, $".{draft.DocId:N}.{Guid.NewGuid():N}.tmp");
        try
        {
            using (var stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }

            DocumentFile.RejectReparsePath(path, includeTarget: true);
            // Private drafts need atomic content replacement, not the source document's metadata merge.
            File.Move(tempPath, path, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(tempPath)) File.Delete(tempPath); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    public RecoveryEntry Load(Guid docId)
    {
        if (docId == Guid.Empty) throw new ArgumentException("文档 ID 无效。", nameof(docId));
        var path = GetPath(docId);
        if (!File.Exists(path)) return new RecoveryEntry(docId, null, "恢复草稿不存在。");
        return ReadEntry(path, docId);
    }

    public IReadOnlyList<RecoveryEntry> List()
    {
        if (!Directory.Exists(_directory)) return [];
        DocumentFile.RejectReparsePath(_directory, includeTarget: true);
        var entries = new List<RecoveryEntry>();
        foreach (var path in Directory.EnumerateFiles(_directory, "*.json", SearchOption.TopDirectoryOnly))
        {
            var name = Path.GetFileNameWithoutExtension(path);
            if (Guid.TryParseExact(name, "N", out var docId)) entries.Add(ReadEntry(path, docId));
        }
        return entries;
    }

    public void Delete(Guid docId)
    {
        if (docId == Guid.Empty) throw new ArgumentException("文档 ID 无效。", nameof(docId));
        var path = GetPath(docId);
        DocumentFile.RejectReparsePath(path, includeTarget: true);
        if (File.Exists(path)) File.Delete(path);
    }

    private string GetPath(Guid docId) => Path.Combine(_directory, $"{docId:N}.json");

    private RecoveryEntry ReadEntry(string path, Guid filenameId)
    {
        try
        {
            DocumentFile.RejectReparsePath(path, includeTarget: true);
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length > MaxRecoveryBytes) return new RecoveryEntry(filenameId, null, "恢复草稿超过 8 MiB 限制；文件已保留。");
            var envelope = JsonSerializer.Deserialize<RecoveryEnvelope>(stream, _jsonOptions);
            if (envelope is null) return new RecoveryEntry(filenameId, null, "恢复草稿内容为空或格式无效；文件已保留。 ");
            if (envelope.SchemaVersion != CurrentSchemaVersion)
                return new RecoveryEntry(filenameId, null, $"恢复草稿版本 {envelope.SchemaVersion} 不受支持；文件已保留。");
            if (envelope.DocId != filenameId || envelope.Version < 0 || envelope.Text is null || envelope.Format is null)
                return new RecoveryEntry(filenameId, null, "恢复草稿字段无效；文件已保留。");
            var draft = new RecoveryDraft(envelope.DocId, envelope.Version, envelope.UpdatedUtc, envelope.OriginalPath,
                envelope.Text, envelope.Format, envelope.Fingerprint);
            return new RecoveryEntry(filenameId, draft, null);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or NotSupportedException)
        {
            return new RecoveryEntry(filenameId, null, $"恢复草稿无法读取：{ex.Message} 文件已保留。");
        }
    }

    private sealed record RecoveryEnvelope(
        int SchemaVersion,
        Guid DocId,
        long Version,
        DateTimeOffset UpdatedUtc,
        string? OriginalPath,
        string Text,
        DocumentFileFormat Format,
        string? Fingerprint,
        string? ApplicationVersion = null);
}
