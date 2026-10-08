using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace Marker.App;

internal sealed class BridgeSession(string sessionId)
{
    public const int ProtocolVersion = 1;
    public const int MaxTextLength = 1_048_576;
    public const int MaxMessageBytes = 2_097_152;

    public string SessionId { get; } = sessionId;
    public long Version { get; private set; } = -1;
    private string? _text;

    public bool TryReadReady(string source, string expectedSource, string json)
    {
        return TryRead(source, expectedSource, json, "ready", ["type", "protocolVersion"], out _, out _);
    }

    public bool TryAcceptSnapshot(string source, string expectedSource, string json, out MarkdownSnapshot snapshot, out string error)
    {
        snapshot = default;
        if (!TryRead(source, expectedSource, json, "snapshot", ["type", "protocolVersion", "sessionId", "version", "text"], ["requestId"], out var root, out error))
            return false;

        if (!HasMatchingSession(root, out error)) return false;
        if (!TryReadInt64(root, "version", out var version) || version < 0)
            return Fail("编辑器版本号无效。", out error);
        if (!root.TryGetProperty("text", out var textElement) || textElement.ValueKind != JsonValueKind.String)
            return Fail("编辑器快照缺少文本。", out error);

        var text = textElement.GetString()!;
        if (text.Length > MaxTextLength)
            return Fail("编辑器文本超过 1 Mi UTF-16 单元限制。", out error);
        if (Version < 0 ? version != 0 : version < Version || version == Version && text != _text)
            return Fail("编辑器快照版本已过期或未递增。", out error);
        if (!TryReadOptionalRequestId(root, out var requestId, out error)) return false;

        if (version > Version)
        {
            Version = version;
            _text = text;
        }
        snapshot = new MarkdownSnapshot(version, text, requestId);
        error = string.Empty;
        return true;
    }

    public bool TryAcceptChanges(string source, string expectedSource, string json, out MarkdownSnapshot snapshot, out string error)
    {
        snapshot = default;
        if (!TryRead(source, expectedSource, json, "changes", ["type", "protocolVersion", "sessionId", "baseVersion", "version", "changes"], out var root, out error))
            return false;
        if (!HasMatchingSession(root, out error)) return false;
        if (_text is null || !TryReadInt64(root, "baseVersion", out var baseVersion) || baseVersion != Version ||
            !TryReadInt64(root, "version", out var version) || Version == long.MaxValue || version != Version + 1)
            return Fail("编辑器增量版本与当前快照不连续。", out error);
        if (!root.TryGetProperty("changes", out var changesElement) || changesElement.ValueKind != JsonValueKind.Array || changesElement.GetArrayLength() == 0)
            return Fail("编辑器增量格式无效。", out error);

        var changes = new List<(int From, int To, string Insert)>();
        var previousFrom = -1;
        var previousTo = 0;
        foreach (var item in changesElement.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || !HasOnlyFields(item, ["from", "to", "insert"]) ||
                !TryReadInt32(item, "from", out var from) || !TryReadInt32(item, "to", out var to) ||
                from < 0 || to < from || to > _text.Length || from < previousTo || from == previousFrom ||
                !item.TryGetProperty("insert", out var insertElement) || insertElement.ValueKind != JsonValueKind.String)
                return Fail("编辑器增量范围无效、重叠或乱序。", out error);

            var insert = insertElement.GetString()!;
            changes.Add((from, to, insert));
            previousFrom = from;
            previousTo = to;
        }

        var capacity = (long)_text.Length + changes.Sum(change => (long)change.Insert.Length - (change.To - change.From));
        if (capacity < 0 || capacity > MaxTextLength)
            return Fail("编辑器增量结果超过 1 Mi UTF-16 单元限制。", out error);

        var result = new StringBuilder((int)capacity);
        var position = 0;
        foreach (var change in changes)
        {
            result.Append(_text, position, change.From - position);
            result.Append(change.Insert);
            position = change.To;
        }
        result.Append(_text, position, _text.Length - position);

        _text = result.ToString();
        Version = version;
        snapshot = new MarkdownSnapshot(version, _text);
        error = string.Empty;
        return true;
    }

    public bool TryReadCommand(string source, string expectedSource, string json, out string command, out string error)
    {
        command = string.Empty;
        if (!TryRead(source, expectedSource, json, "command", ["type", "protocolVersion", "sessionId", "command"], out var root, out error))
            return false;
        if (!HasMatchingSession(root, out error)) return false;
        if (!root.TryGetProperty("command", out var commandElement) || commandElement.ValueKind != JsonValueKind.String ||
            commandElement.GetString() is not ("new" or "open" or "save" or "saveAs"))
            return Fail("原生命令不受支持。", out error);

        command = commandElement.GetString()!;
        error = string.Empty;
        return true;
    }

    public bool TryReadSnapshotError(string source, string expectedSource, string json, out string requestId, out string reason, out string error)
    {
        requestId = string.Empty;
        reason = string.Empty;
        if (!TryRead(source, expectedSource, json, "snapshotError", ["type", "protocolVersion", "sessionId", "requestId", "reason"], out var root, out error))
            return false;
        if (!HasMatchingSession(root, out error)) return false;
        if (!TryReadRequiredRequestId(root, out requestId, out error)) return false;
        if (!root.TryGetProperty("reason", out var reasonElement) || reasonElement.ValueKind != JsonValueKind.String || reasonElement.GetString() != "compositionInProgress")
            return Fail("快照错误原因不受支持。", out error);

        reason = reasonElement.GetString()!;
        error = string.Empty;
        return true;
    }

    public bool TryReadEditorStatus(string source, string expectedSource, string json, out EditorStatus status, out string error)
    {
        status = default;
        if (!TryRead(source, expectedSource, json, "status", ["type", "protocolVersion", "sessionId", "version", "line", "column", "charCount", "unit"], out var root, out error))
            return false;
        if (!HasMatchingSession(root, out error)) return false;
        if (_text is null || !TryReadInt64(root, "version", out var version) || version != Version ||
            !TryReadInt32(root, "line", out var line) || !TryReadInt32(root, "column", out var column) ||
            !TryReadInt32(root, "charCount", out var charCount) || line < 1 || column < 1 || charCount != _text.Length ||
            !root.TryGetProperty("unit", out var unit) || unit.ValueKind != JsonValueKind.String || unit.GetString() != "utf16")
            return Fail("编辑器状态与当前快照不匹配。", out error);

        var lineStart = 0;
        var currentLine = 1;
        for (var i = 0; i < _text.Length && currentLine < line; i++)
        {
            if (_text[i] == '\n')
            {
                currentLine++;
                lineStart = i + 1;
            }
        }
        var lineEnd = _text.IndexOf('\n', lineStart);
        if (line > currentLine || column > (lineEnd < 0 ? _text.Length : lineEnd) - lineStart + 1)
            return Fail("编辑器光标位置超出当前文档。", out error);

        status = new EditorStatus(version, line, column, charCount);
        error = string.Empty;
        return true;
    }

    public bool TryReadPreviewAction(string source, string expectedSource, string json, out string action, out int offset, out string? url, out string error)
    {
        action = string.Empty;
        offset = -1;
        url = null;
        if (!string.Equals(source, expectedSource, StringComparison.Ordinal)) return Fail("消息来源不受信任。", out error);
        if (Encoding.UTF8.GetByteCount(json) > MaxMessageBytes) return Fail("桥接消息超过 2 MiB 限制。", out error);
        JsonElement root;
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
            root = document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return Fail("桥接消息不是有效 JSON。", out error);
        }
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var typeElement) || typeElement.ValueKind != JsonValueKind.String)
            return Fail("预览动作格式无效。", out error);

        var type = typeElement.GetString();
        var allowed = type switch
        {
            "revealSource" => new[] { "type", "protocolVersion", "sessionId", "version", "offset" },
            "openLink" => new[] { "type", "protocolVersion", "sessionId", "version", "url" },
            _ => Array.Empty<string>()
        };
        if (allowed.Length == 0 || !HasOnlyFields(root, allowed) || !HasProtocolVersion(root) || !HasMatchingSession(root, out error))
            return Fail("预览动作类型、协议或会话无效。", out error);
        if (!TryReadInt64(root, "version", out var version) || version != Version || _text is null)
            return Fail("预览动作版本与当前快照不匹配。", out error);

        if (type == "revealSource")
        {
            if (!TryReadInt32(root, "offset", out offset) || offset < 0 || offset > _text.Length)
                return Fail("源码定位偏移无效。", out error);
        }
        else
        {
            if (!root.TryGetProperty("url", out var urlElement) || urlElement.ValueKind != JsonValueKind.String ||
                urlElement.GetString() is not string candidate || candidate.Length > 2048 ||
                !Uri.TryCreate(candidate, UriKind.Absolute, out var uri) ||
                uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo))
                return Fail("外部链接格式无效。", out error);
            url = candidate;
        }

        action = type!;
        error = string.Empty;
        return true;
    }

    public bool TryAcceptRendered(string source, string expectedSource, string json, out long version, out string error)
    {
        version = -1;
        if (!TryRead(source, expectedSource, json, "rendered", ["type", "protocolVersion", "sessionId", "version"], out var root, out error))
            return false;

        if (!HasMatchingSession(root, out error)) return false;
        if (!TryReadInt64(root, "version", out version) || version < 0)
            return Fail("预览版本号无效。", out error);

        error = string.Empty;
        return true;
    }

    private static bool TryRead(string source, string expectedSource, string json, string expectedType, string[] fields, out JsonElement root, out string error) =>
        TryRead(source, expectedSource, json, expectedType, fields, Array.Empty<string>(), out root, out error);

    private static bool TryRead(string source, string expectedSource, string json, string expectedType, string[] fields, string[] optionalFields, out JsonElement root, out string error)
    {
        root = default;
        if (!string.Equals(source, expectedSource, StringComparison.Ordinal)) return Fail("消息来源不受信任。", out error);
        if (Encoding.UTF8.GetByteCount(json) > MaxMessageBytes) return Fail("桥接消息超过 2 MiB 限制。", out error);

        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
            root = document.RootElement.Clone();
            if (root.ValueKind != JsonValueKind.Object || !HasOnlyFields(root, fields, optionalFields))
                return Fail("桥接消息包含重复或未授权字段。", out error);
            if (!root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != expectedType || !HasProtocolVersion(root))
                return Fail("桥接消息类型或协议版本不受支持。", out error);
        }
        catch (JsonException)
        {
            return Fail("桥接消息不是有效 JSON。", out error);
        }

        error = string.Empty;
        return true;
    }

    private bool HasMatchingSession(JsonElement root, out string error)
    {
        if (!root.TryGetProperty("sessionId", out var session) || session.ValueKind != JsonValueKind.String || session.GetString() != SessionId)
            return Fail("编辑器会话不匹配。", out error);
        error = string.Empty;
        return true;
    }

    private static bool HasProtocolVersion(JsonElement root) => TryReadInt32(root, "protocolVersion", out var version) && version == ProtocolVersion;

    private static bool HasOnlyFields(JsonElement root, string[] fields, string[]? optionalFields = null)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject())
            if (!seen.Add(property.Name) || !fields.Contains(property.Name, StringComparer.Ordinal) && !(optionalFields?.Contains(property.Name, StringComparer.Ordinal) ?? false)) return false;
        foreach (var field in fields)
            if (!root.TryGetProperty(field, out _)) return false;
        return true;
    }

    private static bool TryReadInt64(JsonElement root, string name, out long value)
    {
        value = 0;
        return root.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.Number && element.TryGetInt64(out value);
    }

    private static bool TryReadInt32(JsonElement root, string name, out int value)
    {
        value = 0;
        return root.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out value);
    }

    private static bool TryReadOptionalRequestId(JsonElement root, out string? requestId, out string error)
    {
        requestId = null;
        if (!root.TryGetProperty("requestId", out var element))
        {
            error = string.Empty;
            return true;
        }
        if (element.ValueKind != JsonValueKind.String || !IsRequestId(element.GetString())) return Fail("快照请求编号无效。", out error);
        requestId = element.GetString();
        error = string.Empty;
        return true;
    }

    private static bool TryReadRequiredRequestId(JsonElement root, out string requestId, out string error)
    {
        requestId = string.Empty;
        if (!root.TryGetProperty("requestId", out var element) || element.ValueKind != JsonValueKind.String || !IsRequestId(element.GetString()))
            return Fail("快照请求编号无效。", out error);
        requestId = element.GetString()!;
        error = string.Empty;
        return true;
    }

    private static bool IsRequestId(string? value) => !string.IsNullOrEmpty(value) && value.Length <= 128;

    private static bool Fail(string message, out string error)
    {
        error = message;
        return false;
    }
}

internal readonly record struct MarkdownSnapshot(long Version, string Text, string? RequestId = null);
internal readonly record struct EditorStatus(long Version, int Line, int Column, int CharCount);
