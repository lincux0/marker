using System.Runtime.InteropServices;
using System.Text;
using Microsoft.UI.Xaml;
using Windows.ApplicationModel.DataTransfer;

namespace Marker.App;

public sealed partial class MainWindow
{
    private const uint WmDropFiles = 0x0233;

    private void Shell_DragOver(object sender, DragEventArgs args)
    {
        args.AcceptedOperation = args.DataView.Contains(StandardDataFormats.StorageItems)
            ? DataPackageOperation.Copy : DataPackageOperation.None;
        args.Handled = true;
    }

    private async void Shell_Drop(object sender, DragEventArgs args)
    {
        args.Handled = true;
        var deferral = args.GetDeferral();
        try
        {
            if (args.DataView.Contains(StandardDataFormats.StorageItems))
            {
                var items = await args.DataView.GetStorageItemsAsync();
                QueueOpenFiles(items.OfType<Windows.Storage.StorageFile>().Select(file => file.Path));
            }
        }
        catch (Exception error) { SetStatus($"无法读取拖入的文件：{error.Message}"); }
        finally { deferral.Complete(); }
    }

    internal void InitializeFileDrop()
    {
        DragAcceptFiles(_window, true);
        DragAcceptFiles(_editorWindow, true);
        DragAcceptFiles(_previewWindow, true);
    }

    internal bool IsFileDropWindow(nint window) => window == _window || window == _editorWindow || window == _previewWindow;

    internal void HandleDroppedFiles(nuint dropHandle)
    {
        var drop = (nint)dropHandle;
        try
        {
            var count = DragQueryFileW(drop, uint.MaxValue, null, 0);
            if (count > 64)
            {
                MessageBoxW(_window, "一次最多拖入 64 个 Markdown 文件。", "Marker · 文件过多", 0x30);
                return;
            }

            var paths = new List<string>((int)count);
            for (uint index = 0; index < count; index++)
            {
                var length = DragQueryFileW(drop, index, null, 0);
                if (length == 0 || length > 32767) continue;
                var buffer = new StringBuilder((int)length + 1);
                if (DragQueryFileW(drop, index, buffer, (uint)buffer.Capacity) != 0)
                    paths.Add(buffer.ToString());
            }
            QueueOpenFiles(paths);
        }
        finally { DragFinish(drop); }
    }

    internal void QueueOpenFiles(IEnumerable<string> paths)
    {
        string[] candidates;
        try { candidates = paths.Take(65).ToArray(); }
        catch { return; }
        if (candidates.Length > 64)
        {
            DispatcherQueue.TryEnqueue(() => SetStatus("一次最多打开 64 个 Markdown 文件；本次未打开文件。"));
            return;
        }
        if (candidates.Any(candidate => MarkdownActivation.TryNormalizePath(candidate, out _)))
            Interlocked.Exchange(ref _fileActivationReceived, 1);
        if (!DispatcherQueue.TryEnqueue(() =>
        {
            foreach (var candidate in candidates)
            {
                if (!MarkdownActivation.TryNormalizePath(candidate, out var path))
                    continue;
                if (_queuedFileOpenPaths.Add(path)) _pendingFileOpenPaths.Enqueue(path);
            }

            Native.ShowWindow(_window, IsIconic(_window) ? 9 : 5);
            SetForegroundWindow(_window);
            ConsumePendingFileActivations();
        })) return;
    }

    internal void ConsumePendingFileActivations()
    {
        if (_closed || !_editorReady || _operationBusy || _fileOpenDrainActive || _pendingFileOpenPaths.Count == 0) return;
        _fileOpenDrainActive = true;
        _ = DrainFileActivationsAsync();
    }

    private async Task DrainFileActivationsAsync()
    {
        try
        {
            while (!_closed && !_operationBusy && _pendingFileOpenPaths.TryDequeue(out var path))
            {
                _queuedFileOpenPaths.Remove(path);
                await ExecuteDocumentCommandAsync("openPath", path);
            }
        }
        finally
        {
            _fileOpenDrainActive = false;
            ConsumePendingFileActivations();
        }
    }

    [DllImport("shell32.dll", EntryPoint = "DragAcceptFiles")]
    private static extern void DragAcceptFiles(nint window, [MarshalAs(UnmanagedType.Bool)] bool accept);
    [DllImport("shell32.dll", EntryPoint = "DragQueryFileW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint DragQueryFileW(nint drop, uint fileIndex, StringBuilder? filePath, uint bufferLength);
    [DllImport("shell32.dll", EntryPoint = "DragFinish")]
    private static extern void DragFinish(nint drop);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(nint window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(nint window);
}
