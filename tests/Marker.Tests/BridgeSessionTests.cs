using Marker.App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class BridgeSessionTests
{
    private const string EditorUrl = "https://editor.marker.example/index.html";

    [TestMethod]
    public void SnapshotAcceptsInitialAndSameVersionResyncButRejectsStaleOrChangedReplay()
    {
        var session = new BridgeSession("session-1");
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, "初始内容"), out var first, out _));
        Assert.AreEqual("初始内容", first.Text);

        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, "初始内容"), out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, "同版本篡改"), out _, out _));
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 2, "最新内容"), out var latest, out _));
        Assert.AreEqual(2L, latest.Version);
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 1, "旧内容"), out _, out _));
        Assert.AreEqual(2L, session.Version);
    }

    [TestMethod]
    public void SnapshotCarriesOptionalBoundedRequestId()
    {
        var session = new BridgeSession("session-1");
        Assert.IsTrue(session.TryAcceptSnapshot(EditorUrl, EditorUrl, "{\"type\":\"snapshot\",\"sessionId\":\"session-1\",\"version\":0,\"text\":\"x\",\"requestId\":\"request-1\"}", out var correlated, out _));
        Assert.AreEqual("request-1", correlated.RequestId);

        var next = new BridgeSession("session-2");
        Assert.IsTrue(next.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-2", 0, "x"), out var ordinary, out _));
        Assert.IsNull(ordinary.RequestId);
        Assert.IsFalse(new BridgeSession("session-3").TryAcceptSnapshot(EditorUrl, EditorUrl, "{\"type\":\"snapshot\",\"sessionId\":\"session-3\",\"version\":0,\"text\":\"x\",\"requestId\":\"\"}", out _, out _));
        Assert.IsFalse(new BridgeSession("session-4").TryAcceptSnapshot(EditorUrl, EditorUrl, "{\"type\":\"snapshot\",\"sessionId\":\"session-4\",\"version\":0,\"text\":\"x\",\"requestId\":\"" + new string('r', 129) + "\"}", out _, out _));
    }

    [TestMethod]
    public void CommandsAndCompositionSnapshotErrorsAreStrictlyValidated()
    {
        var session = new BridgeSession("session-1");
        foreach (var command in new[] { "new", "open", "save", "saveAs" })
        {
            var message = System.Text.Json.JsonSerializer.Serialize(new { type = "command", sessionId = "session-1", command });
            Assert.IsTrue(session.TryReadCommand(EditorUrl, EditorUrl, message, out var accepted, out _));
            Assert.AreEqual(command, accepted);
        }
        Assert.IsFalse(session.TryReadCommand(EditorUrl, EditorUrl, "{\"type\":\"command\",\"sessionId\":\"session-1\",\"command\":\"run\",\"path\":\"C:\\\\x\"}", out _, out _));
        Assert.IsFalse(session.TryReadCommand(EditorUrl, EditorUrl, "{\"type\":\"command\",\"sessionId\":\"session-2\",\"command\":\"save\"}", out _, out _));

        const string snapshotError = "{\"type\":\"snapshotError\",\"sessionId\":\"session-1\",\"requestId\":\"request-1\",\"reason\":\"compositionInProgress\"}";
        Assert.IsTrue(session.TryReadSnapshotError(EditorUrl, EditorUrl, snapshotError, out var requestId, out var reason, out _));
        Assert.AreEqual("request-1", requestId);
        Assert.AreEqual("compositionInProgress", reason);
        Assert.IsFalse(session.TryReadSnapshotError(EditorUrl, EditorUrl, snapshotError.Replace("compositionInProgress", "unknown", StringComparison.Ordinal), out _, out _, out _));
        Assert.IsFalse(session.TryReadSnapshotError(EditorUrl, EditorUrl, snapshotError.Replace("request-1", "", StringComparison.Ordinal), out _, out _, out _));
    }

    [TestMethod]
    public void RejectsUntrustedSourcesWrongSessionsUnknownFieldsAndInvalidJsonValues()
    {
        var session = new BridgeSession("session-1");
        Assert.IsFalse(session.TryAcceptSnapshot("https://attacker.example/index.html", EditorUrl, Snapshot("session-1", 0, "x"), out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-2", 0, "x"), out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, "{\"type\":\"snapshot\",\"sessionId\":\"session-1\",\"version\":\"0\",\"text\":\"x\"}", out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, "{\"type\":\"snapshot\",\"sessionId\":\"session-1\",\"version\":0,\"text\":\"x\",\"path\":\"C:\\\\secret\"}", out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, "not json", out _, out _));
    }

    [TestMethod]
    public void EnforcesTextAndMessageLimitsAndOnlyAcceptsExactPageForReady()
    {
        var session = new BridgeSession("session-1");
        var oversizedText = new string('a', BridgeSession.MaxTextLength + 1);
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, Snapshot("session-1", 0, oversizedText), out _, out _));
        Assert.IsFalse(session.TryAcceptSnapshot(EditorUrl, EditorUrl, new string(' ', BridgeSession.MaxMessageBytes + 1), out _, out _));
        Assert.IsTrue(session.TryReadReady(EditorUrl, EditorUrl, "{\"type\":\"ready\"}"));
        Assert.IsFalse(session.TryReadReady("https://editor.marker.example/other.html", EditorUrl, "{\"type\":\"ready\"}"));
    }

    private static string Snapshot(string sessionId, long version, string text)
    {
        return System.Text.Json.JsonSerializer.Serialize(new { type = "snapshot", sessionId, version, text });
    }
}
