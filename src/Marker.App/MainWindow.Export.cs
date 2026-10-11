using System.Text.Json;
using Microsoft.UI;
using Microsoft.Windows.Storage.Pickers;

namespace Marker.App;

public sealed partial class MainWindow
{
    private string? _pdfRequestId;
    private TaskCompletionSource<bool>? _pdfCompletion;

    private async Task ExportPdfAsync()
    {
        if (!_previewReady || _preview is null) throw new IOException("PDF 渲染器尚未就绪，请稍后重试。");
        var picker = new FileSavePicker(Win32Interop.GetWindowIdFromWindow(_window))
        {
            SuggestedFileName = Path.GetFileNameWithoutExtension(_document.Path ?? "未命名") + ".pdf",
            DefaultFileExtension = ".pdf",
            ShowOverwritePrompt = true
        };
        picker.FileTypeChoices.Add("PDF", new List<string> { ".pdf" });
        var selected = await picker.PickSaveFileAsync();
        if (selected is null) return;
        var path = selected.Path;
        if (!Path.GetExtension(path).Equals(".pdf", StringComparison.OrdinalIgnoreCase)
            || string.Equals(path, _document.Path, StringComparison.OrdinalIgnoreCase))
            throw new IOException("请将 PDF 导出到独立的 .pdf 文件，不能覆盖当前文档。");
        DocumentFile.RejectReparsePath(path, includeTarget: true);
        var fingerprint = File.Exists(path) ? PdfExportFile.Fingerprint(path) : null;
        await RequestCurrentSnapshotAsync();
        EnableWindow(_editorWindow, false);
        var snapshot = await RequestCurrentSnapshotAsync();
        ++_renderRequest; // Cancel pending editor renders before preparing the complete print document.
        var rendered = await Task.Run(() => MarkdownRenderer.RenderDocument(snapshot.Text, _images.CreateResolver(_session.SessionId)));
        _pdfRequestId = Guid.NewGuid().ToString("N");
        _pdfCompletion = new(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            _preview.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "render", protocolVersion = 1, sessionId = _session.SessionId, version = snapshot.Version,
                html = rendered.Html,
                outline = rendered.Outline.Select(heading => new { id = heading.Id, text = heading.Text, level = heading.Level, offset = heading.Offset })
            }));
            _preview.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            { type = "preparePdf", protocolVersion = 1, sessionId = _session.SessionId, version = snapshot.Version, requestId = _pdfRequestId }));
            if (!await _pdfCompletion.Task.WaitAsync(TimeSpan.FromSeconds(30)))
                throw new IOException("PDF 页面准备失败，未写入目标文件。");
            var settings = _preview.CoreWebView2.Environment.CreatePrintSettings();
            settings.PageWidth = 210 / 25.4;
            settings.PageHeight = 297 / 25.4;
            settings.MarginTop = settings.MarginBottom = settings.MarginLeft = settings.MarginRight = 15 / 25.4;
            settings.ShouldPrintBackgrounds = true;
            settings.ShouldPrintHeaderAndFooter = false;
            using var pdf = await _preview.CoreWebView2.PrintToPdfStreamAsync(settings);
            using var stream = pdf.AsStreamForRead();
            await Task.Run(() => PdfExportFile.Save(stream, path, fingerprint));
            SetStatus($"已导出 PDF：{path}");
        }
        finally
        {
            if (!_closed) _preview?.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            { type = "finishPdf", protocolVersion = 1, sessionId = _session.SessionId }));
            _pdfRequestId = null;
            _pdfCompletion = null;
        }
    }
}
