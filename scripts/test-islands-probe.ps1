[CmdletBinding()]
param([switch]$Production)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$exe = if ($Production) {
    Join-Path $root 'src\Marker.App\bin\x64\Release\net10.0-windows10.0.26100.0\win-x64\Marker.App.exe'
} else {
    Join-Path $root 'experiments\Marker.IslandsProbe\bin\x64\Release\net10.0-windows10.0.26100.0\win-x64\Marker.IslandsProbe.exe'
}
$windowTitle = if ($Production) { 'Marker — native-host-smoke.md' } else { 'Marker XAML Islands 输入验收原型' }
$editorTitle = if ($Production) { 'Marker editor' } else { 'Marker Islands editor' }
$previewTitle = if ($Production) { 'Marker preview' } else { 'Marker Islands preview' }
$toolbarFirstButton = if ($Production) { '新建文档' } else { '进入编辑器' }
$resultPath = Join-Path $root $(if ($Production) { 'artifacts\native-host-smoke.json' } else { 'artifacts\islands-probe-smoke.json' })
New-Item -ItemType Directory -Path (Split-Path $resultPath -Parent) -Force | Out-Null
$process = $null
$mainWindow = [IntPtr]::Zero
$oldDpiContext = [IntPtr]::Zero
$result = [ordered]@{ production = [bool]$Production; passed = $false; started = $false; windowFound = $false; editorFound = $false; previewFound = $false; focusVerified = $false; tabToPreviewVerified = $false; tabToToolbarVerified = $false; shiftTabToPreviewVerified = $false; shiftTabToEditorVerified = $false; foregroundVerified = $false; previewVersion = 0; resized = $false; recoveryPromptPreserved = $false; unsavedPromptDiscarded = $false; closed = $false; processExited = $false }

try {
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Executable not found: $exe" }

    Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MarkerIslandsWin32 {
    public delegate bool EnumChildProc(IntPtr hwnd, IntPtr lParam);
    public delegate bool EnumWindowProc(IntPtr hwnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct GuiThreadInfo {
        public int Size; public uint Flags; public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        public Rect CaretRect;
    }
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr lParam);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumWindows(EnumWindowProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog, int controlId);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    public static IntPtr FindOwnedDialog(IntPtr owner, uint processId, string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid != processId || GetWindow(hwnd, 4) != owner) return true;
            StringBuilder text = new StringBuilder(512), className = new StringBuilder(128);
            GetWindowText(hwnd, text, text.Capacity);
            GetClassName(hwnd, className, className.Capacity);
            if (text.ToString() == title && className.ToString() == "#32770") { found = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static bool ActivateOwnedWindow(IntPtr hwnd, uint processId, string title) {
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        StringBuilder text = new StringBuilder(512);
        GetWindowText(hwnd, text, text.Capacity);
        if (hwnd == IntPtr.Zero || pid != processId || text.ToString() != title) return false;
        ShowWindow(hwnd, 9);
        SetForegroundWindow(hwnd);
        return GetForegroundWindow() == hwnd;
    }
    public static bool ClickOwnedDialogButton(IntPtr dialog, IntPtr owner, uint processId, string title, int controlId, string buttonText) {
        uint pid;
        GetWindowThreadProcessId(dialog, out pid);
        StringBuilder dialogTitle = new StringBuilder(512), className = new StringBuilder(128);
        GetWindowText(dialog, dialogTitle, dialogTitle.Capacity);
        GetClassName(dialog, className, className.Capacity);
        IntPtr button = GetDlgItem(dialog, controlId);
        StringBuilder label = new StringBuilder(128);
        StringBuilder buttonClass = new StringBuilder(128);
        if (button != IntPtr.Zero) { GetWindowText(button, label, label.Capacity); GetClassName(button, buttonClass, buttonClass.Capacity); }
        string caption = label.ToString().Replace("&", "").Trim();
        int shortcut = caption.IndexOf('(');
        if (shortcut >= 0 && caption.EndsWith(")")) caption = caption.Substring(0, shortcut).Trim();
        bool captionMatches = (controlId == 7 && buttonText == "否" && (caption == "否" || caption == "No")) ||
            (controlId == 2 && buttonText == "取消" && (caption == "取消" || caption == "Cancel"));
        if (pid != processId || GetWindow(dialog, 4) != owner || dialogTitle.ToString() != title || className.ToString() != "#32770" ||
            button == IntPtr.Zero || GetParent(button) != dialog || buttonClass.ToString() != "Button" || !captionMatches) return false;
        SendMessage(button, 0x00F5, IntPtr.Zero, IntPtr.Zero);
        return true;
    }
    public static IntPtr FindChildByTitle(IntPtr parent, string title) {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, delegate(IntPtr hwnd, IntPtr unused) {
            StringBuilder text = new StringBuilder(512);
            GetWindowText(hwnd, text, text.Capacity);
            if (text.ToString() == title) { found = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr processId);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetGUIThreadInfo(uint threadId, ref GuiThreadInfo info);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; public Point(int x, int y) { X=x; Y=y; } }
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
}
'@
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
    $oldDpiContext = [MarkerIslandsWin32]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
    if ($oldDpiContext -eq [IntPtr]::Zero) { throw 'Could not enable per-monitor DPI awareness for physical window bounds.' }

    if ($Production) {
        # Use an explicit test file so startup never offers the user's recovery
        # draft. This smoke checks the host, not recovery acceptance.
        $fixture = Join-Path $root 'artifacts\native-host-smoke.md'
        [IO.File]::WriteAllText($fixture, [string]::Empty, [Text.UTF8Encoding]::new($false))
        $process = Start-Process -FilePath $exe -ArgumentList "`"$fixture`"" -PassThru
    } else { $process = Start-Process -FilePath $exe -PassThru }
    $result.started = $true
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $process.Refresh()
        if ($process.HasExited) { throw "Probe exited during startup with code $($process.ExitCode)." }
        if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
            $candidate = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
            if ($candidate.Current.Name -eq $windowTitle) {
                $mainWindow = $process.MainWindowHandle
                break
            }
        }
        Start-Sleep -Milliseconds 500
    }
    if ($mainWindow -eq [IntPtr]::Zero) { throw "Main window '$windowTitle' was not found." }
    $result.windowFound = $true
    function Clear-RecoveryPrompt {
        if (-not $Production) { return }
        $recoveryDialog = [MarkerIslandsWin32]::FindOwnedDialog($mainWindow, [uint32]$process.Id, 'Marker · 恢复草稿')
        if ($recoveryDialog -eq [IntPtr]::Zero) { return }
        # The button helper verifies owner/PID/title/caption; BM_CLICK does not
        # need global foreground focus and cannot target another application's prompt.
        Start-Sleep -Milliseconds 200
        if (-not [MarkerIslandsWin32]::ClickOwnedDialogButton($recoveryDialog, $mainWindow, [uint32]$process.Id, 'Marker · 恢复草稿', 2, '取消')) {
            throw 'Found Marker recovery prompt but could not safely select its Cancel button; recovery draft was left untouched.'
        }
        $result.recoveryPromptPreserved = $true
        Start-Sleep -Milliseconds 200
        if (-not [MarkerIslandsWin32]::ActivateOwnedWindow($mainWindow, [uint32]$process.Id, $windowTitle)) {
            throw 'The recovery prompt was cancelled without changing its draft, but Marker could not be restored to the foreground for input.'
        }
    }

    function Find-RawElement($node, [scriptblock]$predicate) {
        if (& $predicate $node) { return $node }
        $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
        $child = $walker.GetFirstChild($node)
        while ($child) {
            $found = Find-RawElement $child $predicate
            if ($found) { return $found }
            $child = $walker.GetNextSibling($child)
        }
    }
    function Find-NativeChild([IntPtr]$parent, [string]$title) {
        $native = [MarkerIslandsWin32]::FindChildByTitle($parent, $title)
        if ($native -eq [IntPtr]::Zero) { throw "Native child window '$title' was not found by EnumChildWindows." }
        $native
    }
    function Get-KeyboardFocus([IntPtr]$window) {
        $info = [MarkerIslandsWin32+GuiThreadInfo]::new()
        $info.Size = [Runtime.InteropServices.Marshal]::SizeOf([type][MarkerIslandsWin32+GuiThreadInfo])
        $thread = [MarkerIslandsWin32]::GetWindowThreadProcessId($window, [IntPtr]::Zero)
        if (-not [MarkerIslandsWin32]::GetGUIThreadInfo($thread, [ref]$info)) { throw 'GetGUIThreadInfo failed for the app UI thread.' }
        $info.Focus
    }
    function Test-FocusInNativeChild([IntPtr]$window, [IntPtr]$child) {
        $focus = Get-KeyboardFocus $window
        $focus -ne [IntPtr]::Zero -and ($focus -eq $child -or [MarkerIslandsWin32]::IsChild($child, $focus))
    }
    function Wait-FocusInNativeChild([IntPtr]$window, [IntPtr]$child) {
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            if (Test-FocusInNativeChild $window $child) { return }
            Start-Sleep -Milliseconds 100
        }
        throw ('Keyboard focus did not move into native child 0x{0:X}.' -f $child.ToInt64())
    }
    function Assert-AppForeground([IntPtr]$window, [string]$stage) {
        if ([MarkerIslandsWin32]::GetForegroundWindow() -ne $window) { throw "Foreground safety check failed before $stage." }
    }
    function Get-WindowTitle([IntPtr]$handle) {
        $text = [Text.StringBuilder]::new(512)
        [void][MarkerIslandsWin32]::GetWindowText($handle, $text, $text.Capacity)
        $text.ToString()
    }
    function Assert-EditorBounds([IntPtr]$window, [IntPtr]$editor) {
        $windowClient = [MarkerIslandsWin32+Rect]::new()
        $editorRect = [MarkerIslandsWin32+Rect]::new()
        if (-not [MarkerIslandsWin32]::GetClientRect($window, [ref]$windowClient) -or -not [MarkerIslandsWin32]::GetWindowRect($editor, [ref]$editorRect)) { throw 'Could not read probe/editor bounds.' }
        $origin = [MarkerIslandsWin32+Point]::new(0, 0)
        if (-not [MarkerIslandsWin32]::ClientToScreen($window, [ref]$origin)) { throw 'Could not map the probe client area to screen coordinates.' }
        $clientLeft, $clientTop = $origin.X, $origin.Y
        $clientRight = $clientLeft + $windowClient.Right
        $clientBottom = $clientTop + $windowClient.Bottom
        $inside = $editorRect.Left -ge $clientLeft -and $editorRect.Top -ge $clientTop -and $editorRect.Right -le $clientRight -and $editorRect.Bottom -le $clientBottom
        $size = $editorRect.Right -gt $editorRect.Left -and $editorRect.Bottom -gt $editorRect.Top
        [ordered]@{ insideClient = $inside; positiveSize = $size; editor = [ordered]@{ left=$editorRect.Left; top=$editorRect.Top; right=$editorRect.Right; bottom=$editorRect.Bottom }; client = [ordered]@{ left=$clientLeft; top=$clientTop; right=$clientRight; bottom=$clientBottom } }
    }

    $editorWindow = Find-NativeChild $mainWindow $editorTitle
    $result.editorFound = (Get-WindowTitle $editorWindow) -eq $editorTitle
    if (-not $result.editorFound) { throw 'Located native editor title did not match.' }
    $previewWindow = Find-NativeChild $mainWindow $previewTitle
    $result.previewFound = (Get-WindowTitle $previewWindow) -eq $previewTitle
    if (-not $result.previewFound) { throw 'Located native preview title did not match.' }
    $uiRoot = [System.Windows.Automation.AutomationElement]::FromHandle($mainWindow)
    $statusPredicate = if ($Production) {
        { param($item) $item.Current.AutomationId -eq 'BridgeStatus' -and $item.Current.Name -match '^预览已同步 · v[0-9]+' }
    } else {
        { param($item) $item.Current.Name -match '^预览已同步 · v[0-9]+' }
    }
    $status = Find-RawElement $uiRoot $statusPredicate
    Clear-RecoveryPrompt
    if (-not $status) {
        for ($attempt = 0; $attempt -lt 60 -and -not $status; $attempt++) {
            Clear-RecoveryPrompt
            Start-Sleep -Milliseconds 500
            $status = Find-RawElement $uiRoot $statusPredicate
        }
    }
    if (-not $status -or $status.Current.Name -notmatch 'v([0-9]+)') { throw 'Toolbar preview did not report a synchronized version.' }
    $baselineVersion = [int]$Matches[1]
    $result.previewVersion = $baselineVersion

    Clear-RecoveryPrompt
    if (-not [MarkerIslandsWin32]::ActivateOwnedWindow($mainWindow, [uint32]$process.Id, $windowTitle)) { throw 'Windows refused to focus the probe window.' }
    Start-Sleep -Milliseconds 150
    if ([MarkerIslandsWin32]::GetForegroundWindow() -ne $mainWindow) { throw 'Foreground safety check failed before clicking the editor.' }
    $editorRect = [MarkerIslandsWin32+Rect]::new()
    if (-not [MarkerIslandsWin32]::GetWindowRect($editorWindow, [ref]$editorRect)) { throw 'Cannot locate the native editor window.' }
    $centerX = [int](($editorRect.Left + $editorRect.Right) / 2)
    $centerY = [int](($editorRect.Top + $editorRect.Bottom) / 2)
    if (-not [MarkerIslandsWin32]::SetCursorPos($centerX, $centerY)) { throw 'Cannot move the pointer to the native editor.' }
    if ([MarkerIslandsWin32]::GetForegroundWindow() -ne $mainWindow) { throw 'Foreground safety check failed before clicking the editor.' }
    [MarkerIslandsWin32]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [MarkerIslandsWin32]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 250
    $focus = Get-KeyboardFocus $mainWindow
    $result.focusHandle = ('0x{0:X}' -f $focus.ToInt64())
    $result.focusVerified = $focus -ne [IntPtr]::Zero -and ($focus -eq $editorWindow -or [MarkerIslandsWin32]::IsChild($editorWindow, $focus))
    if (-not $result.focusVerified) { throw 'Keyboard focus is not in the native editor child subtree.' }

    Assert-AppForeground $mainWindow 'sending editor keys'
    Clear-RecoveryPrompt
    $result.foregroundVerified = $true
    $smokeText = if ($Production) { 'MARKER_NATIVE_SMOKE' } else { 'ISLANDS_SMOKE' }
    [System.Windows.Forms.SendKeys]::SendWait("^{END}{ENTER}${smokeText}{ENTER}")
    $previewVersion = 0
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 250
        $status = Find-RawElement $uiRoot $statusPredicate
        if ($status -and $status.Current.Name -match 'v([0-9]+)') {
            $previewVersion = [int]$Matches[1]
            if ($previewVersion -gt $baselineVersion -and $previewVersion -ge 1) { break }
        }
    }
    if (-not $status -or $previewVersion -le $baselineVersion -or $previewVersion -lt 1) { throw 'Editor input did not advance the synchronized preview version.' }
    $result.previewVersion = $previewVersion
    $result.previewStatus = $status.Current.Name

    Assert-AppForeground $mainWindow 'sending Tab to the preview'
    [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
    Wait-FocusInNativeChild $mainWindow $previewWindow
    $result.tabToPreviewVerified = $true

    Assert-AppForeground $mainWindow 'sending Tab to the toolbar'
    [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
    $toolbarFocusVerified = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $focus = Get-KeyboardFocus $mainWindow
        if ($focus -ne [IntPtr]::Zero -and [MarkerIslandsWin32]::IsChild($mainWindow, $focus) -and
            -not [MarkerIslandsWin32]::IsChild($editorWindow, $focus) -and -not [MarkerIslandsWin32]::IsChild($previewWindow, $focus)) {
            try {
                $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement
                if ($focusedElement -and $focusedElement.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
                    $focusedElement.Current.IsKeyboardFocusable -and $focusedElement.Current.Name -eq $toolbarFirstButton) {
                    $result.toolbarFocusName = $focusedElement.Current.Name
                    $result.toolbarAutomationId = $focusedElement.Current.AutomationId
                    $toolbarFocusVerified = $true
                    break
                }
            } catch { }
        }
        Start-Sleep -Milliseconds 100
    }
    if (-not $toolbarFocusVerified) { throw 'Tab did not reach a UI Automation button in the XAML Islands toolbar.' }
    $result.tabToToolbarVerified = $true

    Assert-AppForeground $mainWindow 'sending Shift+Tab to the preview'
    [System.Windows.Forms.SendKeys]::SendWait('+{TAB}')
    Wait-FocusInNativeChild $mainWindow $previewWindow
    $result.shiftTabToPreviewVerified = $true

    Assert-AppForeground $mainWindow 'sending Shift+Tab to the editor'
    [System.Windows.Forms.SendKeys]::SendWait('+{TAB}')
    Wait-FocusInNativeChild $mainWindow $editorWindow
    $result.shiftTabToEditorVerified = $true

    $originalRect = [MarkerIslandsWin32+Rect]::new()
    if (-not [MarkerIslandsWin32]::GetWindowRect($mainWindow, [ref]$originalRect)) { throw 'Cannot read the original probe window position.' }
    $targetWidth = 1040
    $targetHeight = 760
    if (-not [MarkerIslandsWin32]::SetWindowPos($mainWindow, [IntPtr]::Zero, $originalRect.Left + 24, $originalRect.Top + 24, $targetWidth, $targetHeight, 0x0014)) { throw 'SetWindowPos failed while resizing the probe window.' }
    Start-Sleep -Milliseconds 400
    $bounds = Assert-EditorBounds $mainWindow $editorWindow
    $result.resized = $true
    $result.editorBounds = $bounds
    if (-not $bounds.positiveSize -or -not $bounds.insideClient) { throw 'Resized native editor has invalid dimensions or lies outside the probe client area.' }

    if ([MarkerIslandsWin32]::GetForegroundWindow() -ne $mainWindow) { throw 'Foreground safety check failed before closing the probe window.' }
    if (-not [MarkerIslandsWin32]::PostMessage($mainWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Could not post WM_CLOSE to the probe window.' }
    if ($Production) {
        $dialogHandled = $false
        for ($attempt = 0; $attempt -lt 100; $attempt++) {
            $dirtyDialog = [MarkerIslandsWin32]::FindOwnedDialog($mainWindow, [uint32]$process.Id, 'Marker · 未保存的修改')
            if ($dirtyDialog -ne [IntPtr]::Zero) {
                if (-not [MarkerIslandsWin32]::ClickOwnedDialogButton($dirtyDialog, $mainWindow, [uint32]$process.Id, 'Marker · 未保存的修改', 7, '否')) {
                    throw 'Found Marker unsaved-changes prompt but could not safely select its No button.'
                }
                $dialogHandled = $true
                break
            }
            if ($process.HasExited) { break }
            Start-Sleep -Milliseconds 100
        }
        if (-not $dialogHandled) { throw 'Timed out waiting for Marker owned dirty-close prompt; the smoke test remains failed.' }
        $result.unsavedPromptDiscarded = $true
    }
    $result.closed = $true
    $result.processExited = $process.WaitForExit(10000)
    if (-not $result.processExited) { throw 'Probe process did not exit after closing its window.' }
    $result.passed = $true
} catch {
    $result.error = $_.Exception.Message
    throw
} finally {
    if ($process) {
        $process.Refresh()
        if (-not $process.HasExited) {
            if ($mainWindow -ne [IntPtr]::Zero) { [void][MarkerIslandsWin32]::PostMessage($mainWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
            if (-not $process.WaitForExit(3000)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $process.WaitForExit() }
        }
    }
    if ($oldDpiContext -ne [IntPtr]::Zero) { [void][MarkerIslandsWin32]::SetThreadDpiAwarenessContext($oldDpiContext) }
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding UTF8
}
