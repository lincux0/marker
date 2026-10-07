using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace Marker.App;

internal sealed class BridgeSession(string sessionId)
{
    public const int MaxTextLength = 1_048_576;
    public const int MaxMessageBytes = 2_097_152;

    public string SessionId { get; } = sessionId;
    public long Version { get; private set; } = -1;
    private string? _text;

    public bool TryReadReady(string source, string expectedSource, string json)
    {
        return TryRead(source, expectedSource, json, "ready", ["type"], out _, out _);
    }

    public bool TryAcceptSnapshot(string source, string expectedSource, string json, out MarkdownSnapshot snapshot, out string error)
    {
        snapshot = default;
        if (!TryRead(source, expectedSource, json, "snapshot", ["type", "sessionId", "version", "text", "requestId"], out var root, out error))
            return false;

        if (!root.TryGetProperty("sessionId", out var session) || session.ValueKind != JsonValueKind.String || session.GetString() != SessionId)
            return Fail("编辑器会话不匹配。", out error);
        if (!root.TryGetProperty("version", out var versionElement) || versionElement.ValueKind != JsonValueKind.Number || !versionElement.TryGetInt64(out var version) || version < 0)
            return Fail("编辑器版本号无效。", out error);
        if (!root.TryGetProperty("text", out var textElement) || textElement.ValueKind != JsonValueKind.String)
            return Fail("编辑器快照缺少文本。", out error);

        var text = textElement.GetString()!;
        if (text.Length > MaxTextLength)
            return Fail("编辑器文本超过 1 Mi UTF-16 单元限制。", out error);
        if (Version < 0 ? version != 0 : version < Version || version == Version && text != _text)
            return Fail("编辑器快照版本已过期或未递增。", out error);
        if (!TryReadOptionalRequestId(root, out var requestId, out error))
            return false;

        if (version > Version)
        {
            Version = version;
            _text = text;
        }
        snapshot = new MarkdownSnapshot(version, text, requestId);
        error = string.Empty;
        return true;
    }

    public bool TryReadCommand(string source, string expectedSource, string json, out string command, out string error)
    {
        command = string.Empty;
        if (!TryRead(source, expectedSource, json, "command", ["type", "sessionId", "command"], out var root, out error))
            return false;
        if (!HasMatchingSession(root, out error))
            return false;
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
        if (!TryRead(source, expectedSource, json, "snapshotError", ["type", "sessionId", "requestId", "reason"], out var root, out error))
            return false;
        if (!HasMatchingSession(root, out error))
            return false;
        if (!TryReadRequiredRequestId(root, out requestId, out error))
            return false;
        if (!root.TryGetProperty("reason", out var reasonElement) || reasonElement.ValueKind != JsonValueKind.String || reasonElement.GetString() != "compositionInProgress")
            return Fail("快照错误原因不受支持。", out error);

        reason = reasonElement.GetString()!;
        error = string.Empty;
        return true;
    }

    public bool TryAcceptRendered(string source, string expectedSource, string json, out long version, out string error)
    {
        version = -1;
        if (!TryRead(source, expectedSource, json, "rendered", ["type", "sessionId", "version"], out var root, out error))
            return false;

        if (!root.TryGetProperty("sessionId", out var session) || session.ValueKind != JsonValueKind.String || session.GetString() != SessionId)
            return Fail("预览会话不匹配。", out error);
        if (!root.TryGetProperty("version", out var versionElement) || versionElement.ValueKind != JsonValueKind.Number || !versionElement.TryGetInt64(out version) || version < 0)
            return Fail("预览版本号无效。", out error);

        error = string.Empty;
        return true;
    }

    private static bool TryRead(string source, string expectedSource, string json, string expectedType, string[] fields, out JsonElement root, out string error)
    {
        root = default;
        if (!string.Equals(source, expectedSource, StringComparison.Ordinal))
            return Fail("消息来源不受信任。", out error);
        if (Encoding.UTF8.GetByteCount(json) > MaxMessageBytes)
            return Fail("桥接消息超过 2 MiB 限制。", out error);

        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
            root = document.RootElement.Clone();
            if (root.ValueKind != JsonValueKind.Object)
                return Fail("桥接消息必须是 JSON 对象。", out error);

            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject())
            {
                if (!seen.Add(property.Name) || !fields.Contains(property.Name, StringComparer.Ordinal))
                    return Fail("桥接消息包含重复或未授权字段。", out error);
            }
            if (!root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != expectedType)
                return Fail("桥接消息类型不受支持。", out error);
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

    private static bool TryReadOptionalRequestId(JsonElement root, out string? requestId, out string error)
    {
        requestId = null;
        if (!root.TryGetProperty("requestId", out var element))
        {
            error = string.Empty;
            return true;
        }
        if (element.ValueKind != JsonValueKind.String || !IsRequestId(element.GetString()))
            return Fail("快照请求编号无效。", out error);
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
