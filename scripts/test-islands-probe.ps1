$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $root 'experiments\Marker.IslandsProbe\bin\x64\Release\net10.0-windows10.0.26100.0\win-x64\Marker.IslandsProbe.exe'
$resultPath = Join-Path $root 'artifacts\islands-probe-smoke.json'
New-Item -ItemType Directory -Path (Split-Path $resultPath -Parent) -Force | Out-Null
$process = $null
$mainWindow = [IntPtr]::Zero
$oldDpiContext = [IntPtr]::Zero
$result = [ordered]@{ passed = $false; started = $false; windowFound = $false; editorFound = $false; focusVerified = $false; foregroundVerified = $false; previewVersion = 0; resized = $false; closed = $false; processExited = $false }

try {
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Probe executable not found: $exe" }

    Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MarkerIslandsWin32 {
    public delegate bool EnumChildProc(IntPtr hwnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct GuiThreadInfo {
        public int Size; public uint Flags; public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        public Rect CaretRect;
    }
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr lParam);
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

    $process = Start-Process -FilePath $exe -PassThru
    $result.started = $true
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $process.Refresh()
        if ($process.HasExited) { throw "Probe exited during startup with code $($process.ExitCode)." }
        if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
            $candidate = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
            if ($candidate.Current.Name -eq 'Marker XAML Islands 输入验收原型') {
                $mainWindow = $process.MainWindowHandle
                break
            }
        }
        Start-Sleep -Milliseconds 500
    }
    if ($mainWindow -eq [IntPtr]::Zero) { throw 'Probe main window title was not found.' }
    $result.windowFound = $true

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

    $editorWindow = Find-NativeChild $mainWindow 'Marker Islands editor'
    $result.editorFound = (Get-WindowTitle $editorWindow) -eq 'Marker Islands editor'
    if (-not $result.editorFound) { throw 'Located native editor title did not match.' }
    $uiRoot = [System.Windows.Automation.AutomationElement]::FromHandle($mainWindow)
    $status = Find-RawElement $uiRoot { param($item) $item.Current.Name -match '^预览已同步.*v[0-9]+' }
    if (-not $status) {
        for ($attempt = 0; $attempt -lt 60 -and -not $status; $attempt++) {
            Start-Sleep -Milliseconds 500
            $status = Find-RawElement $uiRoot { param($item) $item.Current.Name -match '^预览已同步.*v[0-9]+' }
        }
    }
    if (-not $status -or $status.Current.Name -notmatch 'v([0-9]+)') { throw 'Toolbar preview did not report a synchronized version.' }
    $baselineVersion = [int]$Matches[1]
    $result.previewVersion = $baselineVersion

    if (-not [MarkerIslandsWin32]::SetForegroundWindow($mainWindow)) { throw 'Windows refused to focus the probe window.' }
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
    $gui = [MarkerIslandsWin32+GuiThreadInfo]::new()
    $gui.Size = [Runtime.InteropServices.Marshal]::SizeOf([type][MarkerIslandsWin32+GuiThreadInfo])
    $threadId = [MarkerIslandsWin32]::GetWindowThreadProcessId($mainWindow, [IntPtr]::Zero)
    if (-not [MarkerIslandsWin32]::GetGUIThreadInfo($threadId, [ref]$gui)) { throw 'GetGUIThreadInfo failed for the probe UI thread.' }
    $result.focusHandle = ('0x{0:X}' -f $gui.Focus.ToInt64())
    $result.focusVerified = $gui.Focus -ne [IntPtr]::Zero -and ($gui.Focus -eq $editorWindow -or [MarkerIslandsWin32]::IsChild($editorWindow, $gui.Focus))
    if (-not $result.focusVerified) { throw 'Keyboard focus is not in the native editor child subtree.' }

    if ([MarkerIslandsWin32]::GetForegroundWindow() -ne $mainWindow) { throw 'Foreground safety check failed before sending editor keys.' }
    $result.foregroundVerified = $true
    [System.Windows.Forms.SendKeys]::SendWait('^{END}{ENTER}ISLANDS_SMOKE{ENTER}')
    $previewVersion = 0
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 250
        $status = Find-RawElement $uiRoot { param($item) $item.Current.Name -match '^预览已同步.*v([0-9]+)' }
        if ($status -and $status.Current.Name -match 'v([0-9]+)') {
            $previewVersion = [int]$Matches[1]
            if ($previewVersion -gt $baselineVersion -and $previewVersion -ge 1) { break }
        }
    }
    if (-not $status -or $previewVersion -le $baselineVersion -or $previewVersion -lt 1) { throw 'Editor input did not advance the synchronized preview to version >= 1.' }
    $result.previewVersion = $previewVersion
    $result.previewStatus = $status.Current.Name

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
