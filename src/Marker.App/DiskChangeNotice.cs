namespace Marker.App;

internal sealed class DiskChangeNotice
{
    private string? _observedFingerprint;
    public string? NotificationId { get; private set; }
    public bool IsChanged { get; private set; }

    public void Update(string savedFingerprint, string? diskFingerprint)
    {
        IsChanged = diskFingerprint != savedFingerprint;
        if (!IsChanged || diskFingerprint is null)
        {
            Reset();
            IsChanged = diskFingerprint is null;
            return;
        }
        if (diskFingerprint == _observedFingerprint) return;
        _observedFingerprint = diskFingerprint;
        NotificationId = Guid.NewGuid().ToString("N");
    }

    public bool Dismiss(string notificationId)
    {
        if (notificationId != NotificationId) return false;
        NotificationId = null;
        return true;
    }

    public void Reset()
    {
        _observedFingerprint = null;
        NotificationId = null;
        IsChanged = false;
    }
}
