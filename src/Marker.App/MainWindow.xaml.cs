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
    private bool _sourceMode;
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
            Icon = Native.LoadIconW(module, (nint)32512),
            Name = _className,
            Background = 0
        };
        if (Native.RegisterClassW(ref definition) == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error());

        _window = Native.CreateWindowExW(0, _className, "Marker", WsOverlappedWindow | WsClipChildren,
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
        InitializeViews();
        InitializeFileDrop();
        InitializeWindowsExperience();
    }

    internal void Show()
    {
        Native.ShowWindow(_window, 5);
        ApplySystemAppearance();
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

            try { _ = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
            catch (Exception runtimeError)
            {
                SetStatus("未检测到可用的 WebView2 Runtime，编辑器暂时无法启动。");
                MessageBoxW(_window, "Marker 需要 Microsoft Edge WebView2 Evergreen Runtime。\n请安装该运行时后重新打开 Marker；安装说明见项目工程指南。\n\n" + runtimeError.Message,
                    "Marker · 缺少 WebView2 Runtime", 0x10);
                return;
            }

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
                SetStatus($"WebView2 初始化失败：{(string.IsNullOrWhiteSpace(exception.Message) ? exception.GetType().Name : exception.Message)}");
        }
    }

    private void ConfigureController(CoreWebView2Controller controller, bool editor)
    {
        controller.BoundsMode = CoreWebView2BoundsMode.UseRawPixels;
        controller.AllowExternalDrop = true;
        controller.GotFocus += (_, _) => _lastFocus = editor ? _editorWindow : _previewWindow;
        controller.MoveFocusRequested += (_, args) =>
        {
            _toolbar.NavigateFocus(new XamlSourceFocusNavigationRequest(args.Reason == CoreWebView2MoveFocusReason.Previous
                ? XamlSourceFocusNavigationReason.Last
                : XamlSourceFocusNavigationReason.First));
            args.Handled = _toolbar.HasFocus;
        };
    }

    private void Toolbar_TakeFocusRequested(object? sender, DesktopWindowXamlSourceTakeFocusRequestedEventArgs args)
    {
        TryMoveFocus(_editor, _editorWindow, args.Request.Reason == XamlSourceFocusNavigationReason.Last
            ? CoreWebView2MoveFocusReason.Previous
            : CoreWebView2MoveFocusReason.Next);
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
            if (Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var resourceUri)
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
        core.WebMessageReceived += (sender, args) =>
        {
            if (_closed) return;
            if (_session.TryReadFilesDropped(args.Source, editor ? EditorUrl : PreviewUrl, args.WebMessageAsJson, out var count, out _))
            {
                var objects = args.AdditionalObjects;
                if (objects is null || objects.Count != count || objects.Any(item => item is not CoreWebView2File)) return;
                try
                {
                    var paths = objects.Cast<CoreWebView2File>().Select(file => file.Path).ToArray();
                    if (paths.Any(path => !MarkdownActivation.TryNormalizePath(path, out _))) return;
                    QueueOpenFiles(paths);
                }
                catch (Exception error) when (error is COMException or InvalidOperationException) { }
                return;
            }
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
                protocolVersion = BridgeSession.ProtocolVersion,
                sessionId = _session.SessionId,
                text = _document.Text
            }));
            ApplyWebSettings();
            ConsumePendingFileActivations();
            _ = OfferRecoveryOnStartupAsync();
            return;
        }

        if (_session.TryReadCommand(source, EditorUrl, json, out var command, out _))
        {
            _ = ExecuteDocumentCommandAsync(command);
            return;
        }
        if (_session.TryReadEditorLink(source, EditorUrl, json, out var linkUrl, out _))
        {
            if (!_operationBusy && linkUrl is not null) ConfirmOpenLink(linkUrl);
            return;
        }
        if (_session.TryReadSnapshotError(source, EditorUrl, json, out var requestId, out var reason, out _))
        {
            if (requestId == _snapshotRequestId)
                _snapshotCompletion?.TrySetException(new IOException("请先完成输入法选词，再保存或切换文档。"));
            return;
        }

        if (_session.TryReadSourceMode(source, EditorUrl, json, out var sourceMode, out _))
        {
            _sourceMode = sourceMode;
            SourceModeButton.IsChecked = sourceMode;
            return;
        }

        if (_session.TryReadEditorStatus(source, EditorUrl, json, out var editorStatus, out _))
        {
            return;
        }

        if (_session.TryAcceptChanges(source, EditorUrl, json, out var changed, out _))
        {
            _latestSnapshot = changed;
            AcceptDocumentSnapshot(changed);
            _ = RenderSnapshotAsync(changed);
            return;
        }

        if (!_session.TryAcceptSnapshot(source, EditorUrl, json, out var snapshot, out var error))
        {
            SetStatus(error);
            // A rejected incremental update cannot mutate the host cache. Recover from the live editor.
            if (source == EditorUrl && json.Length <= BridgeSession.MaxMessageBytes)
            {
                try
                {
                    using var message = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
                    if (message.RootElement.TryGetProperty("type", out var type) && type.GetString() == "changes"
                        && message.RootElement.TryGetProperty("sessionId", out var sessionId) && sessionId.GetString() == _session.SessionId
                        && message.RootElement.TryGetProperty("protocolVersion", out var protocol) && protocol.ValueKind == JsonValueKind.Number
                        && protocol.TryGetInt32(out var protocolVersion) && protocolVersion == BridgeSession.ProtocolVersion)
                        _editor?.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
                        { protocolVersion = BridgeSession.ProtocolVersion, type = "requestSnapshot", sessionId = _session.SessionId }));
                }
                catch (JsonException) { }
                catch (InvalidOperationException) { }
            }
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
                protocolVersion = BridgeSession.ProtocolVersion,
                sessionId = _session.SessionId
            }));
            ApplyWebSettings();
            if (_latestSnapshot is { } snapshot)
                _ = RenderSnapshotAsync(snapshot);
            return;
        }

        if (_session.TryReadPreviewAction(source, PreviewUrl, json, out var action, out var offset, out var url, out _))
        {
            if (_latestPreviewSentVersion != _session.Version) return;
            if (action == "revealSource")
            {
                _editor?.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
                { protocolVersion = BridgeSession.ProtocolVersion, type = "revealSource", sessionId = _session.SessionId, version = _session.Version, offset }));
                TryMoveFocus(_editor, _editorWindow, CoreWebView2MoveFocusReason.Programmatic);
            }
            else if (action == "openLink" && url is not null && !_operationBusy) ConfirmOpenLink(url);
            return;
        }

        if (!_session.TryAcceptRendered(source, PreviewUrl, json, out var version, out var error))
        {
            SetStatus(error);
            return;
        }
    }

    private void ConfirmOpenLink(string url)
    {
        if (MessageBoxW(_window, $"使用默认浏览器打开以下地址？\n{url}", "Marker · 打开链接", 0x124) != 6) return;
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception error) { SetStatus($"无法打开链接：{error.Message}"); }
    }

    private async Task RenderSnapshotAsync(MarkdownSnapshot snapshot)
    {
        try
        {
            if (_viewMode == "source") return;
            var session = _session;
            var renderRequest = ++_renderRequest;
            // ponytail: one render per quiet 100 ms window; no cache until the measured baseline needs one.
            await Task.Delay(100);
            if (_closed || renderRequest != _renderRequest || !ReferenceEquals(session, _session)) return;
            var resolver = _images.CreateResolver(session.SessionId);
            var imageResources = new Dictionary<string, string>(StringComparer.Ordinal);
            var resourceBytes = 512;
            var rendered = await Task.Run(() => MarkdownRenderer.RenderDocument(snapshot.Text, source =>
            {
                var url = resolver(source);
                if (url is not null && !imageResources.ContainsKey(source))
                {
                    var entryBytes = JsonSerializer.SerializeToUtf8Bytes(new { source, url }).Length + 1;
                    if (resourceBytes + entryBytes <= BridgeSession.MaxMessageBytes)
                    {
                        imageResources.Add(source, url);
                        resourceBytes += entryBytes;
                    }
                }
                return url;
            }));
            if (_closed || _viewMode == "source" || renderRequest != _renderRequest || !ReferenceEquals(session, _session) || snapshot.Version != session.Version || !_previewReady || _preview is null)
                return;

            _latestPreviewSentVersion = snapshot.Version;
            _editor?.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "imageResources",
                protocolVersion = BridgeSession.ProtocolVersion,
                sessionId = session.SessionId,
                version = snapshot.Version,
                resources = imageResources.Select(entry => new { source = entry.Key, url = entry.Value })
            }));
            _preview.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "render",
                protocolVersion = BridgeSession.ProtocolVersion,
                sessionId = _session.SessionId,
                version = snapshot.Version,
                html = rendered.Html,
                outline = rendered.Outline.Select(heading => new { id = heading.Id, text = heading.Text, level = heading.Level, offset = heading.Offset })
            }));
        }
        catch (Exception exception)
        {
            if (!_closed)
                SetStatus($"Markdown 解析失败：{exception.Message}");
        }
    }

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

    private void SetStatus(string message)
    {
        NotificationStatus.Text = message;
        NotificationStatus.Visibility = Visibility.Visible;
        Layout();
    }

    private void SourceMode_Click(object sender, RoutedEventArgs e)
    {
        if (_closed || _operationBusy || !_editorReady || _editor is null)
        {
            SourceModeButton.IsChecked = _sourceMode;
            return;
        }
        SendEditorCommand("toggleSource");
    }

    private void Layout()
    {
        if (_closed) return;
        Native.GetClientRect(_window, out var rect);
        var scale = Native.GetDpiForWindow(_window) / 96d;
        var header = (int)Math.Round(ToolbarHeightDip * scale);
        var gap = (int)Math.Round(12 * scale);
        var height = Math.Max(1, rect.Bottom - header - gap);
        _toolbar.SiteBridge.MoveAndResize(new RectInt32(0, 0, Math.Max(1, rect.Right), header));
        var fullWidth = Math.Max(1, rect.Right - gap * 2);
        ResizeView(_editorWindow, _editor, gap, header, fullWidth, height);
        ResizeView(_previewWindow, _preview, 0, 0, 1, 1);
        Native.ShowWindow(_editorWindow, 5);
        Native.ShowWindow(_previewWindow, 0);
        if (_editor is not null) _editor.IsVisible = true;
        if (_preview is not null) _preview.IsVisible = false;
    }

    private static void ResizeView(nint window, CoreWebView2Controller? controller, int x, int y, int width, int height)
    {
        if (!Native.SetWindowPos(window, 0, x, y, width, height, SwpNoZOrder | SwpNoActivate))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if (controller is not null)
        {
            controller.Bounds = new Rect(0, 0, width, height);
            controller.NotifyParentWindowPositionChanged();
        }
    }

    private nint WindowProcedure(nint window, uint message, nuint wParam, nint lParam)
    {
        if (message == 0x0233 && IsFileDropWindow(window))
        {
            HandleDroppedFiles(wParam);
            return 0;
        }
        if (window == _window)
        {
            if (message == 0x0014) return PaintWindowBackground((nint)wParam) ? 1 : 0;
            if (message == 0x001A || message == 0x031A) ApplySystemAppearance();
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
                var minimum = GetMinimumTrackSize();
                info.MinTrackSize = new Native.Point { X = minimum.X, Y = minimum.Y };
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
                SaveWindowPlacement();
                _closed = true;
                DisposeWindowsExperience();
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

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern nint LoadIconW(nint instance, nint name);

        [DllImport("user32.dll")]
        internal static extern short GetKeyState(int virtualKey);

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
