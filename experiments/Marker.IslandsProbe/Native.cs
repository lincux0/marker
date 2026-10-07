using System.Runtime.InteropServices;

namespace Marker.IslandsProbe;

internal static class Native
{
    internal delegate nint Procedure(nint window, uint message, nuint wParam, nint lParam);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct WindowClass
    {
        public uint Style;
        public nint Procedure;
        public int ClassExtra, WindowExtra;
        public nint Instance, Icon, Cursor, Background;
        public string? Menu;
        public string Name;
    }
    [StructLayout(LayoutKind.Sequential)]
    internal struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern ushort RegisterClassW(ref WindowClass value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint CreateWindowExW(uint extendedStyle, string className, string name, uint style,
        int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern nint DefWindowProcW(nint window, uint message, nuint wParam, nint lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    internal static extern nint GetModuleHandleW(string? moduleName);
    [DllImport("user32.dll")]
    internal static extern bool GetClientRect(nint window, out Rect rect);
    [DllImport("user32.dll")]
    internal static extern uint GetDpiForWindow(nint window);
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool SetWindowPos(nint window, nint insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")]
    internal static extern bool ShowWindow(nint window, int command);
    [DllImport("user32.dll")]
    internal static extern bool DestroyWindow(nint window);
    [DllImport("user32.dll")]
    internal static extern nint SetFocus(nint window);
}
