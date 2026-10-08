using System.Runtime.InteropServices;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.System;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using Windows.UI.ViewManagement;

namespace Marker.App;

public sealed partial class MainWindow
{
    private const uint DwmaUseImmersiveDarkMode = 20;
    private const uint DwmaSystemBackdropType = 38;
    private const uint DwmsbtNone = 1;
    private const uint DwmsbtMainWindow = 2;
    private const uint SwShowNormal = 1;
    private const uint SwShowMaximized = 3;
    private const uint MonitorDefaultToNearest = 2;

    private UISettings? _uiSettings;
    private ThemeSettings? _themeSettings;
    private DispatcherQueue? _windowsDispatcherQueue;
    private nint _windowBackgroundBrush;
    private bool _ownsWindowBackgroundBrush;

    public bool IsHighContrast { get; private set; }
    public bool EffectiveReducedMotion => _settings.ReducedMotion || _uiSettings?.AnimationsEnabled == false;

    internal NativePoint GetMinimumTrackSize()
    {
        var dpi = Native.GetDpiForWindow(_window);
        var scale = (dpi == 0 ? 96 : dpi) / 96d;
        var width = (int)Math.Round(720 * scale);
        var height = (int)Math.Round(480 * scale);
        var monitor = WindowsNative.MonitorFromWindow(_window, MonitorDefaultToNearest);
        var info = new NativeMonitorInfo { Size = (uint)Marshal.SizeOf<NativeMonitorInfo>() };
        if (monitor != 0 && WindowsNative.GetMonitorInfoW(monitor, ref info))
        {
            width = Math.Min(width, info.Work.Right - info.Work.Left);
            height = Math.Min(height, info.Work.Bottom - info.Work.Top);
        }
        return new NativePoint { X = width, Y = height };
    }

    // Requested size is in DIP; AppWindow consumes physical pixels on the owner's monitor.
    internal Windows.Graphics.RectInt32 GetSettingsWindowBounds(int widthDip, int heightDip)
    {
        var dpi = Native.GetDpiForWindow(_window);
        var scale = (dpi == 0 ? 96 : dpi) / 96d;
        if (!WindowsNative.GetWindowRect(_window, out var owner))
            throw new InvalidOperationException("无法读取主窗口位置。");
        var monitor = WindowsNative.MonitorFromWindow(_window, MonitorDefaultToNearest);
        var info = new NativeMonitorInfo { Size = (uint)Marshal.SizeOf<NativeMonitorInfo>() };
        var work = monitor != 0 && WindowsNative.GetMonitorInfoW(monitor, ref info) ? info.Work : owner;
        var width = Math.Clamp((int)Math.Round(widthDip * scale), 1, Math.Max(1, work.Right - work.Left));
        var height = Math.Clamp((int)Math.Round(heightDip * scale), 1, Math.Max(1, work.Bottom - work.Top));
        var left = Math.Clamp(owner.Left + (owner.Right - owner.Left - width) / 2, work.Left, work.Right - width);
        var top = Math.Clamp(owner.Top + (owner.Bottom - owner.Top - height) / 2, work.Top, work.Bottom - height);
        return new Windows.Graphics.RectInt32(left, top, width, height);
    }

    internal void InitializeWindowsExperience()
    {
        _windowsDispatcherQueue = DispatcherQueue.GetForCurrentThread();
        _uiSettings = new UISettings();
        _themeSettings = ThemeSettings.CreateForWindowId(Win32Interop.GetWindowIdFromWindow(_window));
        _uiSettings.ColorValuesChanged += SystemAppearanceChanged;
        _uiSettings.AnimationsEnabledChanged += SystemAppearanceChanged;
        _themeSettings.Changed += SystemAppearanceChanged;
        ApplySystemAppearance();
        RestoreWindowPlacement(_settings.WindowPlacement);
    }

    internal void ApplySystemAppearance()
    {
        if (_closed) return;
        IsHighContrast = _themeSettings?.HighContrast ?? false;
        var isSystemDark = IsSystemDarkTheme();
        var dark = _settings.Theme switch
        {
            "dark" => true,
            "light" => false,
            _ => isSystemDark
        };

        RequestedTheme = IsHighContrast ? Microsoft.UI.Xaml.ElementTheme.Default
            : dark ? Microsoft.UI.Xaml.ElementTheme.Dark : Microsoft.UI.Xaml.ElementTheme.Light;

        // XAML Islands owns its rendering surface: a transparent Grid alone
        // cannot reveal the parent HWND backdrop. Use its native backdrop API.
        _toolbar.SystemBackdrop = IsHighContrast ? null : _toolbar.SystemBackdrop ?? new MicaBackdrop();
        RootGrid.Background = IsHighContrast
            ? new SolidColorBrush(_uiSettings?.GetColorValue(UIColorType.Background) ?? Color.FromArgb(255, 0, 0, 0))
            : new SolidColorBrush(Color.FromArgb(0, 0, 0, 0));

        var darkMode = dark && !IsHighContrast ? 1 : 0;
        WindowsNative.DwmSetWindowAttribute(_window, DwmaUseImmersiveDarkMode, ref darkMode, sizeof(int));
        var margins = new NativeMargins { Left = -1, Right = -1, Top = -1, Bottom = -1 };
        var micaEnabled = !IsHighContrast && WindowsNative.DwmExtendFrameIntoClientArea(_window, ref margins) >= 0;
        var backdrop = micaEnabled ? DwmsbtMainWindow : DwmsbtNone;
        if (WindowsNative.DwmSetWindowAttribute(_window, DwmaSystemBackdropType, ref backdrop, sizeof(uint)) < 0)
        {
            micaEnabled = false;
            backdrop = DwmsbtNone;
            WindowsNative.DwmSetWindowAttribute(_window, DwmaSystemBackdropType, ref backdrop, sizeof(uint));
        }
        if (!micaEnabled)
        {
            var solidFrame = new NativeMargins();
            WindowsNative.DwmExtendFrameIntoClientArea(_window, ref solidFrame);
        }
        SetWindowBackgroundBrush(dark);

        WindowsNative.InvalidateRect(_window, 0, true);
        RefreshMotionPreferences();
        _settingsWindow?.SetAppearance(RequestedTheme, IsHighContrast, EffectiveReducedMotion);
        ApplyWebSettings();
    }

    internal bool PaintWindowBackground(nint hdc)
    {
        if (hdc == 0 || _windowBackgroundBrush == 0 || !Native.GetClientRect(_window, out var client)) return false;
        var rect = new NativeRect { Left = client.Left, Top = client.Top, Right = client.Right, Bottom = client.Bottom };
        return WindowsNative.FillRect(hdc, ref rect, _windowBackgroundBrush) != 0;
    }

    internal void SaveWindowPlacement()
    {
        if (_closed || !_settingsCanSave || !TryGetWindowPlacement(out var placement)) return;
        try
        {
            _settings = _settings with
            {
                ApplicationVersion = typeof(AppSettings).Assembly.GetName().Version?.ToString() ?? "unknown",
                WindowPlacement = placement
            };
            _settings.Save(_settingsDirectory);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            SetSettingsNotice("窗口位置保存失败；其他偏好仍可使用。");
        }
    }

    internal void DisposeWindowsExperience()
    {
        if (_uiSettings is not null)
        {
            _uiSettings.ColorValuesChanged -= SystemAppearanceChanged;
            _uiSettings.AnimationsEnabledChanged -= SystemAppearanceChanged;
        }
        if (_themeSettings is not null) _themeSettings.Changed -= SystemAppearanceChanged;
        if (_ownsWindowBackgroundBrush && _windowBackgroundBrush != 0)
            WindowsNative.DeleteObject(_windowBackgroundBrush);
        _windowBackgroundBrush = 0;
        _ownsWindowBackgroundBrush = false;
        _uiSettings = null;
        _themeSettings = null;
        _windowsDispatcherQueue = null;
    }

    private void SystemAppearanceChanged(object? sender, object args)
    {
        if (_windowsDispatcherQueue?.HasThreadAccess == true)
        {
            ApplySystemAppearance();
            return;
        }
        _windowsDispatcherQueue?.TryEnqueue(ApplySystemAppearance);
    }

    private bool IsSystemDarkTheme()
    {
        try
        {
            var background = _uiSettings?.GetColorValue(UIColorType.Background) ?? Colors.White;
            return background.R * 299 + background.G * 587 + background.B * 114 < 128000;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    private void SetWindowBackgroundBrush(bool dark)
    {
        var replacement = IsHighContrast
            ? WindowsNative.GetSysColorBrush(5)
            : WindowsNative.CreateSolidBrush(dark ? 0x00201A1Bu : 0x00FAF7F8u);
        var ownsReplacement = !IsHighContrast && replacement != 0;
        if (replacement == 0) replacement = WindowsNative.GetSysColorBrush(5);
        var previous = _windowBackgroundBrush;
        var ownsPrevious = _ownsWindowBackgroundBrush;
        _windowBackgroundBrush = replacement;
        _ownsWindowBackgroundBrush = ownsReplacement;
        if (ownsPrevious && previous != 0) WindowsNative.DeleteObject(previous);
    }

    private void RestoreWindowPlacement(WindowPlacement? saved)
    {
        var placement = new NativeWindowPlacement { Length = (uint)Marshal.SizeOf<NativeWindowPlacement>() };
        if (!WindowsNative.GetWindowPlacement(_window, ref placement)) return;
        var restored = saved is { IsValid: true } ? saved : null;
        var restoreSaved = restored is not null;
        var rect = restoreSaved
            ? new NativeRect { Left = restored!.Left, Top = restored.Top, Right = restored.Left + restored.Width, Bottom = restored.Top + restored.Height }
            : placement.NormalPosition;
        var monitor = restoreSaved
            ? WindowsNative.MonitorFromRect(ref rect, MonitorDefaultToNearest)
            : WindowsNative.MonitorFromWindow(_window, MonitorDefaultToNearest);
        var info = new NativeMonitorInfo { Size = (uint)Marshal.SizeOf<NativeMonitorInfo>() };
        if (monitor == 0 || !WindowsNative.GetMonitorInfoW(monitor, ref info)) return;

        var dpi = Native.GetDpiForWindow(_window);
        WindowsNative.GetDpiForMonitor(monitor, 0, out var monitorDpi, out _);
        var scale = (monitorDpi == 0 ? dpi == 0 ? 96 : dpi : monitorDpi) / 96d;
        var minimumWidth = (int)Math.Round(720 * scale);
        var minimumHeight = (int)Math.Round(480 * scale);
        var source = restoreSaved ? restored! : new WindowPlacement(
            rect.Left + info.Work.Left - info.Monitor.Left, rect.Top + info.Work.Top - info.Monitor.Top,
            (int)Math.Round(960 * scale), (int)Math.Round(700 * scale), false);
        var clamped = WindowPlacement.ClampToWorkArea(source, info.Work.Left, info.Work.Top, info.Work.Right,
            info.Work.Bottom, minimumWidth, minimumHeight);
        // WINDOWPLACEMENT uses workspace coordinates; the persisted bounds
        // and monitor work-area calculations use physical screen coordinates.
        var workspaceOffsetX = info.Work.Left - info.Monitor.Left;
        var workspaceOffsetY = info.Work.Top - info.Monitor.Top;
        placement.ShowCommand = restoreSaved && restored!.Maximized ? SwShowMaximized : SwShowNormal;
        placement.NormalPosition = new NativeRect
        {
            Left = clamped.Left - workspaceOffsetX,
            Top = clamped.Top - workspaceOffsetY,
            Right = clamped.Left + clamped.Width - workspaceOffsetX,
            Bottom = clamped.Top + clamped.Height - workspaceOffsetY
        };
        WindowsNative.SetWindowPlacement(_window, ref placement);
    }

    private bool TryGetWindowPlacement(out WindowPlacement? saved)
    {
        saved = null;
        var placement = new NativeWindowPlacement { Length = (uint)Marshal.SizeOf<NativeWindowPlacement>() };
        if (!WindowsNative.GetWindowPlacement(_window, ref placement)) return false;
        var rect = placement.NormalPosition;
        var monitor = WindowsNative.MonitorFromWindow(_window, MonitorDefaultToNearest);
        var info = new NativeMonitorInfo { Size = (uint)Marshal.SizeOf<NativeMonitorInfo>() };
        if (monitor == 0 || !WindowsNative.GetMonitorInfoW(monitor, ref info)) return false;
        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        var candidate = new WindowPlacement(rect.Left + info.Work.Left - info.Monitor.Left,
            rect.Top + info.Work.Top - info.Monitor.Top, width, height,
            placement.ShowCommand == SwShowMaximized || placement.ShowCommand == 2 && (placement.Flags & 2) != 0);
        if (!candidate.IsValid) return false;
        saved = candidate;
        return true;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeWindowPlacement
    {
        public uint Length;
        public uint Flags;
        public uint ShowCommand;
        public NativePoint MinPosition;
        public NativePoint MaxPosition;
        public NativeRect NormalPosition;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeMonitorInfo
    {
        public uint Size;
        public NativeRect Monitor;
        public NativeRect Work;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeMargins
    {
        public int Left;
        public int Right;
        public int Top;
        public int Bottom;
    }

    internal static class WindowsNative
    {
        [DllImport("dwmapi.dll")]
        internal static extern int DwmExtendFrameIntoClientArea(nint window, ref NativeMargins margins);

        [DllImport("dwmapi.dll")]
        internal static extern int DwmSetWindowAttribute(nint window, uint attribute, ref int value, uint valueSize);

        [DllImport("dwmapi.dll")]
        internal static extern int DwmSetWindowAttribute(nint window, uint attribute, ref uint value, uint valueSize);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetWindowRect(nint window, out NativeRect rect);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetWindowPlacement(nint window, ref NativeWindowPlacement placement);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool SetWindowPlacement(nint window, ref NativeWindowPlacement placement);

        [DllImport("user32.dll", SetLastError = true)]
        internal static extern nint MonitorFromRect(ref NativeRect rect, uint flags);

        [DllImport("user32.dll")]
        internal static extern nint MonitorFromWindow(nint window, uint flags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetMonitorInfoW", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetMonitorInfoW(nint monitor, ref NativeMonitorInfo info);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool InvalidateRect(nint window, nint rect, [MarshalAs(UnmanagedType.Bool)] bool erase);

        [DllImport("user32.dll")]
        internal static extern nint GetSysColorBrush(int index);

        [DllImport("gdi32.dll")]
        internal static extern nint CreateSolidBrush(uint colorRef);

        [DllImport("gdi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool DeleteObject(nint value);

        [DllImport("user32.dll")]
        internal static extern int FillRect(nint hdc, ref NativeRect rect, nint brush);

        [DllImport("shcore.dll")]
        internal static extern int GetDpiForMonitor(nint monitor, int dpiType, out uint dpiX, out uint dpiY);
    }
}
