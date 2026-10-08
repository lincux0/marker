[CmdletBinding()]
param([Parameter(Mandatory)][int]$ProcessId, [Parameter(Mandatory)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$rootPath = Split-Path $PSScriptRoot -Parent
$expectedExe = Join-Path $rootPath 'src\Marker.App\bin\x64\Release\net10.0-windows10.0.26100.0\win-x64\Marker.App.exe'
$process = Get-Process -Id $ProcessId -ErrorAction Stop
if ($process.Path -ine $expectedExe) { throw 'Only the Marker Release test window can be captured.' }
$output = [IO.Path]::GetFullPath($OutputPath)
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $rootPath 'artifacts')) + [IO.Path]::DirectorySeparatorChar
if (-not $output.StartsWith($artifactRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($output) -ine '.png') {
    throw 'Screenshots must be PNG files inside this repository artifacts directory.'
}
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MarkerCaptureNative {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
$oldDpi = [MarkerCaptureNative]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
try {
    $process.Refresh()
    $window = $process.MainWindowHandle
    if ($window -eq [IntPtr]::Zero) { throw 'Marker has no visible root window.' }
    if (-not [MarkerCaptureNative]::SetForegroundWindow($window)) { throw 'Cannot safely foreground the Marker test window.' }
    Start-Sleep -Milliseconds 350
    $bounds = [MarkerCaptureNative+Rect]::new()
    if (-not [MarkerCaptureNative]::GetWindowRect($window, [ref]$bounds)) { throw 'Cannot read window bounds.' }
    $rect = [Drawing.Rectangle]::FromLTRB($bounds.Left, $bounds.Top, $bounds.Right, $bounds.Bottom)
    $rect = [Drawing.Rectangle]::Intersect($rect, [Windows.Forms.SystemInformation]::VirtualScreen)
    if ($rect.Width -lt 1 -or $rect.Height -lt 1) { throw 'Window is outside the desktop.' }
    $bitmap = [Drawing.Bitmap]::new($rect.Width, $rect.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Location, [Drawing.Point]::Empty, $rect.Size)
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output)) | Out-Null
        $bitmap.Save($output, [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    [pscustomobject]@{ path = $output; width = $rect.Width; height = $rect.Height; processId = $ProcessId }
} finally { [void][MarkerCaptureNative]::SetThreadDpiAwarenessContext($oldDpi) }
