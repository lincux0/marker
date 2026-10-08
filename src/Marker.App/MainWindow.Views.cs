using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Marker.App;

public sealed partial class MainWindow
{
    internal const int ToolbarHeightDip = 232;
    internal string _viewMode = "split";
    internal AppSettings _settings = AppSettings.Default;
    private readonly string _settingsDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Marker");
    private bool _viewsInitializing = true;
    private bool _settingsCanSave = true;

    internal void InitializeViews()
    {
        _viewsInitializing = true;
        var loaded = AppSettings.Load(_settingsDirectory);
        _settings = loaded.Settings;
        _viewMode = _settings.ViewMode;
        _settingsCanSave = loaded.CanSave;
        ViewModeCombo.SelectedIndex = _viewMode switch { "source" => 0, "read" => 2, _ => 1 };
        ThemeCombo.SelectedIndex = _settings.Theme switch { "light" => 1, "dark" => 2, _ => 0 };
        FontSizeBox.Value = _settings.FontSize;
        LineHeightBox.Value = _settings.LineHeight;
        LineWrappingToggle.IsChecked = _settings.LineWrapping;
        RequestedTheme = _settings.Theme switch { "light" => ElementTheme.Light, "dark" => ElementTheme.Dark, _ => ElementTheme.Default };
        _viewsInitializing = false;
        SettingsNotice.Text = loaded.Warning ?? string.Empty;
        if (loaded.Warning is not null) SetStatus(loaded.Warning);
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
            lineWrapping = _settings.LineWrapping
        });
        if (_editorReady) _editor?.CoreWebView2.PostWebMessageAsJson(message);
        if (_previewReady) _preview?.CoreWebView2.PostWebMessageAsJson(message);
    }

    internal void ApplyViewLayout()
    {
        Layout();
        if (_viewMode == "source") ++_renderRequest;
        else if (_latestSnapshot is { } snapshot && snapshot.Version != _latestPreviewSentVersion)
            _ = RenderSnapshotAsync(snapshot);
    }

    internal void UpdateEditorSelectionStatus(string text) => EditorSelectionStatus.Text = text;

    internal void SendEditorCommand(string command)
    {
        if (_closed || _operationBusy || !_editorReady || command is not ("undo" or "redo" or "find" or "replace"))
            return;
        _editor?.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "editorCommand",
            protocolVersion = 1,
            sessionId = _session.SessionId,
            command
        }));
    }

    private void ViewMode_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_viewsInitializing || ViewModeCombo.SelectedIndex < 0) return;
        if (_operationBusy)
        {
            _viewsInitializing = true;
            ViewModeCombo.SelectedIndex = _viewMode switch { "source" => 0, "read" => 2, _ => 1 };
            _viewsInitializing = false;
            SetStatus("文档操作期间暂不能切换视图。");
            return;
        }
        _viewMode = ViewModeCombo.SelectedIndex switch { 0 => "source", 2 => "read", _ => "split" };
        _settings = _settings with { ViewMode = _viewMode };
        ApplyViewLayout();
        var controller = _viewMode == "read" ? _preview : _editor;
        var window = _viewMode == "read" ? _previewWindow : _editorWindow;
        if (controller is not null) TryMoveFocus(controller, window, Microsoft.Web.WebView2.Core.CoreWebView2MoveFocusReason.Programmatic);
        PersistSettings();
    }

    private void Theme_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_viewsInitializing || ThemeCombo.SelectedIndex < 0) return;
        var theme = ThemeCombo.SelectedIndex switch { 1 => "light", 2 => "dark", _ => "system" };
        _settings = _settings with { Theme = theme };
        RequestedTheme = theme switch { "light" => ElementTheme.Light, "dark" => ElementTheme.Dark, _ => ElementTheme.Default };
        ApplyWebSettings();
        PersistSettings();
    }

    private void FontSize_ValueChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (_viewsInitializing || !double.IsFinite(args.NewValue)) return;
        var value = (int)Math.Round(args.NewValue);
        if (value is < 12 or > 24) return;
        _settings = _settings with { FontSize = value };
        ApplyWebSettings();
        PersistSettings();
    }

    private void LineHeight_ValueChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (_viewsInitializing || !double.IsFinite(args.NewValue) || args.NewValue is < 1.2 or > 2) return;
        _settings = _settings with { LineHeight = Math.Round(args.NewValue, 1) };
        ApplyWebSettings();
        PersistSettings();
    }

    private void LineWrapping_Click(object sender, RoutedEventArgs e)
    {
        if (_viewsInitializing) return;
        _settings = _settings with { LineWrapping = LineWrappingToggle.IsChecked == true };
        ApplyWebSettings();
        PersistSettings();
    }

    private void Undo_Click(object sender, RoutedEventArgs e) => SendEditorCommand("undo");
    private void Redo_Click(object sender, RoutedEventArgs e) => SendEditorCommand("redo");
    private void Find_Click(object sender, RoutedEventArgs e) => SendEditorCommand("find");
    private void Replace_Click(object sender, RoutedEventArgs e) => SendEditorCommand("replace");

    private void PersistSettings()
    {
        if (!_settingsCanSave)
        {
            SettingsNotice.Text = "现有设置已保留；请先移走损坏或新版设置文件，才能保存本次更改。";
            return;
        }
        try
        {
            _settings = _settings with { ApplicationVersion = typeof(AppSettings).Assembly.GetName().Version?.ToString() ?? "unknown" };
            _settings.Save(_settingsDirectory);
            SettingsNotice.Text = string.Empty;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            SettingsNotice.Text = $"设置保存失败：{error.Message}";
            SetStatus(SettingsNotice.Text);
        }
    }
}
