using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using Marker.App;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using Windows.Foundation;
using Windows.Graphics;

namespace Marker.IslandsProbe;

internal sealed class ProbeWindow
{
    private const string EditorUrl = "https://editor.marker.example/index.html";
    private const string PreviewUrl = "https://preview.marker.example/preview.html";
    private readonly Native.Procedure _procedure;
    private readonly DesktopWindowXamlSource _toolbar;
    private readonly TextBlock _status = new() { Text = "初始化…", VerticalAlignment = VerticalAlignment.Center };
    private readonly BridgeSession _session = new(Guid.NewGuid().ToString("N"));
    private readonly nint _window, _editorWindow, _previewWindow;
    private readonly string _className;
    private CoreWebView2Controller? _editor, _preview;
    private MarkdownSnapshot? _latest;
    private bool _editorReady, _previewReady, _closed;
    private nint _lastFocus;

    internal ProbeWindow()
    {
        _procedure = WindowProcedure;
        var module = Native.GetModuleHandleW(null);
        _className = "Marker.IslandsProbe." + Guid.NewGuid().ToString("N");
        var definition = new Native.WindowClass
        {
            Procedure = Marshal.GetFunctionPointerForDelegate(_procedure), Instance = module,
            Name = _className, Background = 6
        };
        if (Native.RegisterClassW(ref definition) == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        _window = Native.CreateWindowExW(0, _className, "Marker XAML Islands 输入验收原型", 0x02CF0000,
            200, 150, 1200, 850, 0, 0, module, 0);
        if (_window == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        _editorWindow = CreateChild("Marker Islands editor");
        _previewWindow = CreateChild("Marker Islands preview");
        _toolbar = new DesktopWindowXamlSource();
        _toolbar.Initialize(Win32Interop.GetWindowIdFromWindow(_window));
        var focus = new Button { Content = "进入编辑器" };
        focus.Click += (_, _) => _editor?.MoveFocus(CoreWebView2MoveFocusReason.Next);
        var resync = new Button { Content = "重新同步" };
        resync.Click += (_, _) => _editor?.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { protocolVersion = BridgeSession.ProtocolVersion, type = "requestSnapshot", sessionId = _session.SessionId }));
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, Padding = new Thickness(12) };
        header.Children.Add(focus);
        header.Children.Add(resync);
        header.Children.Add(_status);
        _toolbar.Content = new Border { Background = new SolidColorBrush(Colors.White), Child = header };
        _toolbar.TakeFocusRequested += (_, args) =>
        {
            if (args.Request.Reason == XamlSourceFocusNavigationReason.Last)
                _preview?.MoveFocus(CoreWebView2MoveFocusReason.Previous);
            else
                _editor?.MoveFocus(CoreWebView2MoveFocusReason.Next);
        };
        _toolbar.GotFocus += (_, _) => _lastFocus = 0;
    }

    internal void Show()
    {
        Native.ShowWindow(_window, 5);
        Layout();
        InitializeAsync();
    }

    private nint CreateChild(string title)
    {
        var child = Native.CreateWindowExW(0, _className, title, 0x56000000, 0, 0, 1, 1, _window, 0, Native.GetModuleHandleW(null), 0);
        if (child == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return child;
    }

    private async void InitializeAsync()
    {
        try
        {
            var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null,
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Marker", "IslandsProbe"),
                new CoreWebView2EnvironmentOptions());
            if (_closed) return;
            _editor = await environment.CreateCoreWebView2ControllerAsync(CoreWebView2ControllerWindowReference.CreateFromWindowHandle((ulong)_editorWindow));
            if (_closed) { _editor.Close(); return; }
            _preview = await environment.CreateCoreWebView2ControllerAsync(CoreWebView2ControllerWindowReference.CreateFromWindowHandle((ulong)_previewWindow));
            if (_closed) { _preview.Close(); return; }
            foreach (var controller in new[] { _editor, _preview })
            {
                controller.BoundsMode = CoreWebView2BoundsMode.UseRawPixels;
                controller.GotFocus += (_, _) => _lastFocus = controller == _editor ? _editorWindow : _previewWindow;
                controller.MoveFocusRequested += (_, args) =>
                {
                    if (controller == _editor && args.Reason == CoreWebView2MoveFocusReason.Next)
                    {
                        _preview.MoveFocus(CoreWebView2MoveFocusReason.Next);
                        args.Handled = true;
                        return;
                    }
                    if (controller == _preview && args.Reason == CoreWebView2MoveFocusReason.Previous)
                    {
                        _editor.MoveFocus(CoreWebView2MoveFocusReason.Previous);
                        args.Handled = true;
                        return;
                    }
                    _toolbar.NavigateFocus(new XamlSourceFocusNavigationRequest(args.Reason == CoreWebView2MoveFocusReason.Previous
                        ? XamlSourceFocusNavigationReason.Last : XamlSourceFocusNavigationReason.First));
                    args.Handled = _toolbar.HasFocus;
                };
            }
            Configure(_editor.CoreWebView2, EditorUrl, true);
            Configure(_preview.CoreWebView2, PreviewUrl, false);
            // Only the probe adds a keyboard stop for its native preview pane.
            await _preview.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("addEventListener('DOMContentLoaded', () => { const reader = document.getElementById('preview'); if (reader) { reader.tabIndex = 0; reader.setAttribute('aria-label', 'Markdown 预览'); } });");
            if (_closed) return;
            Layout();
            _editor.CoreWebView2.Navigate(EditorUrl);
            _preview.CoreWebView2.Navigate(PreviewUrl);
        }
        catch (Exception error)
        {
            CloseControllers();
            if (!_closed) _status.Text = error.Message;
        }
    }

    private void Configure(CoreWebView2 core, string url, bool editor)
    {
        var host = new Uri(url).Host;
        core.SetVirtualHostNameToFolderMapping(host, Path.Combine(AppContext.BaseDirectory, "Web"), CoreWebView2HostResourceAccessKind.DenyCors);
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.NavigationStarting += (_, args) => args.Cancel = args.Uri != url;
        core.FrameNavigationStarting += (_, args) => args.Cancel = true;
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, args) =>
        {
            var uri = Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var parsed) ? parsed : null;
            var path = uri is null ? "" : Uri.UnescapeDataString(uri.AbsolutePath);
            if (uri is null || uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Host != host || uri.Query.Length != 0
                || !(path == new Uri(url).AbsolutePath || path.StartsWith("/assets/", StringComparison.Ordinal))
                || path.Split('/').Any(part => part is "." or "..") || path.Contains('\\'))
                args.Response = core.Environment.CreateWebResourceResponse(null, 403, "Blocked", "Content-Type: text/plain");
        };
        core.WebMessageReceived += (sender, args) =>
        {
            if (_closed) return;
            if (!(editor ? _editorReady : _previewReady) && _session.TryReadReady(args.Source, url, args.WebMessageAsJson))
            {
                if (editor)
                {
                    _editorReady = true;
                    core.PostWebMessageAsJson(JsonSerializer.Serialize(new { protocolVersion = BridgeSession.ProtocolVersion, type = "initialize", sessionId = _session.SessionId, text = "# Islands 输入验收\n\n请点击左侧编辑区输入中文。\n\nCtrl+Enter 新建段落。" }));
                }
                else
                {
                    _previewReady = true;
                    core.PostWebMessageAsJson(JsonSerializer.Serialize(new { protocolVersion = BridgeSession.ProtocolVersion, type = "initialize", sessionId = _session.SessionId }));
                    if (_latest is { } latest) Render(latest);
                }
            }
            else if (editor && (_session.TryAcceptChanges(args.Source, url, args.WebMessageAsJson, out var snapshot, out _) || _session.TryAcceptSnapshot(args.Source, url, args.WebMessageAsJson, out snapshot, out _)))
            {
                _latest = snapshot;
                Render(snapshot);
            }
            else if (!editor && _session.TryAcceptRendered(args.Source, url, args.WebMessageAsJson, out var version, out _) && version == _session.Version)
                _status.Text = $"预览已同步 · v{version} · DPI {Native.GetDpiForWindow(_window)}";
        };
    }

    private async void Render(MarkdownSnapshot snapshot)
    {
        try
        {
            if (!_previewReady) return;
            var rendered = await Task.Run(() => MarkdownRenderer.RenderDocument(snapshot.Text));
            if (_closed || snapshot.Version != _session.Version || _preview is null) return;
            _preview.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { protocolVersion = BridgeSession.ProtocolVersion, type = "render", sessionId = _session.SessionId, version = snapshot.Version, html = rendered.Html, outline = rendered.Outline.Select(h => new { id = h.Id, text = h.Text, level = h.Level, offset = h.Offset }) }));
        }
        catch (Exception error) { if (!_closed) _status.Text = error.Message; }
    }

    private void CloseControllers()
    {
        _editor?.Close(); _preview?.Close();
        _editor = _preview = null;
    }

    private void Layout()
    {
        if (_closed || _toolbar is null) return;
        Native.GetClientRect(_window, out var rect);
        var scale = Native.GetDpiForWindow(_window) / 96d;
        var header = (int)Math.Round(76 * scale);
        _toolbar.SiteBridge.MoveAndResize(new RectInt32(0, 0, Math.Max(1, rect.Right), header));
        var gap = (int)Math.Round(12 * scale);
        var width = Math.Max(1, (rect.Right - gap * 3) / 2);
        var height = Math.Max(1, rect.Bottom - header - gap);
        ResizeView(_editorWindow, _editor, gap, header, width, height);
        ResizeView(_previewWindow, _preview, width + gap * 2, header, width, height);
    }

    private static void ResizeView(nint window, CoreWebView2Controller? controller, int x, int y, int width, int height)
    {
        if (!Native.SetWindowPos(window, 0, x, y, width, height, 0x0014))
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
            if (message == 0x0005) Layout(); // WM_SIZE
            if (message == 0x0003) { _editor?.NotifyParentWindowPositionChanged(); _preview?.NotifyParentWindowPositionChanged(); }
            if (message == 0x0007) // WM_SETFOCUS
            {
                if (_lastFocus == _editorWindow) _editor?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);
                if (_lastFocus == _previewWindow) _preview?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);
            }
            if (message == 0x02E0) // WM_DPICHANGED: use the OS-provided physical rectangle.
            {
                var suggested = Marshal.PtrToStructure<Native.Rect>(lParam);
                Native.SetWindowPos(window, 0, suggested.Left, suggested.Top, suggested.Right - suggested.Left, suggested.Bottom - suggested.Top, 0x0014);
                Layout();
                return 0;
            }
            if (message == 0x0010) // WM_CLOSE
            {
                _closed = true;
                CloseControllers(); _toolbar.Dispose();
                Native.DestroyWindow(window);
                Application.Current.Exit();
                return 0;
            }
        }
        return Native.DefWindowProcW(window, message, wParam, lParam);
    }
}
