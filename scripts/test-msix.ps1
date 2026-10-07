[CmdletBinding()]
param([Parameter(Mandatory)][string]$PackagePath, [switch]$M1)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this installation smoke check in an administrator PowerShell session.'
}
if (Get-AppxPackage -Name Marker | Where-Object Publisher -eq 'CN=Marker.Dev') {
    throw 'An existing Marker development installation must be preserved. Uninstall it explicitly before this temporary test.'
}
$resultPath = Join-Path $root 'artifacts\msix-smoke.json'
$cert = $null
$addedTrust = $false
$app = $null
$process = $null
$mainWindow = [IntPtr]::Zero
$result = [ordered]@{passed=$false; installed=$false; windowShown=$false; recoveryPromptPreserved=$false; dirtyCloseNoClicked=$false; uninstalled=$false; machineTrustRemoved=$false}
try {
    # Sign first without changing machine trust, then capture the exact signer for cleanup.
    & (Join-Path $PSScriptRoot 'install-dev.ps1') -PackagePath $PackagePath
    $cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $root 'artifacts\Marker.Dev.cer'))
    $trustPath = 'Cert:\LocalMachine\TrustedPeople\' + $cert.Thumbprint
    $result.certificateThumbprint = $cert.Thumbprint
    if (-not (Test-Path -LiteralPath $trustPath)) {
        Import-Certificate -FilePath (Join-Path $root 'artifacts\Marker.Dev.cer') -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
        $addedTrust = $true
    }
    & (Join-Path $PSScriptRoot 'install-dev.ps1') -PackagePath $PackagePath -TrustMachine
    $app = Get-AppxPackage -Name Marker | Where-Object Publisher -eq 'CN=Marker.Dev'
    if (-not $app) { throw 'Marker was not registered after installation.' }
    $result.installed = $true
    $result.packageFullName = $app.PackageFullName
    $result.installLocation = $app.InstallLocation
    $result.osBuild = [Environment]::OSVersion.Version.ToString()
    Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\' + $app.PackageFamilyName + '!App') -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        $process = Get-Process -Name 'Marker.App' -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq (Join-Path $app.InstallLocation 'Marker.App.exe') -and $_.MainWindowHandle -ne 0 } |
            Select-Object -First 1
        if ($process) { break }
    }
    if (-not $process) { throw 'The installed Marker process did not show a window.' }
    $mainWindow = $process.MainWindowHandle
    $result.windowTitle = $process.MainWindowTitle
    $result.windowShown = $process.MainWindowTitle -eq 'Marker'
    if (-not $result.windowShown) { throw 'The installed app window title is unexpected.' }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MarkerMsixDialog {
    public delegate bool EnumWindowProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumWindows(EnumWindowProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog, int controlId);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
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
}
'@
    function Clear-RecoveryPrompt {
        $recoveryDialog = [MarkerMsixDialog]::FindOwnedDialog($mainWindow, [uint32]$process.Id, 'Marker · 恢复草稿')
        if ($recoveryDialog -eq [IntPtr]::Zero) { return }
        if (-not [MarkerMsixDialog]::ClickOwnedDialogButton($recoveryDialog, $mainWindow, [uint32]$process.Id, 'Marker · 恢复草稿', 2, '取消')) {
            throw 'Found Marker recovery prompt but could not safely select its Cancel button; recovery draft was left untouched.'
        }
        $result.recoveryPromptPreserved = $true
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Clear-RecoveryPrompt
        Start-Sleep -Milliseconds 100
    }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MarkerWindowRect {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
}
'@
    if ($M1) {
        # Real packaged WebView handshake, not merely a successful process launch.
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
        $window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
        # FindFirst's optimized provider query can omit WinUI siblings after a WebView.
        # RawViewWalker traverses the native tree without that provider shortcut.
        function Find-MarkerControl($node, [string]$id) {
            if ($node.Current.AutomationId -eq $id) { return $node }
            $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
            $child = $walker.GetFirstChild($node)
            while ($child) {
                $found = Find-MarkerControl $child $id
                if ($found) { return $found }
                $child = $walker.GetNextSibling($child)
            }
        }
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            Clear-RecoveryPrompt
            $status = Find-MarkerControl $window 'BridgeStatus'
            if ($status -and $status.Current.Name -match '预览已同步.*v0') { break }
            Start-Sleep -Milliseconds 500
        }
        $result.bridgeStatus = if ($status) { $status.Current.Name } else { '' }
        $result.previewReady = $result.bridgeStatus -match '预览已同步.*v0'
        if (-not $result.previewReady) { throw ('Packaged editor/Markdig/preview handshake failed: ' + $result.bridgeStatus) }
        # Exercise keyboard editing in the real WebView; this is deliberately not an IME test.
        Clear-RecoveryPrompt
        [void][MarkerWindowRect]::SetForegroundWindow($process.MainWindowHandle)
        $inputDpi = [MarkerWindowRect]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
        try {
            $inputRect = [MarkerWindowRect+Rect]::new()
            if (-not [MarkerWindowRect]::GetWindowRect($process.MainWindowHandle, [ref]$inputRect)) { throw 'Cannot locate the editor window.' }
            [void][MarkerWindowRect]::SetCursorPos($inputRect.Left + [int](($inputRect.Right-$inputRect.Left)/4), $inputRect.Top + [int](($inputRect.Bottom-$inputRect.Top)/3))
            [MarkerWindowRect]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
            [MarkerWindowRect]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
        } finally { [void][MarkerWindowRect]::SetThreadDpiAwarenessContext($inputDpi) }
        Add-Type -AssemblyName System.Windows.Forms
        Clear-RecoveryPrompt
        [System.Windows.Forms.SendKeys]::SendWait('^{END}{ENTER}M1 smoke')
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            $result.bridgeStatus = $status.Current.Name
            if ($result.bridgeStatus -match '预览已同步.*v([1-9][0-9]*)') { break }
            Start-Sleep -Milliseconds 500
        }
        $result.editPreviewUpdated = $result.bridgeStatus -match '预览已同步.*v([1-9][0-9]*)'
        if (-not $result.editPreviewUpdated) { throw 'Editing did not update the packaged preview.' }
    }
    Add-Type -AssemblyName System.Drawing
    $oldDpiContext = [MarkerWindowRect]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
    $rect = [MarkerWindowRect+Rect]::new()
    if (-not [MarkerWindowRect]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) { throw 'Cannot locate the Marker window.' }
    $bitmap = [Drawing.Bitmap]::new($rect.Right-$rect.Left, $rect.Bottom-$rect.Top)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size)
        $screenshot = if ($M1) { 'artifacts\marker-m1.png' } else { 'artifacts\marker-m0.png' }
        $bitmap.Save((Join-Path $root $screenshot),[Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose(); $bitmap.Dispose()
        [void][MarkerWindowRect]::SetThreadDpiAwarenessContext($oldDpiContext)
    }
    if ($M1) {
        if (-not [MarkerWindowRect]::PostMessage($mainWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Could not post WM_CLOSE to the installed Marker window.' }
        $dirtyDialog = [IntPtr]::Zero
        for ($attempt = 0; $attempt -lt 100; $attempt++) {
            $dirtyDialog = [MarkerMsixDialog]::FindOwnedDialog($mainWindow, [uint32]$process.Id, 'Marker · 未保存的修改')
            if ($dirtyDialog -ne [IntPtr]::Zero) { break }
            if ($process.HasExited) { break }
            Start-Sleep -Milliseconds 100
        }
        if ($dirtyDialog -eq [IntPtr]::Zero) { throw 'Timed out waiting for Marker owned dirty-close prompt; the smoke test remains failed.' }
        if (-not [MarkerMsixDialog]::ClickOwnedDialogButton($dirtyDialog, $mainWindow, [uint32]$process.Id, 'Marker · 未保存的修改', 7, '否')) {
            throw 'Found Marker unsaved-changes prompt but could not safely select its No button.'
        }
        $result.dirtyCloseNoClicked = $true
        $result.closedNormally = $process.WaitForExit(10000)
        if (-not $result.closedNormally) { throw 'Marker did not exit after closing its window.' }
    }
    $result.passed = $true
} catch {
    $result.error = $_.Exception.Message
    throw
} finally {
    try {
        if (-not $app) {
            $app = Get-AppxPackage -Name Marker | Where-Object Publisher -eq 'CN=Marker.Dev'
        }
        if ($app) {
            Get-Process -Name 'Marker.App' -ErrorAction SilentlyContinue |
                Where-Object { $_.Path -eq (Join-Path $app.InstallLocation 'Marker.App.exe') } |
                Stop-Process -Force
            Remove-AppxPackage -Package $app.PackageFullName
            $result.uninstalled = -not [bool](Get-AppxPackage -Name Marker | Where-Object Publisher -eq 'CN=Marker.Dev')
        }
    } finally {
        try {
            if ($addedTrust -and $cert) {
                Remove-Item -LiteralPath ('Cert:\LocalMachine\TrustedPeople\' + $cert.Thumbprint)
                $result.machineTrustRemoved = -not (Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPeople\' + $cert.Thumbprint))
            }
        } finally {
            $result.passed = $result.passed -and $result.uninstalled -and (-not $addedTrust -or $result.machineTrustRemoved)
            $result | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
            if ($cert) { $cert.Dispose() }
        }
    }
}
