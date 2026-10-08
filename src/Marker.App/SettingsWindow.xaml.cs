using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Graphics;
using Windows.UI.ViewManagement;
using WinRT.Interop;

namespace Marker.App;

public sealed partial class SettingsWindow : Window
{
    private const int GwlpHwndParent = -8;
    private readonly Action<AppSettings> _onChanged;
    private AppSettings _settings;
    private bool _initializing = true;

    public SettingsWindow(AppSettings settings, string? notice, Action<AppSettings> onChanged)
    {
        InitializeComponent();
        _settings = settings;
        _onChanged = onChanged;
        ThemeCombo.SelectedIndex = IndexFor(ThemeCombo, settings.Theme);
        ColorPaletteCombo.SelectedIndex = IndexFor(ColorPaletteCombo, settings.ColorPalette);
        BodyFontCombo.SelectedIndex = IndexFor(BodyFontCombo, settings.BodyFont);
        H1FontCombo.SelectedIndex = IndexFor(H1FontCombo, settings.H1Font);
        H2FontCombo.SelectedIndex = IndexFor(H2FontCombo, settings.H2Font);
        FontSizeBox.Value = settings.FontSize;
        LineHeightBox.Value = settings.LineHeight;
        ParagraphSpacingBox.Value = settings.ParagraphSpacing;
        LineWrappingToggle.IsOn = settings.LineWrapping;
        ReducedMotionToggle.IsOn = settings.ReducedMotion;
        SetNotice(notice);
        _initializing = false;
    }

    public void ShowOwned(nint owner, RectInt32 bounds)
    {
        var hwnd = WindowNative.GetWindowHandle(this);
        _ = SetWindowLongPtrW(hwnd, GwlpHwndParent, owner);
        AppWindow.Resize(new SizeInt32(bounds.Width, bounds.Height));
        AppWindow.Move(new PointInt32(bounds.X, bounds.Y));
        Activate();
    }

    public void SetAppearance(ElementTheme theme, bool highContrast, bool reducedMotion)
    {
        SettingsRoot.RequestedTheme = highContrast ? ElementTheme.Default : theme;
        _ = reducedMotion; // This window does not run custom motion.
        SystemBackdrop = highContrast ? null : new MicaBackdrop();
        var uiSettings = highContrast ? new UISettings() : null;
        var colors = WritingPalette.GetColors(_settings.ColorPalette, theme == ElementTheme.Dark);
        SettingsRoot.Background = new SolidColorBrush(highContrast
            ? uiSettings!.GetColorValue(UIColorType.Background)
            : colors.Background);
        AccentMark.Background = new SolidColorBrush(highContrast
            ? uiSettings!.GetColorValue(UIColorType.Foreground)
            : colors.Accent);
        AccentIcon.Foreground = new SolidColorBrush(highContrast
            ? uiSettings!.GetColorValue(UIColorType.Background)
            : theme == ElementTheme.Dark ? Windows.UI.Color.FromArgb(255, 27, 26, 32)
            : Windows.UI.Color.FromArgb(255, 255, 255, 255));
    }

    public void SetNotice(string? message)
    {
        SettingsNotice.Text = message ?? string.Empty;
        NoticePanel.Visibility = string.IsNullOrWhiteSpace(message) ? Visibility.Collapsed : Visibility.Visible;
    }

    private static int IndexFor(ComboBox combo, string value)
    {
        for (var i = 0; i < combo.Items.Count; i++)
            if (combo.Items[i] is ComboBoxItem item && string.Equals(item.Tag?.ToString(), value, StringComparison.Ordinal)) return i;
        return 0;
    }

    private static string SelectedTag(ComboBox combo) =>
        (combo.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? string.Empty;

    private void Update(Func<AppSettings, AppSettings> update)
    {
        if (_initializing) return;
        _settings = update(_settings);
        _onChanged(_settings);
    }

    private void Theme_SelectionChanged(object sender, SelectionChangedEventArgs e) =>
        Update(settings => settings with { Theme = SelectedTag(ThemeCombo) });

    private void ColorPalette_SelectionChanged(object sender, SelectionChangedEventArgs e) =>
        Update(settings => settings with { ColorPalette = SelectedTag(ColorPaletteCombo) });

    private void BodyFont_SelectionChanged(object sender, SelectionChangedEventArgs e) =>
        Update(settings => settings with { BodyFont = SelectedTag(BodyFontCombo) });

    private void H1Font_SelectionChanged(object sender, SelectionChangedEventArgs e) =>
        Update(settings => settings with { H1Font = SelectedTag(H1FontCombo) });

    private void H2Font_SelectionChanged(object sender, SelectionChangedEventArgs e) =>
        Update(settings => settings with { H2Font = SelectedTag(H2FontCombo) });

    private void FontSize_ValueChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (double.IsFinite(args.NewValue) && args.NewValue is >= 12 and <= 24)
            Update(settings => settings with { FontSize = (int)Math.Round(args.NewValue) });
    }

    private void LineHeight_ValueChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (double.IsFinite(args.NewValue) && args.NewValue is >= 1.2 and <= 2)
            Update(settings => settings with { LineHeight = Math.Round(args.NewValue, 1) });
    }

    private void ParagraphSpacing_ValueChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (double.IsFinite(args.NewValue) && args.NewValue is >= 0 and <= 2)
            Update(settings => settings with { ParagraphSpacing = Math.Round(args.NewValue, 1) });
    }

    private void LineWrapping_Toggled(object sender, RoutedEventArgs e) =>
        Update(settings => settings with { LineWrapping = LineWrappingToggle.IsOn });

    private void ReducedMotion_Toggled(object sender, RoutedEventArgs e) =>
        Update(settings => settings with { ReducedMotion = ReducedMotionToggle.IsOn });

    [System.Runtime.InteropServices.DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern nint SetWindowLongPtrW(nint window, int index, nint value);
}
