using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.Web.WebView2.Core;
using Windows.Foundation;
using Windows.Graphics;

namespace Marker.App;

public sealed partial class MainWindow : UserControl
{
    private const string EditorUrl = "https://editor.marker.example/index.html";
    private const string PreviewUrl = "https://preview.marker.example/preview.html";
    private const string EditorHost = "editor.marker.example";
    private const string PreviewHost = "preview.marker.example";
    private const uint WsOverlappedWindow = 0x00CF0000;
    private const uint WsVisible = 0x10000000;
    private const uint WsClipChildren = 0x02000000;
    private const uint WsChildVisible = 0x56000000;
    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpNoActivate = 0x0010;
    private const uint WmSize = 0x0005;
    private const uint WmMove = 0x0003;
    private const uint WmSetFocus = 0x0007;
    private const uint WmClose = 0x0010;
    private const uint WmGetMinMaxInfo = 0x0024;
    private const uint WmDpiChanged = 0x02E0;
    private readonly Native.Procedure _procedure;
    private readonly DesktopWindowXamlSource _toolbar;
    private BridgeSession _session = new(Guid.NewGuid().ToString("N"));
    private readonly nint _window;
    private readonly nint _editorWindow;
    private readonly nint _previewWindow;
    private readonly string _className;
    private CoreWebView2Controller? _editor;
    private CoreWebView2Controller? _preview;
    private MarkdownSnapshot? _latestSnapshot;
    private long _latestPreviewSentVersion = -1;
    private long _renderRequest;
    private bool _editorReady;
    private bool _previewReady;
    private bool _closed;
    private nint _lastFocus;

    public MainWindow()
    {
        InitializeComponent();
        _procedure = WindowProcedure;
        var module = Native.GetModuleHandleW(null);
        _className = "Marker.MainWindow." + Guid.NewGuid().ToString("N");
        var definition = new Native.WindowClass
        {
            Procedure = Marshal.GetFunctionPointerForDelegate(_procedure),
            Instance = module,
            Name = _className,
            Background = 6
        };
        if (Native.RegisterClassW(ref definition) == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error());

        _window = Native.CreateWindowExW(0, _className, "Marker", WsOverlappedWindow | WsVisible | WsClipChildren,
            200, 150, 1200, 850, 0, 0, module, 0);
        if (_window == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error());

        _editorWindow = CreateChild("Marker editor");
        _previewWindow = CreateChild("Marker preview");
        _toolbar = new DesktopWindowXamlSource();
        _toolbar.Initialize(Win32Interop.GetWindowIdFromWindow(_window));
        _toolbar.Content = this;
        _toolbar.TakeFocusRequested += Toolbar_TakeFocusRequested;
        _toolbar.GotFocus += (_, _) => _lastFocus = 0;
        InitializeDocuments();
    }

    internal void Show()
    {
        Native.ShowWindow(_window, 5);
        Layout();
        InitializeWebViewsAsync();
    }

    private nint CreateChild(string title)
    {
        var child = Native.CreateWindowExW(0, _className, title, WsChildVisible, 0, 0, 1, 1,
            _window, 0, Native.GetModuleHandleW(null), 0);
        if (child == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return child;
    }

    private async void InitializeWebViewsAsync()
    {
        try
        {
            var webRoot = Path.Combine(AppContext.BaseDirectory, "Web");
            if (!File.Exists(Path.Combine(webRoot, "index.html")) || !File.Exists(Path.Combine(webRoot, "preview.html")))
                throw new FileNotFoundException("应用内 Web 资源不完整，请重新构建安装包。");

            var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Marker", "WebView2");
            var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, userData, new CoreWebView2EnvironmentOptions());
            if (_closed) return;

            var editor = await environment.CreateCoreWebView2ControllerAsync(
                CoreWebView2ControllerWindowReference.CreateFromWindowHandle((ulong)_editorWindow));
            if (_closed) { editor.Close(); return; }
            _editor = editor;

            var preview = await environment.CreateCoreWebView2ControllerAsync(
                CoreWebView2ControllerWindowReference.CreateFromWindowHandle((ulong)_previewWindow));
            if (_closed) { preview.Close(); return; }
            _preview = preview;

            ConfigureController(editor, true);
            ConfigureController(preview, false);
            ConfigureWebView(editor.CoreWebView2, EditorUrl, EditorHost, true);
            ConfigureWebView(preview.CoreWebView2, PreviewUrl, PreviewHost, false);
            Layout();
            editor.CoreWebView2.Navigate(EditorUrl);
            preview.CoreWebView2.Navigate(PreviewUrl);
        }
        catch (Exception exception)
        {
            CloseControllers();
            if (!_closed)
                SetStatus($"WebView2 初始化失败：{exception.Message}");
        }
    }

    private void ConfigureController(CoreWebView2Controller controller, bool editor)
    {
        controller.BoundsMode = CoreWebView2BoundsMode.UseRawPixels;
        controller.GotFocus += (_, _) => _lastFocus = editor ? _editorWindow : _previewWindow;
        controller.MoveFocusRequested += (_, args) =>
        {
            if (editor && args.Reason == CoreWebView2MoveFocusReason.Next)
            {
                args.Handled = TryMoveFocus(_preview, _previewWindow, CoreWebView2MoveFocusReason.Next);
                return;
            }
            if (!editor && args.Reason == CoreWebView2MoveFocusReason.Previous)
            {
                args.Handled = TryMoveFocus(_editor, _editorWindow, CoreWebView2MoveFocusReason.Previous);
                return;
            }
            _toolbar.NavigateFocus(new XamlSourceFocusNavigationRequest(args.Reason == CoreWebView2MoveFocusReason.Previous
                ? XamlSourceFocusNavigationReason.Last
                : XamlSourceFocusNavigationReason.First));
            args.Handled = _toolbar.HasFocus;
        };
    }

    private void Toolbar_TakeFocusRequested(object? sender, DesktopWindowXamlSourceTakeFocusRequestedEventArgs args)
    {
        if (args.Request.Reason == XamlSourceFocusNavigationReason.Last)
            TryMoveFocus(_preview, _previewWindow, CoreWebView2MoveFocusReason.Previous);
        else
            TryMoveFocus(_editor, _editorWindow, CoreWebView2MoveFocusReason.Next);
    }

    private void ConfigureWebView(CoreWebView2 core, string pageUrl, string host, bool editor)
    {
        core.SetVirtualHostNameToFolderMapping(host, Path.Combine(AppContext.BaseDirectory, "Web"), CoreWebView2HostResourceAccessKind.DenyCors);
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.NavigationStarting += (_, args) => args.Cancel = !string.Equals(args.Uri, pageUrl, StringComparison.Ordinal);
        core.FrameNavigationStarting += (_, args) => args.Cancel = true;
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, args) =>
        {
            if (!editor && Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var resourceUri)
                && resourceUri.Host == "document.marker.example")
            {
                if (_images.TryRead(args.Request.Uri, out var bytes, out var mime))
                    args.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(bytes).AsRandomAccessStream(), 200, "OK",
                        $"Content-Type: {mime}\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'");
                else
                    args.Response = core.Environment.CreateWebResourceResponse(null, 403, "Blocked", "Content-Type: text/plain");
                return;
            }
            var uri = Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var parsed) ? parsed : null;
            var path = uri is null ? string.Empty : Uri.UnescapeDataString(uri.AbsolutePath);
            var pathAllowed = path == (editor ? "/index.html" : "/preview.html")
                || path.StartsWith("/assets/", StringComparison.Ordinal);
            var hasTraversal = path.Split('/').Any(segment => segment is "." or "..") || path.Contains('\\');
            if (uri is null || uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort || uri.UserInfo.Length != 0
                || uri.Host != host || uri.Query.Length != 0 || !pathAllowed || hasTraversal)
                args.Response = core.Environment.CreateWebResourceResponse(null, 403, "Blocked", "Content-Type: text/plain");
        };
        core.WebMessageReceived += (_, args) =>
        {
            if (_closed) return;
            if (editor)
                HandleEditorMessage(args.Source, args.WebMessageAsJson);
            else
                HandlePreviewMessage(args.Source, args.WebMessageAsJson);
        };
    }

    private void HandleEditorMessage(string source, string json)
    {
        if (!_editorReady && _session.TryReadReady(source, EditorUrl, json))
        {
            _editorReady = true;
            _editor?.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "initialize",
                sessionId = _session.SessionId,
                text = _document.Text
            }));
            SetStatus("编辑器已连接，等待首个快照。");
            _ = OfferRecoveryOnStartupAsync();
            return;
        }

        if (_session.TryReadCommand(source, EditorUrl, json, out var command, out _))
        {
            _ = ExecuteDocumentCommandAsync(command);
            return;
        }
        if (_session.TryReadSnapshotError(source, EditorUrl, json, out var requestId, out var reason, out _))
        {
            if (requestId == _snapshotRequestId)
                _snapshotCompletion?.TrySetException(new IOException("请先完成输入法选词，再保存或切换文档。"));
            return;
        }

        if (!_session.TryAcceptSnapshot(source, EditorUrl, json, out var snapshot, out var error))
        {
            SetStatus(error);
            return;
        }
        _latestSnapshot = snapshot;
        AcceptDocumentSnapshot(snapshot);
        _ = RenderSnapshotAsync(snapshot);
    }

    private void HandlePreviewMessage(string source, string json)
    {
        if (!_previewReady && _session.TryReadReady(source, PreviewUrl, json))
        {
            _previewReady = true;
            _preview?.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "initialize",
                sessionId = _session.SessionId
            }));
            SetStatus("预览已连接，等待渲染。");
            if (_latestSnapshot is { } snapshot)
                _ = RenderSnapshotAsync(snapshot);
            return;
        }

        if (!_session.TryAcceptRendered(source, PreviewUrl, json, out var version, out var error))
        {
            SetStatus(error);
            return;
        }
        if (version == _latestPreviewSentVersion && version == _session.Version)
            SetStatus($"预览已同步 · v{version}");
    }

    private async Task RenderSnapshotAsync(MarkdownSnapshot snapshot)
    {
        try
        {
            var session = _session;
            var renderRequest = ++_renderRequest;
            var resolver = _images.CreateResolver(session.SessionId);
            var html = await Task.Run(() => MarkdownRenderer.Render(snapshot.Text, resolver));
            if (_closed || renderRequest != _renderRequest || !ReferenceEquals(session, _session) || snapshot.Version != session.Version || !_previewReady || _preview is null)
                return;

            _latestPreviewSentVersion = snapshot.Version;
            _preview.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "render",
                sessionId = _session.SessionId,
                version = snapshot.Version,
                html
            }));
        }
        catch (Exception exception)
        {
            if (!_closed)
                SetStatus($"Markdown 解析失败：{exception.Message}");
        }
    }

    private void EditorFocusButton_Click(object sender, RoutedEventArgs e)
        => TryMoveFocus(_editor, _editorWindow, CoreWebView2MoveFocusReason.Next);

    private bool TryMoveFocus(CoreWebView2Controller? controller, nint childWindow, CoreWebView2MoveFocusReason reason)
    {
        // Modal file dialogs can restore WM_SETFOCUS before their async operation completes.
        if (_closed || _operationBusy || controller is null || !Native.IsWindowEnabled(_window)
            || !Native.IsWindowEnabled(childWindow)) return false;
        try
        {
            if (!controller.IsVisible) return false;
            controller.MoveFocus(reason);
            return true;
        }
        catch (Exception error) when (error is ArgumentException or COMException)
        {
            SetStatus("窗口焦点暂不可用，请点击编辑区重试。");
            return false;
        }
    }

    private void ResyncButton_Click(object sender, RoutedEventArgs e)
    {
        if (!_editorReady || _closed || _editor is null)
        {
            SetStatus("编辑器尚未就绪，无法重新同步。");
            return;
        }
        _editor.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "requestSnapshot",
            sessionId = _session.SessionId
        }));
        SetStatus("已请求编辑器发送完整快照。");
    }

    private void SetStatus(string message) => BridgeStatus.Text = message;

    private void Layout()
    {
        if (_closed) return;
        Native.GetClientRect(_window, out var rect);
        var scale = Native.GetDpiForWindow(_window) / 96d;
        var header = (int)Math.Round(152 * scale);
        var gap = (int)Math.Round(12 * scale);
        var width = Math.Max(1, (rect.Right - gap * 3) / 2);
        var height = Math.Max(1, rect.Bottom - header - gap);
        _toolbar.SiteBridge.MoveAndResize(new RectInt32(0, 0, Math.Max(1, rect.Right), header));
        ResizeView(_editorWindow, _editor, gap, header, width, height);
        ResizeView(_previewWindow, _preview, width + gap * 2, header, width, height);
    }

    private static void ResizeView(nint window, CoreWebView2Controller? controller, int x, int y, int width, int height)
    {
        if (!Native.SetWindowPos(window, 0, x, y, width, height, SwpNoZOrder | SwpNoActivate))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if (controller is not null)
        {
            controller.Bounds = new Rect(0, 0, width, height);
            controller.NotifyParentWindowPositionChanged();
            controller.IsVisible = true;
        }
    }

    private nint WindowProcedure(nint window, uint message, nuint wParam, nint lParam)
    {
        if (window == _window)
        {
            if (message == WmSize)
            {
                Layout();
                return 0;
            }
            if (message == WmMove)
            {
                _editor?.NotifyParentWindowPositionChanged();
                _preview?.NotifyParentWindowPositionChanged();
            }
            if (message == WmSetFocus)
            {
                if (_lastFocus == _editorWindow) TryMoveFocus(_editor, _editorWindow, CoreWebView2MoveFocusReason.Programmatic);
                if (_lastFocus == _previewWindow) TryMoveFocus(_preview, _previewWindow, CoreWebView2MoveFocusReason.Programmatic);
            }
            if (message == WmGetMinMaxInfo)
            {
                var info = Marshal.PtrToStructure<Native.MinMaxInfo>(lParam);
                var dpi = Native.GetDpiForWindow(_window);
                var scale = (dpi == 0 ? 96 : dpi) / 96d;
                info.MinTrackSize = new Native.Point { X = (int)Math.Round(800 * scale), Y = (int)Math.Round(560 * scale) };
                Marshal.StructureToPtr(info, lParam, false);
                return 0;
            }
            if (message == WmDpiChanged)
            {
                var suggested = Marshal.PtrToStructure<Native.Rect>(lParam);
                Native.SetWindowPos(_window, 0, suggested.Left, suggested.Top, suggested.Right - suggested.Left,
                    suggested.Bottom - suggested.Top, SwpNoZOrder | SwpNoActivate);
                Layout();
                return 0;
            }
            if (message == WmClose)
            {
                if (!_allowClose)
                {
                    _ = ExecuteDocumentCommandAsync("close");
                    return 0;
                }
                _closed = true;
                DisposeDocuments();
                CloseControllers();
                _toolbar.Dispose();
                Native.DestroyWindow(_window);
                Application.Current.Exit();
                return 0;
            }
        }
        return Native.DefWindowProcW(window, message, wParam, lParam);
    }

    private void CloseControllers()
    {
        _editor?.Close();
        _preview?.Close();
        _editor = null;
        _preview = null;
    }

    private static class Native
    {
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindowEnabled(nint window);
        internal delegate nint Procedure(nint window, uint message, nuint wParam, nint lParam);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct WindowClass
        {
            public uint Style;
            public nint Procedure;
            public int ClassExtra;
            public int WindowExtra;
            public nint Instance;
            public nint Icon;
            public nint Cursor;
            public nint Background;
            public string? Menu;
            public string Name;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct Point
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct MinMaxInfo
        {
            public Point Reserved;
            public Point MaxSize;
            public Point MaxPosition;
            public Point MinTrackSize;
            public Point MaxTrackSize;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct Rect
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

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
    }
}
