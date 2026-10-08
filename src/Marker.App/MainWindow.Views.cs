using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Marker.App;

public sealed partial class MainWindow
{
    internal int ToolbarHeightDip => 68
        + (AppearancePanel.Visibility == Visibility.Visible ? 84 + (SettingsNotice.Visibility == Visibility.Visible ? 28 : 0) : 0)
        + (NotificationStatus.Visibility == Visibility.Visible ? 24 : 0);
    // The preview bridge still processes Markdig output behind the single editing surface.
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
        // Keep the old setting readable, but always open the single editing surface.
        _settings = _settings with { ViewMode = "split" };
        _settingsCanSave = loaded.CanSave;
        ThemeCombo.SelectedIndex = _settings.Theme switch { "light" => 1, "dark" => 2, _ => 0 };
        FontSizeBox.Value = _settings.FontSize;
        LineHeightBox.Value = _settings.LineHeight;
        LineWrappingToggle.IsChecked = _settings.LineWrapping;
        ReducedMotionToggle.IsChecked = _settings.ReducedMotion;
        RequestedTheme = _settings.Theme switch { "light" => ElementTheme.Light, "dark" => ElementTheme.Dark, _ => ElementTheme.Default };
        _viewsInitializing = false;
        SettingsNotice.Text = loaded.Warning ?? string.Empty;
        UpdateSettingsNotice();
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
            highContrast = IsHighContrast
        });
        if (_editorReady) _editor?.CoreWebView2.PostWebMessageAsJson(message);
        if (_previewReady) _preview?.CoreWebView2.PostWebMessageAsJson(message);
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

    private void Theme_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_viewsInitializing || ThemeCombo.SelectedIndex < 0) return;
        var theme = ThemeCombo.SelectedIndex switch { 1 => "light", 2 => "dark", _ => "system" };
        _settings = _settings with { Theme = theme };
        RequestedTheme = theme switch { "light" => ElementTheme.Light, "dark" => ElementTheme.Dark, _ => ElementTheme.Default };
        ApplySystemAppearance();
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

    private void Appearance_Click(object sender, RoutedEventArgs e)
    {
        AppearancePanel.Visibility = AppearanceButton.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        UpdateSettingsNotice();
        Layout();
        if (AppearancePanel.Visibility == Visibility.Visible) AnimateEntrance(AppearancePanel);
    }

    private void ReducedMotion_Click(object sender, RoutedEventArgs e)
    {
        if (_viewsInitializing) return;
        _settings = _settings with { ReducedMotion = ReducedMotionToggle.IsChecked == true };
        ApplySystemAppearance();
        ApplyWebSettings();
        PersistSettings();
    }

    private void PersistSettings()
    {
        if (!_settingsCanSave)
        {
            SettingsNotice.Text = "设置文件已保留；移走该文件后，才能保存外观更改。";
            UpdateSettingsNotice();
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
            SettingsNotice.Text = "设置保存失败，请检查文件访问权限。";
            UpdateSettingsNotice();
        }
    }
}
