using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.Storage.Pickers;

namespace Marker.App;

public sealed partial class MainWindow
{
    private DocumentFileData _document = DocumentFile.New();
    private Guid _documentId = Guid.NewGuid();
    private string _savedText = "";
    private string? _recoveryOriginalPath;
    private bool _forceDirty, _operationBusy, _allowClose, _diskChanged;
    private readonly LocalImageResources _images = new();
    private readonly RecoveryStore _recovery = new(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Marker", "Recovery"));
    private DispatcherQueueTimer? _recoveryTimer;
    private FileSystemWatcher? _watcher;
    private Task _draftWrite = Task.CompletedTask;
    private string? _snapshotRequestId;
    private TaskCompletionSource<MarkdownSnapshot>? _snapshotCompletion;
    private bool IsDirty => _forceDirty || (_latestSnapshot?.Text ?? _document.Text) != _savedText;

    private void InitializeDocuments()
    {
        _images.SetRoot(null, _session.SessionId);
        _recoveryTimer = DispatcherQueue.CreateTimer();
        _recoveryTimer.Interval = TimeSpan.FromSeconds(1);
        _recoveryTimer.IsRepeating = false;
        _recoveryTimer.Tick += (_, _) => QueueRecovery();
        UpdateDocumentStatus();
    }

    private void AcceptDocumentSnapshot(MarkdownSnapshot snapshot)
    {
        if (snapshot.RequestId == _snapshotRequestId && _snapshotRequestId is not null)
            _snapshotCompletion?.TrySetResult(snapshot);
        UpdateDocumentStatus();
        _recoveryTimer?.Stop();
        if (IsDirty) _recoveryTimer?.Start();
    }

    private async Task<MarkdownSnapshot> RequestCurrentSnapshotAsync()
    {
        if (!_editorReady || _editor is null) throw new IOException("编辑器尚未就绪，操作已取消。");
        var session = _session;
        _snapshotRequestId = Guid.NewGuid().ToString("N");
        _snapshotCompletion = new(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            _editor.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            { protocolVersion = BridgeSession.ProtocolVersion, type = "requestSnapshot", sessionId = session.SessionId, requestId = _snapshotRequestId }));
            var snapshot = await _snapshotCompletion.Task.WaitAsync(TimeSpan.FromSeconds(5));
            if (!ReferenceEquals(session, _session) || _closed) throw new IOException("文档已切换，操作已取消。");
            return snapshot;
        }
        catch (TimeoutException) { throw new IOException("未收到编辑器当前快照，请完成输入或重新同步后再试。未写入文件。"); }
        finally { _snapshotCompletion = null; _snapshotRequestId = null; }
    }

    private void UpdateDocumentStatus()
    {
        var name = _document.Path is null ? "未命名" : Path.GetFileName(_document.Path);
        DocumentStatus.Text = $"{name}{(IsDirty ? " · 未保存" : "")} · {_document.EncodingName}{(_document.HasBom ? " BOM" : "")} · {_document.Newline}{(_diskChanged ? " · 磁盘已变更" : "")}";
        SetWindowTextW(_window, _document.Path is null && !IsDirty ? "Marker" : $"Marker — {name}{(IsDirty ? " *" : "")}");
    }

    private async void NewDocument_Click(object sender, RoutedEventArgs e) => await ExecuteDocumentCommandAsync("new");
    private async void OpenDocument_Click(object sender, RoutedEventArgs e) => await ExecuteDocumentCommandAsync("open");
    private async void SaveDocument_Click(object sender, RoutedEventArgs e) => await ExecuteDocumentCommandAsync("save");
    private async void SaveAsDocument_Click(object sender, RoutedEventArgs e) => await ExecuteDocumentCommandAsync("saveAs");
    private async void RecoverDocument_Click(object sender, RoutedEventArgs e) => await ExecuteDocumentCommandAsync("recover");

    private async Task ExecuteDocumentCommandAsync(string command)
    {
        if (_closed || _operationBusy) return;
        _operationBusy = true;
        try
        {
            switch (command)
            {
                case "save": await SaveDocumentAsync(false); break;
                case "saveAs": await SaveDocumentAsync(true); break;
                case "new":
                    if (await ConfirmLeaveDocumentAsync()) await SwitchDocumentAsync(DocumentFile.New());
                    break;
                case "open":
                    // Choose the file before asking to discard the current document.
                    var picker = new FileOpenPicker(Win32Interop.GetWindowIdFromWindow(_window));
                    picker.FileTypeFilter.Add(".md");
                    picker.FileTypeFilter.Add(".markdown");
                    picker.FileTypeFilter.Add(".txt");
                    picker.FileTypeFilter.Add("*");
                    var selected = await picker.PickSingleFileAsync();
                    if (selected is not null)
                    {
                        var data = await ReadDocumentAsync(selected.Path);
                        ValidateEditorText(data.Text);
                        if (await ConfirmLeaveDocumentAsync()) await SwitchDocumentAsync(data);
                    }
                    break;
                case "recover":
                    if (await ConfirmLeaveDocumentAsync()) await OfferRecoveryAsync();
                    break;
                case "close":
                    if (await ConfirmLeaveDocumentAsync())
                    {
                        _allowClose = true;
                        PostMessageW(_window, WmClose, 0, 0);
                    }
                    break;
            }
        }
        catch (Exception error)
        {
            SetStatus($"操作未完成：{error.Message}");
            MessageBoxW(_window, error.Message, "Marker · 操作未完成", 0x10);
        }
        finally
        {
            _operationBusy = false;
            if (!_closed && !_allowClose) EnableWindow(_editorWindow, true);
        }
    }

    private static void ValidateEditorText(string text)
    {
        var envelope = JsonSerializer.Serialize(new { protocolVersion = BridgeSession.ProtocolVersion, type = "snapshot", sessionId = new string('s', 32), version = long.MaxValue, text, requestId = new string('r', 32) });
        if (text.Length > BridgeSession.MaxTextLength || System.Text.Encoding.UTF8.GetByteCount(envelope) > BridgeSession.MaxMessageBytes)
            throw new IOException("该文档超过当前编辑/保存快照容量，未替换当前文档。请使用其他编辑器处理。");
    }

    private async Task<DocumentFileData> ReadDocumentAsync(string path)
    {
        try { return await Task.Run(() => DocumentFile.Read(path)); }
        catch (InvalidDataException)
        {
            if (MessageBoxW(_window, "无法按 UTF-8/带 BOM 的 UTF-16 解码。是否明确使用 GB18030 重新打开？\n选择“否”取消，不会替换字符或当前文档。", "Marker · 选择编码", 0x34) != 6) throw;
            return await Task.Run(() => DocumentFile.Read(path, "gb18030"));
        }
    }

    private async Task SwitchDocumentAsync(DocumentFileData data, Guid? recoveredId = null, string? originalPath = null)
    {
        ValidateEditorText(data.Text);
        _recoveryTimer?.Stop();
        try { await _draftWrite; } catch { /* The old document's recovery error was already reported. */ }
        _watcher?.Dispose(); _watcher = null;
        _snapshotCompletion?.TrySetException(new IOException("文档已切换。"));
        _document = data;
        _documentId = recoveredId ?? Guid.NewGuid();
        _recoveryOriginalPath = originalPath;
        _forceDirty = recoveredId.HasValue;
        _savedText = recoveredId.HasValue ? "" : data.Text;
        _latestSnapshot = null;
        _latestPreviewSentVersion = -1;
        _diskChanged = false;
        _session = new BridgeSession(Guid.NewGuid().ToString("N"));
        _images.SetRoot(Path.GetDirectoryName(data.Path ?? originalPath), _session.SessionId);
        if (_previewReady) _preview?.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { protocolVersion = BridgeSession.ProtocolVersion, type = "initialize", sessionId = _session.SessionId }));
        _editor?.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { protocolVersion = BridgeSession.ProtocolVersion, type = "initialize", sessionId = _session.SessionId, text = data.Text }));
        ApplyWebSettings();
        StartFileWatcher();
        UpdateDocumentStatus();
        if (data.Newline == "Mixed") SetStatus("检测到混合换行；保存时须明确选择统一为 CRLF 或 LF。");
    }

    private async Task<bool> SaveDocumentAsync(bool saveAs)
    {
        var snapshot = await RequestCurrentSnapshotAsync();
        var path = _document.Path;
        var expectedFingerprint = path is null ? null : _document.Fingerprint;
        if (saveAs || path is null)
        {
            var picker = new FileSavePicker(Win32Interop.GetWindowIdFromWindow(_window))
            { SuggestedFileName = path is null ? "未命名.md" : Path.GetFileName(path), DefaultFileExtension = ".md", ShowOverwritePrompt = true };
            picker.FileTypeChoices.Add("Markdown", new List<string> { ".md", ".markdown" });
            var selected = await picker.PickSaveFileAsync();
            if (selected is null) return false;
            path = selected.Path;
            if (string.Equals(path, _document.Path, StringComparison.OrdinalIgnoreCase))
                expectedFingerprint = _document.Fingerprint;
            else
                expectedFingerprint = File.Exists(path) ? DocumentFile.Read(path).Fingerprint : null;
            var oldRoot = Path.GetDirectoryName(_document.Path ?? _recoveryOriginalPath);
            if (oldRoot is not null && !string.Equals(oldRoot, Path.GetDirectoryName(path), StringComparison.OrdinalIgnoreCase)
                && snapshot.Text.Contains("![", StringComparison.Ordinal)
                && MessageBoxW(_window, "另存到其他目录将保留原图片引用，部分图片可能失效。本阶段不会复制或改写图片资产。是否继续？", "Marker · 相对图片引用", 0x34) != 6)
                return false;
        }
        var format = _document.Format;
        if (format.Newline == "Mixed")
        {
            var answer = MessageBoxW(_window, "此文件含混合换行。选择“是”统一为 CRLF，选择“否”统一为 LF；选择“取消”不保存。", "Marker · 保存换行格式", 0x23);
            if (answer == 2) return false;
            format = format with { Newline = answer == 6 ? "CRLF" : "LF" };
        }
        QueueRecovery();
        try { await _draftWrite; }
        catch (Exception error)
        {
            if (MessageBoxW(_window, $"恢复草稿无法写入：{error.Message}\n是否仍尝试将当前快照保存到所选文件？取消可继续编辑。", "Marker · 草稿写入失败", 0x134) != 6)
                return false;
        }
        var session = _session;
        try
        {
            var saved = await Task.Run(() => DocumentFile.Save(path!, snapshot.Text, format, expectedFingerprint));
            if (!ReferenceEquals(session, _session)) throw new IOException("保存时文档已切换。");
            _document = saved;
            _savedText = snapshot.Text;
            _forceDirty = false;
            _diskChanged = false;
            _recoveryOriginalPath = null;
            _images.SetRoot(Path.GetDirectoryName(saved.Path), _session.SessionId);
            StartFileWatcher();
            if (_latestSnapshot is { } latest) _ = RenderSnapshotAsync(latest);
            if (!IsDirty) await DeleteCurrentRecoveryAsync();
            else QueueRecovery();
            UpdateDocumentStatus();
            SetStatus(IsDirty ? "所选快照已保存，后续编辑仍未保存。" : "已安全保存。");
            return true;
        }
        catch (DocumentConflictException conflict)
        {
            _diskChanged = true;
            _forceDirty = true;
            QueueRecovery();
            UpdateDocumentStatus();
            var copy = conflict.PreservedExternalCopyPath is null ? "" : $"\n外部版本已保留在：{conflict.PreservedExternalCopyPath}\n";
            var answer = MessageBoxW(_window, $"{conflict.Message}{copy}\n选择“是”重新载入磁盘内容（会放弃当前编辑）；选择“否”另存为副本；选择“取消”保留编辑。", "Marker · 文件冲突", 0x23);
            if (answer == 6 && _document.Path is { } original)
            {
                EnableWindow(_editorWindow, false);
                // Read before clearing anything: a deleted/unreadable source leaves the draft intact.
                var reload = await ReadDocumentAsync(original);
                ValidateEditorText(reload.Text);
                await DeleteCurrentRecoveryAsync();
                await SwitchDocumentAsync(reload);
            }
            else if (answer == 7) return await SaveDocumentAsync(true);
            return false;
        }
    }

    private async Task<bool> ConfirmLeaveDocumentAsync()
    {
        if (!_editorReady && _latestSnapshot is null) return true;
        await RequestCurrentSnapshotAsync();
        // Document replacement/close freezes input after the current snapshot;
        // saving alone keeps editing available while the write is in progress.
        EnableWindow(_editorWindow, false);
        await RequestCurrentSnapshotAsync(); // Capture input queued between the first response and disabling the native child.
        if (!IsDirty) { await DeleteCurrentRecoveryAsync(); return true; }
        QueueRecovery();
        var recoveryWarning = "";
        try { await _draftWrite; }
        catch (Exception error) { recoveryWarning = $"\n恢复草稿写入失败：{error.Message}\n放弃将丢弃当前未保存内容。"; }
        var answer = MessageBoxW(_window, "当前文档尚未保存。选择“是”保存；选择“否”放弃当前编辑；选择“取消”继续编辑。" + recoveryWarning, "Marker · 未保存的修改", 0x23);
        if (answer == 2) return false;
        if (answer == 6)
        {
            if (!await SaveDocumentAsync(false) || IsDirty) return false;
        }
        await DeleteCurrentRecoveryAsync();
        return true;
    }

    private void QueueRecovery()
    {
        if (!IsDirty || _latestSnapshot is not { } snapshot) return;
        var draft = new RecoveryDraft(_documentId, snapshot.Version, DateTimeOffset.UtcNow,
            _document.Path ?? _recoveryOriginalPath, snapshot.Text, _document.Format,
            _document.Path is null ? null : _document.Fingerprint);
        _draftWrite = _draftWrite.ContinueWith(_ => _recovery.Save(draft), TaskScheduler.Default);
        _ = ObserveRecoveryAsync(_draftWrite);
    }

    private async Task ObserveRecoveryAsync(Task write)
    {
        try { await write; }
        catch (Exception error) { if (!_closed) SetStatus($"恢复草稿写入失败：{error.Message}。请保存或导出副本。"); }
    }

    private async Task DeleteCurrentRecoveryAsync()
    {
        _recoveryTimer?.Stop();
        try { await _draftWrite; } catch { /* Failed writes have already been reported; cleanup is still attempted. */ }
        try { await Task.Run(() => _recovery.Delete(_documentId)); }
        catch (Exception error) { SetStatus($"恢复草稿未能清理，文件已保留：{error.Message}"); }
    }

    private void StartFileWatcher()
    {
        _watcher?.Dispose(); _watcher = null;
        if (_document.Path is not { } path) return;
        try
        {
            _watcher = new FileSystemWatcher(Path.GetDirectoryName(path)!, Path.GetFileName(path))
            { NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size };
            FileSystemEventHandler changed = (_, _) => DispatcherQueue.TryEnqueue(() => _ = CheckDiskAsync());
            _watcher.Changed += changed; _watcher.Deleted += changed; _watcher.Created += changed;
            _watcher.Renamed += (_, _) => DispatcherQueue.TryEnqueue(() => _ = CheckDiskAsync());
            _watcher.Error += (_, _) => DispatcherQueue.TryEnqueue(() => SetStatus("文件监控暂不可用；保存前仍会复核磁盘内容。"));
            _watcher.EnableRaisingEvents = true;
        }
        catch (IOException error) { SetStatus($"文件监控不可用：{error.Message}；保存前仍会检查内容。"); }
    }

    private async Task CheckDiskAsync()
    {
        var document = _document;
        if (_closed || document.Path is not { } path) return;
        bool changed;
        try { changed = (await Task.Run(() => DocumentFile.Read(path, document.EncodingName))).Fingerprint != document.Fingerprint; }
        catch (IOException) { changed = true; }
        catch (UnauthorizedAccessException) { changed = true; }
        if (_closed || !ReferenceEquals(document, _document)) return;
        _diskChanged = changed;
        UpdateDocumentStatus();
        if (changed) SetStatus("磁盘文件已修改、删除或移动；保存前会检查冲突，不会静默覆盖。");
    }

    private async Task OfferRecoveryOnStartupAsync()
    {
        // Yield so the initial v0 handshake finishes before opening a native modal dialog.
        await Task.Delay(400);
        if (!_closed && !_operationBusy && (await Task.Run(_recovery.List)).Count > 0)
            await ExecuteDocumentCommandAsync("recover");
    }

    private async Task OfferRecoveryAsync()
    {
        var entries = await Task.Run(_recovery.List);
        if (entries.Count == 0) { SetStatus("没有待恢复的草稿。"); return; }
        foreach (var entry in entries.OrderByDescending(item => item.Draft?.UpdatedUtc))
        {
            if (entry.Draft is not { } draft)
            {
                MessageBoxW(_window, $"{entry.Error}\n损坏或未知版本草稿保留在 Recovery 目录，不会自动删除。", "Marker · 恢复草稿", 0x30);
                continue;
            }
            var answer = MessageBoxW(_window, $"发现 {draft.UpdatedUtc.LocalDateTime:g} 的恢复草稿。\n来源：{draft.OriginalPath ?? "未命名"}\n选择“是”恢复为未命名副本；选择“否”查看差异；选择“取消”保留草稿并继续。", "Marker · 恢复草稿", 0x23);
            if (answer == 2) return;
            if (answer == 7)
            {
                var disk = "";
                try { if (draft.OriginalPath is not null) disk = (await ReadDocumentAsync(draft.OriginalPath)).Text; }
                catch (IOException) { disk = "（原文件不存在或无法读取）"; }
                var oldLines = disk.Split('\n'); var newLines = draft.Text.Split('\n');
                var first = 0;
                while (first < Math.Min(oldLines.Length, newLines.Length) && oldLines[first] == newLines[first]) first++;
                var diff = $"首处差异：第 {first + 1} 行。以下仅展示该位置起最多 12 行。\n\n磁盘：\n{string.Join('\n', oldLines.Skip(first).Take(12))}\n\n草稿：\n{string.Join('\n', newLines.Skip(first).Take(12))}";
                MessageBoxW(_window, diff.Length > 12000 ? diff[..12000] + "\n（内容截断）" : diff, "Marker · 草稿差异", 0x40);
                if (MessageBoxW(_window, "是否将此草稿恢复为未命名副本？原文件不会被写入。", "Marker · 恢复副本", 0x34) != 6) continue;
            }
            ValidateEditorText(draft.Text);
            var data = new DocumentFileData(draft.Text, null, draft.Format.EncodingName, draft.Format.HasBom, draft.Format.Newline, "");
            await SwitchDocumentAsync(data, draft.DocId, draft.OriginalPath);
            SetStatus("已恢复为未命名副本；使用另存为选择目标，原文件没有被覆盖。");
            return;
        }
    }

    private void DisposeDocuments()
    {
        _recoveryTimer?.Stop();
        _watcher?.Dispose();
        _snapshotCompletion?.TrySetException(new IOException("窗口已关闭。"));
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int MessageBoxW(nint window, string text, string title, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool SetWindowTextW(nint window, string text);
    [DllImport("user32.dll")] private static extern bool PostMessageW(nint window, uint message, nuint wParam, nint lParam);
    [DllImport("user32.dll")] private static extern bool EnableWindow(nint window, bool enabled);
}
