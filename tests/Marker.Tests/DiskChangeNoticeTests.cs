using Marker.App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Marker.Tests;

[TestClass]
public sealed class DiskChangeNoticeTests
{
    [TestMethod]
    public void DuplicateAndDismissedFingerprintsStayQuietButNewChangesNotify()
    {
        var notice = new DiskChangeNotice();
        notice.Update("saved", "saved");
        Assert.IsFalse(notice.IsChanged);
        Assert.IsNull(notice.NotificationId);
        notice.Update("saved", "external-1");
        var first = notice.NotificationId!;
        notice.Update("saved", "external-1");
        Assert.AreEqual(first, notice.NotificationId);
        Assert.IsFalse(notice.Dismiss("stale"));
        Assert.IsTrue(notice.Dismiss(first));
        notice.Update("saved", "external-1");
        Assert.IsTrue(notice.IsChanged);
        Assert.IsNull(notice.NotificationId);
        notice.Update("saved", "external-2");
        Assert.IsNotNull(notice.NotificationId);
        Assert.AreNotEqual(first, notice.NotificationId);
        Assert.IsFalse(notice.Dismiss(first));
    }

    [TestMethod]
    public void ReversionSaveAndMissingFileClearReloadPrompt()
    {
        var notice = new DiskChangeNotice();
        notice.Update("saved", "external");
        notice.Update("saved", null);
        Assert.IsTrue(notice.IsChanged);
        Assert.IsNull(notice.NotificationId);
        notice.Update("saved", "external");
        Assert.IsNotNull(notice.NotificationId);
        notice.Update("saved", "saved");
        Assert.IsFalse(notice.IsChanged);
        Assert.IsNull(notice.NotificationId);
        notice.Update("saved", "external");
        notice.Reset();
        notice.Update("external", "external");
        Assert.IsFalse(notice.IsChanged);
        Assert.IsNull(notice.NotificationId);
    }
}
