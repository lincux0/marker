[CmdletBinding()]
param([Parameter(Mandatory)][string]$PackagePath)
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
$result = [ordered]@{passed=$false; installed=$false; windowShown=$false; uninstalled=$false; machineTrustRemoved=$false}
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
    $result.windowTitle = $process.MainWindowTitle
    $result.windowShown = $process.MainWindowTitle -eq 'Marker'
    if (-not $result.windowShown) { throw 'The installed app window title is unexpected.' }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MarkerWindowRect {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
    Add-Type -AssemblyName System.Drawing
    $oldDpiContext = [MarkerWindowRect]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
    $rect = [MarkerWindowRect+Rect]::new()
    if (-not [MarkerWindowRect]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) { throw 'Cannot locate the Marker window.' }
    $bitmap = [Drawing.Bitmap]::new($rect.Right-$rect.Left, $rect.Bottom-$rect.Top)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size)
        $bitmap.Save((Join-Path $root 'artifacts\marker-m0.png'),[Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose(); $bitmap.Dispose()
        [void][MarkerWindowRect]::SetThreadDpiAwarenessContext($oldDpiContext)
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
