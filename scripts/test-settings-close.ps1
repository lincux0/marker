[CmdletBinding()]
param([Parameter(Mandatory)][int]$ProcessId, [switch]$ExpectedMaximized)
$ErrorActionPreference = 'Stop'
$expectedExe = Join-Path (Split-Path $PSScriptRoot -Parent) 'src\Marker.App\bin\x64\Release\net10.0-windows10.0.26100.0\win-x64\Marker.App.exe'
if ((Get-Process -Id $ProcessId).Path -ine $expectedExe) { throw 'Only this workspace Marker can be tested.' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MarkerSettingsCheck {
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
}
'@
$condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
$windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition)
$owner = $windows | Where-Object { $_.Current.Name -ne 'Marker 设置' } | Select-Object -First 1
if (-not $owner) { throw 'Main window not found.' }
$hwnd = [IntPtr]$owner.Current.NativeWindowHandle
$settingsCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, 'Marker 设置')
$settings = $owner.FindFirst([Windows.Automation.TreeScope]::Descendants, $settingsCondition)
if (-not $settings) { $settings = $windows | Where-Object { $_.Current.Name -eq 'Marker 设置' } | Select-Object -First 1 }
if (-not $settings) { throw 'Open Settings before running this check.' }
if ([MarkerSettingsCheck]::IsZoomed($hwnd) -ne $ExpectedMaximized.IsPresent) { throw 'Unexpected initial owner state.' }
# Simulate closing the active Settings window; background UIA calls do not grant foreground rights.
$thread = [MarkerSettingsCheck]::GetCurrentThreadId()
$foregroundThread = [MarkerSettingsCheck]::GetWindowThreadProcessId([MarkerSettingsCheck]::GetForegroundWindow(), [IntPtr]::Zero)
$attached = [MarkerSettingsCheck]::AttachThreadInput($thread, $foregroundThread, $true)
try {
    [void][MarkerSettingsCheck]::ShowWindow([IntPtr]$settings.Current.NativeWindowHandle, 9)
    [void][MarkerSettingsCheck]::SetForegroundWindow([IntPtr]$settings.Current.NativeWindowHandle)
}
finally { if ($attached) { [void][MarkerSettingsCheck]::AttachThreadInput($thread, $foregroundThread, $false) } }
Start-Sleep -Milliseconds 150
if ([MarkerSettingsCheck]::GetForegroundWindow() -ne [IntPtr]$settings.Current.NativeWindowHandle) { throw 'Could not activate Settings for a valid close test.' }
$pattern = $settings.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern)
$pattern.Close()
Start-Sleep -Milliseconds 650
if ([MarkerSettingsCheck]::IsIconic($hwnd) -or -not [MarkerSettingsCheck]::IsWindowVisible($hwnd)) { throw 'Closing Settings hid or minimized the owner.' }
if ([MarkerSettingsCheck]::IsZoomed($hwnd) -ne $ExpectedMaximized.IsPresent) { throw 'Closing Settings changed maximized state.' }
if ([MarkerSettingsCheck]::GetForegroundWindow() -ne $hwnd) { throw 'Closing Settings did not return foreground to the owner.' }
Start-Sleep -Seconds 2
if ([MarkerSettingsCheck]::IsIconic($hwnd) -or -not [MarkerSettingsCheck]::IsWindowVisible($hwnd) -or
    [MarkerSettingsCheck]::IsZoomed($hwnd) -ne $ExpectedMaximized.IsPresent) { throw 'Owner state changed after the close completed.' }
[pscustomobject]@{ passed = $true; maximized = $ExpectedMaximized.IsPresent; owner = $hwnd.ToInt64() }
