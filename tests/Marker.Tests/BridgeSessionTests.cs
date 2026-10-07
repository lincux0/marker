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
