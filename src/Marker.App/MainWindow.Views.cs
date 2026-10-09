using System.Text.Json;
using Microsoft.UI.Xaml;

namespace Marker.App;

public sealed partial class MainWindow
{
    internal string _viewMode = "split";
    internal AppSettings _settings = AppSettings.Default;
    private readonly string _settingsDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Marker");
    private bool _viewsInitializing = true;
    private bool _settingsCanSave = true;
    private string? _settingsNotice;
    private SettingsWindow? _settingsWindow;

    internal void InitializeViews()
    {
        var loaded = AppSettings.Load(_settingsDirectory);
        _settings = loaded.Settings with { ViewMode = "split" };
        _settingsCanSave = loaded.CanSave;
        _settingsNotice = loaded.Warning;
        RequestedTheme = _settings.Theme switch { "light" => ElementTheme.Light, "dark" => ElementTheme.Dark, _ => ElementTheme.Default };
        _viewsInitializing = false;
    }

    internal void ApplyWebSettings()
    {
        var message = JsonSerializer.Serialize(new
        {
            type = "settings",
            protocolVersion = 1,
            sessionId = _session.SessionId,
            theme = _settings.Theme,
            fontSize = _settings.FontSize,
            lineHeight = _settings.LineHeight,
            lineWrapping = _settings.LineWrapping,
            reducedMotion = EffectiveReducedMotion,
            highContrast = IsHighContrast,
            paragraphSpacing = _settings.ParagraphSpacing,
            bodyFont = _settings.BodyFont,
            h1Font = _settings.H1Font,
            h2Font = _settings.H2Font,
            colorPalette = _settings.ColorPalette,
            hiddenToolbarActions = _settings.HiddenToolbarActions ?? []
        });
        if (_editorReady) _editor?.CoreWebView2.PostWebMessageAsJson(message);
        if (_previewReady) _preview?.CoreWebView2.PostWebMessageAsJson(message);
    }

    private void SendToolbarState()
    {
        if (_closed || !_editorReady || _editor is null) return;
        var title = DocumentStatus.Text;
        var notification = NotificationStatus.Visibility == Visibility.Visible ? NotificationStatus.Text : "";
        _editor.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "toolbarState",
            protocolVersion = BridgeSession.ProtocolVersion,
            sessionId = _session.SessionId,
            title = title[..Math.Min(title.Length, 4096)],
            notification = notification[..Math.Min(notification.Length, 4096)],
            busy = _operationBusy
        }));
    }

    internal void SendEditorCommand(string command)
    {
        if (_closed || _operationBusy || !_editorReady || command is not ("undo" or "redo" or "find" or "replace" or "toggleSource"))
            return;
        _editor?.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "editorCommand",
            protocolVersion = 1,
            sessionId = _session.SessionId,
            command
        }));
    }

    private void Undo_Click(object sender, RoutedEventArgs e) => SendEditorCommand("undo");
    private void Redo_Click(object sender, RoutedEventArgs e) => SendEditorCommand("redo");
    private void Find_Click(object sender, RoutedEventArgs e) => SendEditorCommand("find");
    private void Replace_Click(object sender, RoutedEventArgs e) => SendEditorCommand("replace");

    private void Appearance_Click(object sender, RoutedEventArgs e) => ShowSettingsWindow();

    private void ShowSettingsWindow()
    {
        if (_closed || _operationBusy) return;
        if (_settingsWindow is not null)
        {
            _settingsWindow.Activate();
            return;
        }

        var window = new SettingsWindow(_settings, _settingsNotice, SettingsChanged);
        _settingsWindow = window;
        window.Closed += (_, _) =>
        {
            if (!ReferenceEquals(_settingsWindow, window)) return;
            _settingsWindow = null;
            // Defer owner activation until the owned WinUI window has finished its close event.
            DispatcherQueue.TryEnqueue(() =>
            {
                if (_closed || _allowClose || _operationBusy || _settingsWindow is not null) return;
                Native.ShowWindow(_window, IsIconic(_window) ? 9 : 5);
                SetForegroundWindow(_window);
                TryMoveFocus(_editor, _editorWindow, Microsoft.Web.WebView2.Core.CoreWebView2MoveFocusReason.Programmatic);
            });
        };
        window.SetAppearance(RequestedTheme, IsHighContrast, EffectiveReducedMotion);
        window.ShowOwned(_window, GetSettingsWindowBounds(720, 780));
    }

    private void SettingsChanged(AppSettings settings)
    {
        if (_closed || _viewsInitializing) return;
        _settings = settings with { WindowPlacement = _settings.WindowPlacement, ApplicationVersion = _settings.ApplicationVersion };
        RequestedTheme = _settings.Theme switch { "light" => ElementTheme.Light, "dark" => ElementTheme.Dark, _ => ElementTheme.Default };
        ApplySystemAppearance();
        PersistSettings();
    }

    private void PersistSettings()
    {
        if (!_settingsCanSave)
        {
            SetSettingsNotice("设置文件无法安全覆盖；当前修改仅在本次运行中生效。修复或移走该文件后可恢复保存。");
            return;
        }
        try
        {
            _settings = _settings with { ApplicationVersion = typeof(AppSettings).Assembly.GetName().Version?.ToString() ?? "unknown" };
            _settings.Save(_settingsDirectory);
            SetSettingsNotice(null);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            SetSettingsNotice("设置保存失败，请检查文件访问权限。");
        }
    }

    internal void SetSettingsNotice(string? message)
    {
        _settingsNotice = message;
        _settingsWindow?.SetNotice(message);
    }
}
