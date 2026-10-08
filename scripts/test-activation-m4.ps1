param([ValidateSet('toolbar', 'editor', 'preview')][string]$DropTarget = 'toolbar')

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $root 'src\Marker.App\bin\x64\Release\net10.0-windows10.0.26100.0\win-x64\Marker.App.exe'
$artifacts = Join-Path $root 'artifacts'
$fixture = Join-Path $artifacts ('m4-activation-' + [guid]::NewGuid().ToString('N'))
$settings = Join-Path $env:LOCALAPPDATA 'Marker\settings.json'
$settingsBackup = Join-Path $artifacts ('m4-settings-before-test-' + [guid]::NewGuid().ToString('N') + '.bin')
$hadSettings = Test-Path -LiteralPath $settings -PathType Leaf
$process = $null
$secondary = $null
$rootWindow = [IntPtr]::Zero
$settingsBackedUp = $false
$sourceForm = $null
$oleStarted = $false
$resultPath = Join-Path $fixture 'result.json'
$result = [ordered]@{ firstLaunch = $false; secondInstance = $false; dragDrop = $false; dragDropTarget = $DropTarget; dragDropEffect = ''; dragDropScreenPoint = ''; leftMouseDownState = ''; invalidExtensionIgnored = $false; dirtyCancelPreserved = $false; fixture = $fixture }

try {
    if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) { throw 'This OLE drag test requires STA. Run: powershell.exe -STA -File scripts/test-activation-m4.ps1' }
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Marker executable not found: $exe" }
    $exePath = [IO.Path]::GetFullPath($exe)
    $running = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $exePath }
    if ($running) { throw "Refusing to redirect into an existing Marker process ($($running.ProcessId)); close it before running this isolated activation test." }
    New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null

    if ($hadSettings) {
        $settingsItem = Get-Item -LiteralPath $settings -Force
        if ($settingsItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Settings file is a reparse point; refusing to back up or replace it.' }
        [IO.File]::Copy($settings, $settingsBackup, $false)
        $settingsBackedUp = $true
    }

    $firstPath = Join-Path $fixture '首次 中文 文档.md'
    $secondPath = Join-Path $fixture '二次打开 文件.markdown'
    $dropPath = Join-Path $fixture '拖放 中文 文件.md'
    $invalidPath = Join-Path $fixture '不支持 文件.txt'
    $cancelPath = Join-Path $fixture '取消目标 文件.md'
    foreach ($path in @($firstPath, $secondPath, $dropPath, $invalidPath, $cancelPath)) {
        [IO.File]::WriteAllText($path, "# $([IO.Path]::GetFileNameWithoutExtension($path))`r`n", [Text.UTF8Encoding]::new($false))
    }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class MarkerActivationM4Native {
    public delegate bool EnumWindowProc(IntPtr hwnd, IntPtr parameter);
    public delegate bool EnumChildProc(IntPtr hwnd, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hwnd, int id);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int virtualKey);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentProcessId();
    public static string PlaceSourceFormOutsideMarker(IntPtr source, IntPtr root) {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            if (previous == IntPtr.Zero) throw new InvalidOperationException("Could not set Per-Monitor V2 DPI awareness for source placement.");
            Rect target, form;
            if (!GetWindowRect(root, out target) || !GetWindowRect(source, out form)) throw new InvalidOperationException("Could not read source or Marker window bounds.");
            int screenLeft = GetSystemMetrics(76), screenTop = GetSystemMetrics(77);
            int screenRight = screenLeft + GetSystemMetrics(78), screenBottom = screenTop + GetSystemMetrics(79);
            int width = form.Right - form.Left, height = form.Bottom - form.Top;
            int x = int.MinValue, y = Math.Max(screenTop, Math.Min(target.Top + 80, screenBottom - height));
            if (target.Left - screenLeft >= width + 16) x = target.Left - width - 16;
            else if (screenRight - target.Right >= width + 16) x = target.Right + 16;
            else if (target.Top - screenTop >= height + 16) { x = Math.Max(screenLeft, Math.Min(target.Left + 80, screenRight - width)); y = target.Top - height - 16; }
            else if (screenBottom - target.Bottom >= height + 16) { x = Math.Max(screenLeft, Math.Min(target.Left + 80, screenRight - width)); y = target.Bottom + 16; }
            if (x == int.MinValue) throw new InvalidOperationException("No visible desktop area was available beside Marker for the OLE source form.");
            if (!SetWindowPos(source, new IntPtr(-1), x, y, width, height, 0x0010)) throw new InvalidOperationException("Could not place the visible OLE source form outside Marker.");
            return String.Format("{0},{1}", x + width / 2, y + height / 2);
        } finally { if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
    }
    public static bool BeginOleDrag(IntPtr source) {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            if (previous == IntPtr.Zero) return false;
            uint pid; GetWindowThreadProcessId(source, out pid);
            if (pid != GetCurrentProcessId() || !IsWindowVisible(source) || GetForegroundWindow() != source) return false;
            Point point = new Point { X = 16, Y = 12 };
            if (!ClientToScreen(source, ref point) || WindowFromPoint(point) != source || !SetCursorPos(point.X, point.Y)) return false;
            mouse_event(2, 0, 0, 0, UIntPtr.Zero);
            return (GetAsyncKeyState(1) & 0x8000) != 0;
        } finally { if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
    }
    public static void ReleaseLeftButton() { mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
    public static string MoveToTargetAndRelease(IntPtr root, IntPtr targetWindow, bool toolbar) {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (previous == IntPtr.Zero) throw new InvalidOperationException("Could not set the test thread to Per-Monitor V2 DPI awareness.");
        Point target = new Point();
        IntPtr hitWindow = IntPtr.Zero;
        try {
            if (!IsWindowVisible(targetWindow)) throw new InvalidOperationException("The selected drop target HWND is not visible.");
            if (toolbar) {
                Rect client;
                if (!GetClientRect(root, out client)) throw new InvalidOperationException("Could not read root client bounds.");
                target.X = Math.Min(60, Math.Max(1, client.Right - 2));
                target.Y = Math.Min(80, Math.Max(1, client.Bottom - 2));
                if (!ClientToScreen(root, ref target)) throw new InvalidOperationException("Could not translate the root toolbar point to screen coordinates.");
            } else {
                Rect rect;
                if (!GetWindowRect(targetWindow, out rect)) throw new InvalidOperationException("Could not read the editor WebView bounds.");
                target.X = (rect.Left + rect.Right) / 2;
                target.Y = (rect.Top + rect.Bottom) / 2;
            }
            hitWindow = WindowFromPoint(target);
        } finally { SetThreadDpiAwarenessContext(previous); }
        int targetX = target.X, targetY = target.Y;
        IntPtr hitRoot = hitWindow == IntPtr.Zero ? IntPtr.Zero : GetAncestor(hitWindow, 2);
        Thread worker = new Thread(delegate() {
            IntPtr oldContext = SetThreadDpiAwarenessContext(new IntPtr(-4));
            if (oldContext == IntPtr.Zero) { mouse_event(4, 0, 0, 0, UIntPtr.Zero); return; }
            try {
                Thread.Sleep(500);
                SetCursorPos(targetX, targetY);
                Thread.Sleep(300);
            } finally {
                mouse_event(4, 0, 0, 0, UIntPtr.Zero);
                if (oldContext != IntPtr.Zero) SetThreadDpiAwarenessContext(oldContext);
            }
        });
        worker.IsBackground = true; worker.Start();
        return String.Format("{0},{1};hwnd=0x{2:X};root=0x{3:X}", targetX, targetY, hitWindow.ToInt64(), hitRoot.ToInt64());
    }

    public static string Text(IntPtr hwnd) { StringBuilder value = new StringBuilder(512); GetWindowText(hwnd, value, value.Capacity); return value.ToString(); }
    public static string ClassName(IntPtr hwnd) { StringBuilder value = new StringBuilder(128); GetClassName(hwnd, value, value.Capacity); return value.ToString(); }
    public static IntPtr FindRoot(uint expectedPid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) { uint pid; GetWindowThreadProcessId(hwnd, out pid); if (pid == expectedPid && GetWindow(hwnd, 4) == IntPtr.Zero && ClassName(hwnd) != "#32770" && Text(hwnd).StartsWith("Marker")) { found = hwnd; return false; } return true; }, IntPtr.Zero);
        return found;
    }
    public static IntPtr FindOwnedDialog(IntPtr root, uint expectedPid, string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) { uint pid; GetWindowThreadProcessId(hwnd, out pid); if (pid == expectedPid && GetWindow(hwnd, 4) == root && ClassName(hwnd) == "#32770" && Text(hwnd) == title) { found = hwnd; return false; } return true; }, IntPtr.Zero);
        return found;
    }
    public static IntPtr FindAnyOwnedDialog(IntPtr root, uint expectedPid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) { uint pid; GetWindowThreadProcessId(hwnd, out pid); if (pid == expectedPid && GetWindow(hwnd, 4) == root && ClassName(hwnd) == "#32770") { found = hwnd; return false; } return true; }, IntPtr.Zero);
        return found;
    }
    public static IntPtr FindDocumentChild(IntPtr root, string title) {
        IntPtr found = IntPtr.Zero; uint rootPid; GetWindowThreadProcessId(root, out rootPid);
        EnumChildWindows(root, delegate(IntPtr hwnd, IntPtr unused) { uint pid; GetWindowThreadProcessId(hwnd, out pid); if (pid == rootPid && GetParent(hwnd) == root && Text(hwnd) == title) { found = hwnd; return false; } return true; }, IntPtr.Zero);
        return found;
    }
    public static bool ClickOwnedButton(IntPtr dialog, IntPtr root, uint pid, string title, int id, string caption) {
        if (FindOwnedDialog(root, pid, title) != dialog) return false;
        // MessageBox controls can be nested. Select one exact caption within
        // this verified dialog, instead of assuming direct child control IDs.
        IntPtr button = IntPtr.Zero; int matches = 0;
        EnumChildWindows(dialog, delegate(IntPtr child, IntPtr unused) {
            uint childPid; GetWindowThreadProcessId(child, out childPid);
            if (childPid != pid || ClassName(child) != "Button") return true;
            string actual = Text(child).Replace("&", "").Trim();
            int shortcut = actual.IndexOf('(');
            if (shortcut >= 0 && actual.EndsWith(")")) actual = actual.Substring(0, shortcut).Trim();
            if ((caption == "取消" && (actual == "取消" || actual == "Cancel")) || (caption == "否" && (actual == "否" || actual == "No"))) { button = child; matches++; }
            return true;
        }, IntPtr.Zero);
        if (matches != 1 || FindOwnedDialog(root, pid, title) != dialog) return false;
        SendMessage(button, 0x00F5, IntPtr.Zero, IntPtr.Zero);
        return true;
    }
    public static bool FocusEditor(IntPtr root, IntPtr editor) {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (previous == IntPtr.Zero) return false;
        try {
            uint rootPid, editorPid; GetWindowThreadProcessId(root, out rootPid); GetWindowThreadProcessId(editor, out editorPid);
            if (rootPid == 0 || rootPid != editorPid || GetParent(editor) != root || !SetForegroundWindow(root) || GetForegroundWindow() != root) return false;
            Rect rect; if (!GetWindowRect(editor, out rect)) return false;
            if (!SetCursorPos((rect.Left + rect.Right) / 2, (rect.Top + rect.Bottom) / 2)) return false;
            mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
            return true;
        } finally { if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
    }
}
'@

    $process = Start-Process -FilePath $exe -ArgumentList @("`"$firstPath`"") -PassThru -WindowStyle Hidden
    $until = [DateTime]::UtcNow.AddSeconds(25)
    do {
        $process.Refresh()
        if ($process.HasExited) { throw "Marker exited during initial file activation with code $($process.ExitCode)." }
        $rootWindow = [MarkerActivationM4Native]::FindRoot([uint32]$process.Id)
        if ($rootWindow -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $until)
    if ($rootWindow -eq [IntPtr]::Zero) { throw 'The root HWND for the exact first Marker process was not found.' }

    function Wait-RootTitle([string]$contains, [int]$timeoutSeconds = 15) {
        $until = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
        do {
            $title = [MarkerActivationM4Native]::Text($rootWindow)
            if ($title.Contains($contains)) { return $title }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $until)
        throw "Timed out waiting for Marker title to contain '$contains'; actual='$([MarkerActivationM4Native]::Text($rootWindow))'."
    }
    function Start-SecondActivation([string]$path) {
        $script:secondary = Start-Process -FilePath $exe -ArgumentList @("`"$path`"") -PassThru -WindowStyle Hidden
        if (-not $script:secondary.WaitForExit(12000)) { throw "Second Marker process $($script:secondary.Id) did not exit after activation redirection." }
    }

    $null = Wait-RootTitle ([IO.Path]::GetFileName($firstPath))
    $result.firstLaunch = $true

    Start-SecondActivation $secondPath
    $null = Wait-RootTitle ([IO.Path]::GetFileName($secondPath))
    $result.secondInstance = $true

    Start-SecondActivation $invalidPath
    Start-Sleep -Milliseconds 700
    if ([MarkerActivationM4Native]::FindAnyOwnedDialog($rootWindow, [uint32]$process.Id) -ne [IntPtr]::Zero) { throw 'An unsupported extension opened a blocking dialog.' }
    if ([MarkerActivationM4Native]::Text($rootWindow) -notlike ('*' + [IO.Path]::GetFileName($secondPath) + '*')) { throw 'An unsupported extension changed the current document.' }
    $result.invalidExtensionIgnored = $true

    $secondary = Start-Process -FilePath $exe -ArgumentList ((@("`"$firstPath`"") * 65) -join ' ') -PassThru -WindowStyle Hidden
    if (-not $secondary.WaitForExit(12000)) { throw 'Oversize activation did not redirect and exit.' }
    Start-Sleep -Milliseconds 300
    if ([MarkerActivationM4Native]::Text($rootWindow) -notlike ('*' + [IO.Path]::GetFileName($secondPath) + '*')) { throw 'More than 64 activation arguments changed the current document.' }
    $result.tooManyArgumentsIgnored = $true

    $sourceForm = [System.Windows.Forms.Form]::new()
    $sourceForm.Text = 'M4 OLE source'
    $sourceForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
    $sourceForm.ShowInTaskbar = $false
    $sourceForm.TopMost = $true
    $sourceForm.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $sourceForm.ClientSize = [System.Drawing.Size]::new(32, 24)
    $sourceForm.CreateControl()
    $null = $sourceForm.Handle
    $result.oleSourceScreenPoint = [MarkerActivationM4Native]::PlaceSourceFormOutsideMarker($sourceForm.Handle, $rootWindow)
    $sourceForm.Show()
    $sourceForm.Activate()
    if ([MarkerActivationM4Native]::GetForegroundWindow() -ne $sourceForm.Handle) { throw 'The test-only OLE source form did not become foreground.' }
    $dataObject = [System.Windows.Forms.DataObject]::new()
    $dropFiles = [System.Collections.Specialized.StringCollection]::new()
    $dropFiles.Add($dropPath) | Out-Null
    $dataObject.SetFileDropList($dropFiles)
    $dropWindow = switch ($DropTarget) {
        'editor' { [MarkerActivationM4Native]::FindDocumentChild($rootWindow, 'Marker editor'); break }
        'preview' { [MarkerActivationM4Native]::FindDocumentChild($rootWindow, 'Marker preview'); break }
        default { $rootWindow }
    }
    if ($dropWindow -eq [IntPtr]::Zero) { throw "The requested '$DropTarget' drop target HWND was not found." }
    if (-not [MarkerActivationM4Native]::BeginOleDrag($sourceForm.Handle)) { throw 'Could not press the mouse inside the visible OLE source form.' }
    [System.Windows.Forms.Application]::DoEvents()
    $oleStarted = $true
    $result.leftMouseDownState = ('0x{0:X4}' -f ([MarkerActivationM4Native]::GetAsyncKeyState(1) -band 0xFFFF))
    if (([MarkerActivationM4Native]::GetAsyncKeyState(1) -band 0x8000) -eq 0) { [MarkerActivationM4Native]::ReleaseLeftButton(); throw 'Synthetic left-button down was not visible to GetAsyncKeyState before DoDragDrop.' }
    $result.dragDropScreenPoint = [MarkerActivationM4Native]::MoveToTargetAndRelease($rootWindow, $dropWindow, $DropTarget -eq 'toolbar')
    $dragDropEffect = $sourceForm.DoDragDrop($dataObject, [System.Windows.Forms.DragDropEffects]::Copy)
    $oleStarted = $false
    $result.dragDropEffect = $dragDropEffect.ToString()
    Write-Host "OLE source=$($result.oleSourceScreenPoint); DoDragDrop result=$($result.dragDropEffect); target=$DropTarget; screen hit=$($result.dragDropScreenPoint); left-button=$($result.leftMouseDownState)"
    $null = Wait-RootTitle ([IO.Path]::GetFileName($dropPath))
    $result.dragDrop = $true

    $editor = [MarkerActivationM4Native]::FindDocumentChild($rootWindow, 'Marker editor')
    $marker = 'M4_CANCEL_' + [guid]::NewGuid().ToString('N')
    if ($editor -eq [IntPtr]::Zero -or -not [MarkerActivationM4Native]::FocusEditor($rootWindow, $editor)) { throw 'Could not safely focus the editor child.' }
    [System.Windows.Forms.SendKeys]::SendWait("^{END}{ENTER}" + $marker + "{ENTER}")
    $dirtyUntil = [DateTime]::UtcNow.AddSeconds(5)
    do { $dirtyTitleValue = [MarkerActivationM4Native]::Text($rootWindow); if ($dirtyTitleValue.EndsWith('*')) { break }; Start-Sleep -Milliseconds 100 } while ([DateTime]::UtcNow -lt $dirtyUntil)
    if (-not $dirtyTitleValue.EndsWith('*')) { throw 'The test-only edit did not make the fixture document dirty.' }
    Start-SecondActivation $cancelPath
    $dirtyTitle = 'Marker · 未保存的修改'
    $dialog = [IntPtr]::Zero
    $until = [DateTime]::UtcNow.AddSeconds(12)
    do {
        $dialog = [MarkerActivationM4Native]::FindOwnedDialog($rootWindow, [uint32]$process.Id, $dirtyTitle)
        if ($dialog -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $until)
    $cancelled = $false
    while ($dialog -ne [IntPtr]::Zero -and [DateTime]::UtcNow -lt $until) {
        if ([MarkerActivationM4Native]::ClickOwnedButton($dialog, $rootWindow, [uint32]$process.Id, $dirtyTitle, 2, '取消')) { $cancelled = $true; break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $cancelled) { throw 'The Marker-owned dirty prompt or its exact Cancel button was not found.' }
    Start-Sleep -Milliseconds 500
    $currentTitle = [MarkerActivationM4Native]::Text($rootWindow)
    if ($currentTitle -notlike ('*' + [IO.Path]::GetFileName($dropPath) + '*') -or -not $currentTitle.EndsWith('*')) { throw "Cancel did not preserve the dirty current document; title='$currentTitle'." }
    $result.dirtyCancelPreserved = $true
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixture 'result.json') -Encoding UTF8
    $result | Format-List
}
catch {
    $result.error = $_.Exception.Message
    throw
}
finally {
    if ($oleStarted) { [MarkerActivationM4Native]::ReleaseLeftButton() }
    if ($process -and -not $process.HasExited) {
        $process.Refresh()
        if ($rootWindow -ne [IntPtr]::Zero) {
            [void][MarkerActivationM4Native]::SendMessage($rootWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
            $until = [DateTime]::UtcNow.AddSeconds(8)
            do {
                $dialog = [MarkerActivationM4Native]::FindOwnedDialog($rootWindow, [uint32]$process.Id, 'Marker · 未保存的修改')
                if ($dialog -ne [IntPtr]::Zero) { [void][MarkerActivationM4Native]::ClickOwnedButton($dialog, $rootWindow, [uint32]$process.Id, 'Marker · 未保存的修改', 7, '否') }
                if ($process.WaitForExit(100)) { break }
            } while ([DateTime]::UtcNow -lt $until)
        }
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    }
    if ($secondary -and -not $secondary.HasExited) { Stop-Process -Id $secondary.Id -Force -ErrorAction SilentlyContinue }
    if ($sourceForm) { $sourceForm.Dispose() }
    if ($settingsBackedUp) { [IO.File]::Copy($settingsBackup, $settings, $true); Remove-Item -LiteralPath $settingsBackup -Force }
    elseif (-not $hadSettings -and (Test-Path -LiteralPath $settings -PathType Leaf)) { Remove-Item -LiteralPath $settings -Force }
    if (Test-Path -LiteralPath $fixture -PathType Container) {
        $result | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
        Write-Host "Activation test result: $resultPath"
    }
}
