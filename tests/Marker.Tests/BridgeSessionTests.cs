using Marker.App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class BridgeSessionTests
{
    private const string EditorUrl = "https://editor.marker.example/index.html";

    [TestMethod]
    public void DiskChangeActionsRequireTrustedSessionExactFieldsAndNotificationId()
    {
        var session = new BridgeSession("session-1");
        const string json = "{\"type\":\"diskChangeAction\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"notificationId\":\"0123456789abcdef0123456789abcdef\",\"action\":\"reload\"}";
        Assert.IsTrue(session.TryReadDiskChangeAction(EditorUrl, EditorUrl, json, out var id, out var action, out _));
        Assert.AreEqual("0123456789abcdef0123456789abcdef", id);
        Assert.AreEqual("reload", action);
        Assert.IsTrue(session.TryReadDiskChangeAction(EditorUrl, EditorUrl, json.Replace("reload", "dismiss"), out _, out _, out _));
        Assert.IsFalse(session.TryReadDiskChangeAction("https://untrusted.invalid", EditorUrl, json, out _, out _, out _));
        Assert.IsFalse(session.TryReadDiskChangeAction(EditorUrl, EditorUrl, json.Replace("session-1", "stale"), out _, out _, out _));
        Assert.IsFalse(session.TryReadDiskChangeAction(EditorUrl, EditorUrl, json.Replace("reload", "save"), out _, out _, out _));
        Assert.IsFalse(session.TryReadDiskChangeAction(EditorUrl, EditorUrl, json.Replace(id, "bad"), out _, out _, out _));
        Assert.IsFalse(session.TryReadDiskChangeAction(EditorUrl, EditorUrl, json.Replace("\"action\":", "\"extra\":true,\"action\":"), out _, out _, out _));
    }

    [TestMethod]
    public void FileDropRequiresTrustedSessionAndBoundedCountWithoutJsonPaths()
    {
        var session = new BridgeSession("session-1");
        const string json = "{\"type\":\"filesDropped\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"count\":2}";
        Assert.IsTrue(session.TryReadFilesDropped(EditorUrl, EditorUrl, json, out var count, out _));
        Assert.AreEqual(2, count);
        Assert.IsFalse(session.TryReadFilesDropped("https://external.invalid", EditorUrl, json, out _, out _));
        Assert.IsFalse(session.TryReadFilesDropped(EditorUrl, EditorUrl, json.Replace("session-1", "stale"), out _, out _));
        Assert.IsFalse(session.TryReadFilesDropped(EditorUrl, EditorUrl, json.Replace("\"count\":2", "\"count\":65"), out _, out _));
        Assert.IsFalse(session.TryReadFilesDropped(EditorUrl, EditorUrl, json.Replace("\"count\":2", "\"count\":0"), out _, out _));
        Assert.IsFalse(session.TryReadFilesDropped(EditorUrl, EditorUrl, json.Replace("\"count\":2", "\"count\":2,\"paths\":[\"C:/Windows/file.md\"]"), out _, out _));
    }

    [TestMethod]
    public void SnapshotsRequireProtocolVersionAndPreserveRequestCorrelation()
    {
        var session = new BridgeSession("session-1");
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, "初始内容"), out var first, out _));
        Assert.AreEqual("初始内容", first.Text);
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, "初始内容"), out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, "同版本篡改"), out _, out _));
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, "{\"type\":\"snapshot\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"version\":0,\"text\":\"初始内容\",\"requestId\":\"request-1\"}", out var correlated, out _));
        Assert.AreEqual("request-1", correlated.RequestId);
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, "{\"type\":\"snapshot\",\"sessionId\":\"session-1\",\"version\":1,\"text\":\"x\"}", out _, out _));
    }

    [TestMethod]
    public void AppliesUtf16ChangesOnlyForExactBaseVersionAndLeavesStateOnReject()
    {
        var session = new BridgeSession("session-1");
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, "a😀b"), out _, out _));
        Assert.IsTrue(session.TryAcceptChanges(EditorUrl, EditorUrl, Changes(0, 1, "[{\"from\":1,\"to\":3,\"insert\":\"文\"}]"), out var first, out _));
        Assert.AreEqual("a文b", first.Text);
        Assert.AreEqual(1L, first.Version);

        Assert.IsTrue(session.TryAcceptChanges(EditorUrl, EditorUrl, Changes(1, 2, "[{\"from\":0,\"to\":0,\"insert\":\"#\"},{\"from\":2,\"to\":2,\"insert\":\"!\"}]"), out var second, out _));
        Assert.AreEqual("#a文!b", second.Text);
        Assert.AreEqual(2L, session.Version);
        Assert.IsFalse(session.TryAcceptChanges(EditorUrl, EditorUrl, Changes(1, 2, "[{\"from\":0,\"to\":0,\"insert\":\"x\"}]"), out _, out _));
        Assert.IsFalse(session.TryAcceptChanges(EditorUrl, EditorUrl, Changes(2, 4, "[]"), out _, out _));
        Assert.IsFalse(session.TryAcceptChanges(EditorUrl, EditorUrl, Changes(2, 3, "[{\"from\":2,\"to\":3,\"insert\":\"x\"},{\"from\":2,\"to\":2,\"insert\":\"y\"}]"), out _, out _));
        Assert.IsFalse(session.TryAcceptChanges(EditorUrl, EditorUrl, Changes(2, 3, "[{\"from\":0,\"to\":99,\"insert\":\"x\"}]"), out _, out _));
        Assert.AreEqual(2L, session.Version);
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 2, "#a文!b"), out var stillCurrent, out _));
        Assert.AreEqual("#a文!b", stillCurrent.Text);
    }

    [TestMethod]
    public void CommandsAndSnapshotErrorsRejectWrongProtocolOrUnknownFields()
    {
        var session = new BridgeSession("session-1");
        foreach (var command in new[] { "new", "open", "save", "saveAs", "recover", "settings" })
        {
            var message = System.Text.Json.JsonSerializer.Serialize(new { type = "command", protocolVersion = 1, sessionId = "session-1", command });
            Assert.IsTrue(session.TryReadCommand(EditorUrl, EditorUrl, message, out var accepted, out _));
            Assert.AreEqual(command, accepted);
        }
        var settings = "{\"type\":\"command\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"command\":\"settings\"}";
        Assert.IsFalse(session.TryReadCommand(EditorUrl, EditorUrl, settings.Replace("\"settings\"", "\"other\"", StringComparison.Ordinal), out _, out _));
        Assert.IsFalse(session.TryReadCommand("https://attacker.invalid/", EditorUrl, settings, out _, out _));
        Assert.IsFalse(session.TryReadCommand(EditorUrl, EditorUrl, settings.Replace("session-1", "stale", StringComparison.Ordinal), out _, out _));
        Assert.IsFalse(session.TryReadCommand(EditorUrl, EditorUrl, settings.Replace("\"settings\"}", "\"settings\",\"extra\":true}", StringComparison.Ordinal), out _, out _));
        Assert.IsFalse(session.TryReadCommand(EditorUrl, EditorUrl, "{\"type\":\"command\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"command\":\"save\",\"path\":\"C:\\\\x\"}", out _, out _));
        Assert.IsFalse(session.TryReadCommand(EditorUrl, EditorUrl, "{\"type\":\"command\",\"protocolVersion\":2,\"sessionId\":\"session-1\",\"command\":\"save\"}", out _, out _));

        const string snapshotError = "{\"type\":\"snapshotError\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"requestId\":\"request-1\",\"reason\":\"compositionInProgress\"}";
        Assert.IsTrue(session.TryReadSnapshotError(EditorUrl, EditorUrl, snapshotError, out var requestId, out var reason, out _));
        Assert.AreEqual("request-1", requestId);
        Assert.AreEqual("compositionInProgress", reason);
        Assert.IsFalse(session.TryReadSnapshotError(EditorUrl, EditorUrl, snapshotError.Replace("compositionInProgress", "unknown", StringComparison.Ordinal), out _, out _, out _));
    }

    [TestMethod]
    public void StatusAndPreviewActionsAreBoundToCurrentSnapshot()
    {
        var session = new BridgeSession("session-1");
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, "第一行\n😀x"), out _, out _));
        const string status = "{\"type\":\"status\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"version\":0,\"line\":2,\"column\":3,\"charCount\":7,\"unit\":\"utf16\"}";
        Assert.IsTrue(session.TryReadEditorStatus(EditorUrl, EditorUrl, status, out var acceptedStatus, out _));
        Assert.AreEqual(2, acceptedStatus.Line);
        Assert.AreEqual(3, acceptedStatus.Column);
        Assert.IsFalse(session.TryReadEditorStatus(EditorUrl, EditorUrl, status.Replace("\"version\":0", "\"version\":1", StringComparison.Ordinal), out _, out _));

        const string reveal = "{\"type\":\"revealSource\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"version\":0,\"offset\":4}";
        Assert.IsTrue(session.TryReadPreviewAction("https://preview.marker.example/preview.html", "https://preview.marker.example/preview.html", reveal, out var action, out var offset, out _, out _));
        Assert.AreEqual("revealSource", action);
        Assert.AreEqual(4, offset);
        const string safeLink = "{\"type\":\"openLink\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"version\":0,\"url\":\"https://example.com/\"}";
        Assert.IsTrue(session.TryReadPreviewAction("https://preview.marker.example/preview.html", "https://preview.marker.example/preview.html", safeLink, out action, out _, out var url, out _));
        Assert.AreEqual("https://example.com/", url);
        Assert.IsTrue(session.TryReadEditorLink(EditorUrl, EditorUrl, safeLink, out url, out _));
        Assert.AreEqual("https://example.com/", url);
        Assert.IsFalse(session.TryReadEditorLink("https://attacker.example/index.html", EditorUrl, safeLink, out _, out _));
        Assert.IsFalse(session.TryReadEditorLink(EditorUrl, EditorUrl, reveal, out _, out _));
        Assert.IsFalse(session.TryReadPreviewAction("https://preview.marker.example/preview.html", "https://preview.marker.example/preview.html", safeLink.Replace("https://example.com/", "javascript:alert(1)", StringComparison.Ordinal), out _, out _, out _, out _));
        Assert.IsFalse(session.TryReadPreviewAction("https://preview.marker.example/preview.html", "https://preview.marker.example/preview.html", safeLink.Replace("https://example.com/", "https://user@example.com/", StringComparison.Ordinal), out _, out _, out _, out _));
    }

    [TestMethod]
    public void EditorLinksAcceptSafeLocalTargetsAndRejectProtocolsAndNetworkPaths()
    {
        var session = new BridgeSession("session-1");
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, "[local](../notes/file.md)"), out _, out _));

        foreach (var target in new[] { "../notes/file.md", "C:\\Notes\\file.md", "file:///C:/Notes/file.md", "https://example.com/a" })
        {
            var json = System.Text.Json.JsonSerializer.Serialize(new { type = "openLink", protocolVersion = 1, sessionId = "session-1", version = 0, url = target });
            Assert.IsTrue(session.TryReadEditorLink(EditorUrl, EditorUrl, json, out var accepted, out _), target);
            Assert.AreEqual(target, accepted);
        }

        foreach (var target in new[] { "javascript:alert(1)", "data:text/html,hi", "mailto:user@example.com", "//server/share/file.md", "/rooted/path.md", "\\\\server\\share\\file.md", "https://user@example.com/" })
        {
            var json = System.Text.Json.JsonSerializer.Serialize(new { type = "openLink", protocolVersion = 1, sessionId = "session-1", version = 0, url = target });
            Assert.IsFalse(session.TryReadEditorLink(EditorUrl, EditorUrl, json, out _, out _), target);
        }
    }

    [TestMethod]
    public void SourceModeAcceptsOnlyCurrentTrustedBooleanState()
    {
        var session = new BridgeSession("session-1");
        const string message = """{"type":"sourceMode","protocolVersion":1,"sessionId":"session-1","version":0,"sourceMode":true}""";
        Assert.IsFalse(session.TryReadSourceMode(EditorUrl, EditorUrl, message, out _, out _));
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, "text"), out _, out _));
        Assert.IsTrue(session.TryReadSourceMode(EditorUrl, EditorUrl, message, out var mode, out _));
        Assert.IsTrue(mode);
        Assert.IsTrue(session.TryReadSourceMode(EditorUrl, EditorUrl, message.Replace("true", "false"), out mode, out _));
        Assert.IsFalse(mode);
        Assert.IsFalse(session.TryReadSourceMode("https://attacker.example/", EditorUrl, message, out _, out _));
        Assert.IsFalse(session.TryReadSourceMode(EditorUrl, EditorUrl, message.Replace("session-1", "session-2"), out _, out _));
        Assert.IsFalse(session.TryReadSourceMode(EditorUrl, EditorUrl, message.Replace("\"version\":0", "\"version\":1"), out _, out _));
        Assert.IsFalse(session.TryReadSourceMode(EditorUrl, EditorUrl, message.Replace("true", "\"true\""), out _, out _));
        Assert.IsFalse(session.TryReadSourceMode(EditorUrl, EditorUrl, message.Replace("true}", "true,\"extra\":1}"), out _, out _));
    }

    [TestMethod]
    public void RejectsUntrustedSourcesMalformedMessagesAndOversizedText()
    {
        var session = new BridgeSession("session-1");
        Assert.IsFalse(session.TryAcceptSnapshot("https://attacker.example/index.html", EditorUrl, Snapshot("session-1", 0, "x"), out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-2", 0, "x"), out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, "{\"type\":\"snapshot\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"version\":\"0\",\"text\":\"x\"}", out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, "{\"type\":\"snapshot\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"version\":0,\"text\":\"x\",\"path\":\"C:\\\\secret\"}", out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, "not json", out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, new string('a', BridgeSession.MaxTextLength + 1)), out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, new string(' ', BridgeSession.MaxMessageBytes + 1), out _, out _));
        Assert.IsTrue(session.TryReadReady(EditorUrl, EditorUrl, "{\"type\":\"ready\",\"protocolVersion\":1}"));
        Assert.IsFalse(session.TryReadReady(EditorUrl, EditorUrl, "{\"type\":\"ready\"}"));
        Assert.IsFalse(session.TryReadReady("https://editor.marker.example/other.html", EditorUrl, "{\"type\":\"ready\",\"protocolVersion\":1}"));
    }

    [TestMethod]
    public void EditorTextCapacityMatchesUtf8JsonStringEscapingAndBothLimits()
    {
        Assert.IsTrue(BridgeSession.IsEditorTextWithinLimits(new string('中', 400_000)));
        Assert.IsTrue(BridgeSession.IsEditorTextWithinLimits(string.Concat(Enumerable.Repeat("😀", 200_000))));
        Assert.IsTrue(BridgeSession.IsEditorTextWithinLimits("\u2028\uE000"));
        Assert.IsTrue(BridgeSession.IsEditorTextWithinLimits("quote\" slash\\ tab\t newline\n control\u0001"));
        Assert.IsTrue(BridgeSession.IsEditorTextWithinLimits(new string('a', BridgeSession.MaxTextLength)));
        Assert.IsTrue(BridgeSession.IsEditorTextWithinLimits(new string('\u0001', 349_000)));
        Assert.IsFalse(BridgeSession.IsEditorTextWithinLimits(new string('\u0001', 349_500)));
        Assert.IsTrue(BridgeSession.IsEditorTextWithinLimits(new string('\uD800', 200_000)));
        Assert.IsFalse(BridgeSession.IsEditorTextWithinLimits(new string('\uD800', 349_500)));
        Assert.IsFalse(BridgeSession.IsEditorTextWithinLimits(new string('a', BridgeSession.MaxTextLength + 1)));
        Assert.IsFalse(BridgeSession.IsEditorTextWithinLimits(string.Concat(Enumerable.Repeat("😀", BridgeSession.MaxTextLength / 2))));
        Assert.IsFalse(BridgeSession.IsEditorTextWithinLimits(new string('"', BridgeSession.MaxTextLength)));
    }

    [TestMethod]
    public void RejectsIncrementalChangesThatWouldMakeASaveSnapshotTooLarge()
    {
        var session = new BridgeSession("session-1");
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, new string('a', 700_000)), out _, out _));
        var small = Changes(0, 1, "[{\"from\":700000,\"to\":700000,\"insert\":\"b\"}]");
        Assert.IsTrue(session.TryAcceptChanges(EditorUrl, EditorUrl, small, out _, out _));
        var inserted = System.Text.Json.JsonSerializer.Serialize(new string('\u0001', 300_000));
        var changes = Changes(1, 2, "[{\"from\":700001,\"to\":700001,\"insert\":" + inserted + "}]");
        Assert.IsTrue(System.Text.Encoding.UTF8.GetByteCount(changes) < BridgeSession.MaxMessageBytes);
        Assert.IsFalse(session.TryAcceptChanges(EditorUrl, EditorUrl, changes, out _, out _));
        Assert.AreEqual(1L, session.Version);
        Assert.IsTrue(session.TryAcceptChanges(EditorUrl, EditorUrl, Changes(1, 2, "[{\"from\":700001,\"to\":700001,\"insert\":\"c\"}]"), out var current, out _));
        Assert.AreEqual(new string('a', 700_000) + "bc", current.Text);
    }

    private static string Snapshot(string sessionId, long version, string text) =>
        System.Text.Json.JsonSerializer.Serialize(new { type = "snapshot", protocolVersion = 1, sessionId, version, text });

    private static string Changes(long baseVersion, long version, string changes) =>
        $"{{\"type\":\"changes\",\"protocolVersion\":1,\"sessionId\":\"session-1\",\"baseVersion\":{baseVersion},\"version\":{version},\"changes\":{changes}}}";
}
