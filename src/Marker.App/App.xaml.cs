using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using Windows.ApplicationModel.Activation;

namespace Marker.App;

public partial class App : Application
{
    private volatile MainWindow? _window;
    private AppInstance? _instance;
    private readonly ConcurrentQueue<AppActivationArguments> _pendingActivations = new();
    private int _activationDrainActive;

    public App()
    {
        InitializeComponent();
        // The main window is Win32; only its close workflow should stop the message pump.
        DispatcherShutdownMode = DispatcherShutdownMode.OnExplicitShutdown;
    }

    protected override async void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        var activation = AppInstance.GetCurrent().GetActivatedEventArgs();
        var instance = AppInstance.FindOrRegisterForKey("Marker");
        if (!instance.IsCurrent)
        {
            if (activation is not null) await instance.RedirectActivationToAsync(activation);
            Exit();
            return;
        }

        _instance = instance;
        _instance.Activated += (_, redirected) => QueueActivation(redirected);
        _window = new MainWindow();
        _window.Show();
        QueueActivation(activation);

        // Direct launches from a terminal or another process carry argv rather than a file activation.
        var commandLineFiles = Environment.GetCommandLineArgs().Skip(1);
        if (commandLineFiles.Any()) _window.QueueOpenFiles(commandLineFiles);
    }

    private void QueueActivation(AppActivationArguments? activation)
    {
        if (activation is not null) _pendingActivations.Enqueue(activation);
        DrainPendingActivations();
    }

    private void DrainPendingActivations()
    {
        if (_window is null || Interlocked.Exchange(ref _activationDrainActive, 1) != 0) return;
        try
        {
            while (_pendingActivations.TryDequeue(out var activation)) RouteActivation(activation);
        }
        finally
        {
            Interlocked.Exchange(ref _activationDrainActive, 0);
            if (!_pendingActivations.IsEmpty) DrainPendingActivations();
        }
    }

    private void RouteActivation(AppActivationArguments activation)
    {
        var window = _window;
        if (window is null) return;
        if (activation.Kind == ExtendedActivationKind.File && activation.Data is IFileActivatedEventArgs fileActivation)
        {
            window.QueueOpenFiles(fileActivation.Files.OfType<Windows.Storage.IStorageFile>().Select(file => file.Path));
            return;
        }

        if (activation.Kind == ExtendedActivationKind.Launch && activation.Data is ILaunchActivatedEventArgs launch)
            window.QueueOpenFiles(string.IsNullOrWhiteSpace(launch.Arguments) ? [] : ParseCommandLine(launch.Arguments));
    }

    private static IReadOnlyList<string> ParseCommandLine(string arguments)
    {
        var commandLine = $"Marker.exe {arguments}";
        var argv = CommandLineToArgvW(commandLine, out var count);
        if (argv == 0) return [];
        try
        {
            var paths = new List<string>(Math.Max(0, count - 1));
            for (var index = 1; index < count; index++)
            {
                var argument = Marshal.ReadIntPtr(argv, index * IntPtr.Size);
                var value = Marshal.PtrToStringUni(argument);
                if (value is not null) paths.Add(value);
            }
            return paths;
        }
        finally { LocalFree(argv); }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint CommandLineToArgvW(string commandLine, out int argumentCount);
    [DllImport("kernel32.dll")] private static extern nint LocalFree(nint memory);
}
