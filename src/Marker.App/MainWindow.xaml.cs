using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using System.Text.Json;

namespace Marker.App;

public sealed partial class MainWindow : Window
{
    private const string EditorUrl = "https://editor.marker.example/index.html";
    private const string PreviewUrl = "https://preview.marker.example/preview.html";
    private const string EditorHost = "editor.marker.example";
    private const string PreviewHost = "preview.marker.example";
    private const string SampleMarkdown = """
    # Marker M1 原型

    中文输入与实时预览
    ==================

    | 项目 | 状态 |
    | --- | --- |
    | CodeMirror 6 | 已连接 |
    | Markdig | 已连接 |

    - [x] 全量文本快照
    - [ ] 中文输入法实机验收

    ~~删除线~~ 与 `行内代码`
    """;

    private readonly BridgeSession _session = new(Guid.NewGuid().ToString("N"));
    private long _latestPreviewSentVersion = -1;
    private MarkdownSnapshot? _latestSnapshot;
    private bool _editorReady;
    private bool _previewReady;
    private bool _closed;

    public MainWindow()
    {
        InitializeComponent();
        Title = "Marker";
        RootGrid.Loaded += MainWindow_Loaded;
        Closed += (_, _) => DisposeWebViews();
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        RootGrid.Loaded -= MainWindow_Loaded;
        try
        {
            var webRoot = Path.Combine(AppContext.BaseDirectory, "Web");
            if (!File.Exists(Path.Combine(webRoot, "index.html")) || !File.Exists(Path.Combine(webRoot, "preview.html")))
                throw new FileNotFoundException("应用内 Web 资源不完整，请重新构建安装包。");

            var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Marker", "WebView2");
            var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, userData, new CoreWebView2EnvironmentOptions());
            if (_closed)
                return;

            await EditorView.EnsureCoreWebView2Async(environment);
            if (_closed)
                return;
            await PreviewView.EnsureCoreWebView2Async(environment);
            if (_closed)
                return;
            ConfigureWebView(EditorView, EditorUrl, EditorHost);
            ConfigureWebView(PreviewView, PreviewUrl, PreviewHost);
            EditorView.CoreWebView2.Navigate(EditorUrl);
            PreviewView.CoreWebView2.Navigate(PreviewUrl);
        }
        catch (Exception exception)
        {
            if (!_closed)
                SetStatus($"WebView2 初始化失败：{exception.Message}");
        }
    }

    private void ConfigureWebView(Microsoft.UI.Xaml.Controls.WebView2 view, string pageUrl, string host)
    {
        var core = view.CoreWebView2;
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
            var uri = Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var parsed) ? parsed : null;
            var path = uri is null ? string.Empty : Uri.UnescapeDataString(uri.AbsolutePath);
            var pathAllowed = path == (host == EditorHost ? "/index.html" : "/preview.html")
                || path.StartsWith("/assets/", StringComparison.Ordinal);
            var hasTraversal = path.Split('/').Any(segment => segment is "." or "..") || path.Contains('\\');
            if (uri is null || uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Host != host || uri.Query.Length != 0 || !pathAllowed || hasTraversal)
                args.Response = core.Environment.CreateWebResourceResponse(null, 403, "Blocked", "Content-Type: text/plain");
        };
        core.WebMessageReceived += (sender, args) =>
        {
            if (ReferenceEquals(view, EditorView))
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
            EditorView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "initialize",
                sessionId = _session.SessionId,
                text = SampleMarkdown
            }));
            SetStatus("编辑器已连接，等待首个快照。");
            return;
        }

        if (!_session.TryAcceptSnapshot(source, EditorUrl, json, out var snapshot, out var error))
        {
            SetStatus(error);
            return;
        }
        _latestSnapshot = snapshot;
        _ = RenderSnapshotAsync(snapshot);
    }

    private void HandlePreviewMessage(string source, string json)
    {
        if (!_previewReady && _session.TryReadReady(source, PreviewUrl, json))
        {
            _previewReady = true;
            PreviewView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
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
            var html = await Task.Run(() => MarkdownRenderer.Render(snapshot.Text));
            if (_closed || snapshot.Version != _session.Version || !_previewReady)
                return;

            _latestPreviewSentVersion = snapshot.Version;
            PreviewView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
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

    private void ResyncButton_Click(object sender, RoutedEventArgs e)
    {
        if (!_editorReady || _closed)
        {
            SetStatus("编辑器尚未就绪，无法重新同步。");
            return;
        }
        EditorView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "requestSnapshot",
            sessionId = _session.SessionId
        }));
        SetStatus("已请求编辑器发送完整快照。");
    }

    private void SetStatus(string message) => BridgeStatus.Text = message;

    private void DisposeWebViews()
    {
        if (_closed)
            return;
        _closed = true;
        if (EditorView.CoreWebView2 is not null)
            EditorView.CoreWebView2.Stop();
        if (PreviewView.CoreWebView2 is not null)
            PreviewView.CoreWebView2.Stop();
        EditorView.Close();
        PreviewView.Close();
    }
}
