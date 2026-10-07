using Microsoft.UI.Xaml;

namespace Marker.IslandsProbe;

public partial class App : Application
{
    private ProbeWindow? _probe;
    public App() => InitializeComponent();
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _probe = new ProbeWindow();
        _probe.Show();
    }
}
