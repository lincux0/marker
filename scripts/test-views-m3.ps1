[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$ProcessId,
    [Parameter(Mandatory)][ValidateSet('source', 'split', 'read')][string]$Mode,
    [ValidateSet('light', 'dark', 'system')][string]$Theme,
    [ValidateRange(12, 24)][int]$FontSize = 16
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$expectedExe = Join-Path $root 'src\Marker.App\bin\x64\Release\net10.0-windows10.0.26100.0\win-x64\Marker.App.exe'
$process = Get-Process -Id $ProcessId -ErrorAction Stop
$process.Refresh()
$exePath = [IO.Path]::GetFullPath($process.MainModule.FileName)
if ([IO.Path]::GetFileName($exePath) -ne 'Marker.App.exe' -or
    $exePath -ine [IO.Path]::GetFullPath($expectedExe)) {
    throw "Refusing PID $ProcessId; its executable is not this workspace's Marker.App.exe: $exePath"
}
if ($process.HasExited -or $process.MainWindowHandle -eq [IntPtr]::Zero) {
    throw "Marker PID $ProcessId has no live root window."
}

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class MarkerM3ViewsNative {
    public delegate bool EnumChildProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    public static string Title(IntPtr hwnd) { StringBuilder value = new StringBuilder(256); GetWindowText(hwnd, value, value.Capacity); return value.ToString(); }
    public static IntPtr FindChild(IntPtr root, uint expectedProcessId, string expectedTitle) {
        List<IntPtr> matches = new List<IntPtr>();
        EnumChildWindows(root, delegate(IntPtr hwnd, IntPtr unused) {
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            if (pid == expectedProcessId && GetParent(hwnd) == root && Title(hwnd) == expectedTitle) matches.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return matches.Count == 1 ? matches[0] : IntPtr.Zero;
    }
}
'@

$mainWindow = [IntPtr]$process.MainWindowHandle
$rootPid = [uint32]0
[void][MarkerM3ViewsNative]::GetWindowThreadProcessId($mainWindow, [ref]$rootPid)
if ($rootPid -ne [uint32]$ProcessId -or -not ([MarkerM3ViewsNative]::Title($mainWindow).StartsWith('Marker', [StringComparison]::Ordinal))) {
    throw "Refusing root window 0x$($mainWindow.ToInt64().ToString('X')); PID/title verification failed."
}

function Find-ByAutomationId([string]$automationId) {
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $automationId)
    $element = [System.Windows.Automation.AutomationElement]::FromHandle($mainWindow).FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants, $condition)
    if (-not $element -or $element.Current.ProcessId -ne $ProcessId) {
        throw "Could not find Marker control AutomationId '$automationId' in PID $ProcessId."
    }
    return $element
}

function Select-ComboItem([string]$automationId, [string]$name) {
    $combo = Find-ByAutomationId $automationId
    if ($combo.Current.ControlType -ne [System.Windows.Automation.ControlType]::ComboBox) {
        throw "AutomationId '$automationId' is not a ComboBox."
    }
    $expand = $combo.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($expand.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) { $expand.Expand() }

    $nameCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty, $name)
    $until = [DateTime]::UtcNow.AddSeconds(3)
    $item = $null
    do {
        # WinUI hosts ComboBox items in its owner PopupWindowSiteBridge. Search
        # from the verified ComboBox tree, not the desktop root, where those
        # popup descendants may not be exposed consistently.
        $candidates = $combo.FindAll([System.Windows.Automation.TreeScope]::Descendants, $nameCondition)
        $matches = @($candidates | Where-Object {
            $_.Current.ProcessId -eq $ProcessId -and
            $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem
        })
        if ($matches.Count -eq 1) { $item = $matches[0]; break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $until)
    if (-not $item) {
        if ($expand.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) { $expand.Collapse() }
        throw "Expanded '$automationId' but could not find one matching '$name' item owned by Marker PID $ProcessId."
    }
    $selectionItem = $item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $selectionItem.Select()
    if (-not $selectionItem.Current.IsSelected) {
        throw "Marker did not select '$name' in '$automationId'."
    }
    # WinUI may leave the popup open after SelectionItem.Select(). Close it
    # explicitly so the next control lookup resolves against the root window.
    if ($expand.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) {
        $expand.Collapse()
    }
    $closedBy = [DateTime]::UtcNow.AddSeconds(2)
    while ($expand.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Collapsed -and
        [DateTime]::UtcNow -lt $closedBy) {
        Start-Sleep -Milliseconds 50
    }
    if ($expand.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Collapsed) {
        throw "Marker selected '$name' in '$automationId' but its popup did not close."
    }
}

$modeLabels = @{ source = '源码'; split = '分栏'; read = '阅读' }
Select-ComboItem 'ViewMode' $modeLabels[$Mode]
if ($PSBoundParameters.ContainsKey('Theme')) {
    $themeLabels = @{ system = '跟随系统'; light = '浅色'; dark = '深色' }
    Select-ComboItem 'Theme' $themeLabels[$Theme]
}
if ($PSBoundParameters.ContainsKey('FontSize')) {
    $fontBox = Find-ByAutomationId 'FontSize'
    $range = $fontBox.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)
    if ($range.Current.IsReadOnly -or $FontSize -lt $range.Current.Minimum -or $FontSize -gt $range.Current.Maximum) {
        throw 'Marker font-size control is read-only or does not accept the requested value.'
    }
    $range.SetValue([double]$FontSize)
    if ($range.Current.Value -ne [double]$FontSize) { throw 'Marker did not apply the requested font size.' }
}

$editor = [MarkerM3ViewsNative]::FindChild($mainWindow, [uint32]$ProcessId, 'Marker editor')
$preview = [MarkerM3ViewsNative]::FindChild($mainWindow, [uint32]$ProcessId, 'Marker preview')
if ($editor -eq [IntPtr]::Zero -or $preview -eq [IntPtr]::Zero) {
    throw 'Could not uniquely identify both native WebView child windows owned by the Marker root.'
}
if ([MarkerM3ViewsNative]::GetForegroundWindow() -ne $mainWindow -and
    -not [MarkerM3ViewsNative]::SetForegroundWindow($mainWindow)) {
    throw 'Could not safely restore the verified Marker window before inspecting mode visibility.'
}

$expected = switch ($Mode) {
    source { @{ editor = $true; preview = $false } }
    split  { @{ editor = $true; preview = $true } }
    read   { @{ editor = $false; preview = $true } }
}
$deadline = [DateTime]::UtcNow.AddSeconds(3)
do {
    $editorVisible = [MarkerM3ViewsNative]::IsWindowVisible($editor)
    $previewVisible = [MarkerM3ViewsNative]::IsWindowVisible($preview)
    if ($editorVisible -eq $expected.editor -and $previewVisible -eq $expected.preview) { break }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
if ($editorVisible -ne $expected.editor -or $previewVisible -ne $expected.preview) {
    throw "Mode '$Mode' visibility mismatch: editor=$editorVisible preview=$previewVisible."
}

[pscustomobject]@{
    passed = $true
    processId = $ProcessId
    executable = $exePath
    mode = $Mode
    theme = if ($PSBoundParameters.ContainsKey('Theme')) { $Theme } else { $null }
    fontSize = if ($PSBoundParameters.ContainsKey('FontSize')) { $FontSize } else { $null }
    editorVisible = $editorVisible
    previewVisible = $previewVisible
}
