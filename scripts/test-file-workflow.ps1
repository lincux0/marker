[CmdletBinding()]
param([switch]$KeepOpen, [switch]$BrowserInput, [switch]$StopAfterOpen)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$artifactRoot = Join-Path $root 'artifacts'
$fixtureRoot = Join-Path $artifactRoot ('m2-workflow-' + [guid]::NewGuid().ToString('N'))
$documentRoot = Join-Path $fixtureRoot 'docs'
$documentPath = Join-Path $documentRoot 'note.md'
$copyPath = Join-Path $documentRoot 'fixturecopy.md'
$resultPath = Join-Path $artifactRoot 'file-workflow-smoke.json'
$exe = Join-Path $root 'src\Marker.App\bin\x64\Release\net10.0-windows10.0.26100.0\win-x64\Marker.App.exe'
$process = $null
$mainWindow = [IntPtr]::Zero
$fixtureCreated = $false
$keepProcessOpen = [bool]$KeepOpen -or [bool]$BrowserInput -or [bool]$StopAfterOpen
$result = [ordered]@{ passed = $false; preparedOnly = $false; keepOpen = $keepProcessOpen; browserInput = [bool]$BrowserInput; stopAfterOpen = [bool]$StopAfterOpen; recoveryPromptPreserved = $false; pickerValidated = $false; opened = $false; savedImmediately = $false; conflictCancelled = $false; externalUnchanged = $false; editRetained = $false; savedAsCopy = $false; fixtureCopyExists = $false; closed = $false }

try {
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Marker executable not found: $exe" }
    New-Item -ItemType Directory -Path (Join-Path $documentRoot 'assets') -Force | Out-Null
    $fixtureCreated = $true
    $pixel = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=')
    [IO.File]::WriteAllBytes((Join-Path $documentRoot 'assets\pixel.png'), $pixel)
    [IO.File]::WriteAllBytes((Join-Path $fixtureRoot 'outside.png'), $pixel)
    $initialText = "# M2`r`n`r`n![Pixel](assets/pixel.png)`r`n`r`n![Blocked](../outside.png)`r`n"
    $utf8Bom = [byte[]](0xEF, 0xBB, 0xBF)
    [IO.File]::WriteAllBytes($documentPath, $utf8Bom + [Text.UTF8Encoding]::new($false).GetBytes($initialText))
    $result.fixtureRoot = $fixtureRoot
    $result.documentPath = $documentPath
    $result.copyPath = $copyPath
    $result.outsideReference = '../outside.png'

    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
    Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class MarkerFileWorkflowWin32 {
    public delegate bool EnumWindowProc(IntPtr hwnd, IntPtr lParam);
    public delegate bool EnumChildProc(IntPtr hwnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumWindows(EnumWindowProc callback, IntPtr lParam);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr parent, int controlId);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageW")] public static extern IntPtr ReadWindowTextMessage(IntPtr hwnd, uint message, IntPtr capacity, [Out] StringBuilder text);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    public static string Title(IntPtr hwnd) { StringBuilder value = new StringBuilder(512); GetWindowText(hwnd, value, value.Capacity); return value.ToString(); }
    public static string ClassName(IntPtr hwnd) { StringBuilder value = new StringBuilder(128); GetClassName(hwnd, value, value.Capacity); return value.ToString(); }
    public static IntPtr FindChildByTitle(IntPtr parent, string title) {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, delegate(IntPtr hwnd, IntPtr unused) { if (Title(hwnd) == title) { found = hwnd; return false; } return true; }, IntPtr.Zero);
        return found;
    }
    public static IntPtr[] FindOwnedWindows(IntPtr ownerRoot, string windowClass) {
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
            if (hwnd != ownerRoot && IsWindowVisible(hwnd) && GetAncestor(hwnd, 3) == ownerRoot && ClassName(hwnd) == windowClass) found.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return found.ToArray();
    }
    public static bool IsOwnedWindow(IntPtr hwnd, IntPtr ownerRoot, uint expectedProcessId, string expectedTitle) {
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        return pid == expectedProcessId && GetWindow(hwnd, 4) == ownerRoot && Title(hwnd) == expectedTitle && ClassName(hwnd) == "#32770";
    }
    public static bool IsOwnedPicker(IntPtr hwnd, IntPtr ownerRoot, uint expectedProcessId) {
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        return pid == expectedProcessId && GetWindow(hwnd, 4) == ownerRoot && GetAncestor(hwnd, 3) == ownerRoot && ClassName(hwnd) == "#32770";
    }
    public static IntPtr FindDialogDescendant(IntPtr dialog, uint expectedProcessId, int controlId, string windowClass) {
        IntPtr found = IntPtr.Zero;
        int matches = 0;
        EnumChildWindows(dialog, delegate(IntPtr hwnd, IntPtr unused) {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == expectedProcessId && GetDlgCtrlID(hwnd) == controlId && ClassName(hwnd) == windowClass &&
                IsChild(dialog, hwnd) && GetAncestor(hwnd, 2) == dialog) {
                found = hwnd;
                matches++;
            }
            return true;
        }, IntPtr.Zero);
        return matches == 1 ? found : IntPtr.Zero;
    }
    public static bool IsPickerButton(IntPtr dialog, IntPtr button, string expectedCaption) {
        if (button == IntPtr.Zero || GetDlgItem(dialog, 1) != button || GetParent(button) != dialog || ClassName(button) != "Button") return false;
        string caption = Title(button).Replace("&", "").Trim();
        int shortcut = caption.IndexOf('(');
        if (shortcut >= 0 && caption.EndsWith(")")) caption = caption.Substring(0, shortcut).Trim();
        return (expectedCaption == "打开" && (caption == "打开" || caption == "Open")) ||
            (expectedCaption == "保存" && (caption == "保存" || caption == "Save"));
    }
    public static bool SendUnicodeText(IntPtr edit, string text) {
        if (edit == IntPtr.Zero || String.IsNullOrEmpty(text)) return false;
        for (int i = 0; i < text.Length; i++) SendMessage(edit, 0x0102, (IntPtr)(int)text[i], (IntPtr)1);
        return true;
    }
    public static bool ClickDialogButton(IntPtr hwnd, IntPtr ownerRoot, uint expectedProcessId, string title, int id, string text) {
        if (!IsOwnedWindow(hwnd, ownerRoot, expectedProcessId, title)) return false;
        IntPtr button = GetDlgItem(hwnd, id);
        if (button == IntPtr.Zero || GetParent(button) != hwnd || ClassName(button) != "Button") return false;
        string caption = Title(button).Replace("&", "").Trim();
        int shortcut = caption.IndexOf('(');
        if (shortcut >= 0 && caption.EndsWith(")")) caption = caption.Substring(0, shortcut).Trim();
        bool captionMatches = (id == 7 && text == "否" && (caption == "否" || caption == "No")) ||
            (id == 2 && text == "取消" && (caption == "取消" || caption == "Cancel"));
        if (!captionMatches) return false;
        SendMessage(button, 0x00F5, IntPtr.Zero, IntPtr.Zero);
        return true;
    }
    public static IntPtr FindOwnedDialog(IntPtr ownerRoot, uint expectedProcessId, string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
            if (IsOwnedWindow(hwnd, ownerRoot, expectedProcessId, title)) { found = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static string[] GetOwnedDialogTitles(IntPtr ownerRoot, uint expectedProcessId) {
        List<string> titles = new List<string>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == expectedProcessId && GetWindow(hwnd, 4) == ownerRoot && ClassName(hwnd) == "#32770") titles.Add(Title(hwnd));
            return true;
        }, IntPtr.Zero);
        return titles.ToArray();
    }
}
'@

    function Clear-RecoveryPrompt {
        $recovery = [MarkerFileWorkflowWin32]::FindOwnedDialog($mainWindow, [uint32]$process.Id, 'Marker · 恢复草稿')
        if ($recovery -eq [IntPtr]::Zero) { return }
        if (-not [MarkerFileWorkflowWin32]::ClickDialogButton($recovery, $mainWindow, [uint32]$process.Id, 'Marker · 恢复草稿', 2, '取消')) {
            throw 'Found Marker recovery prompt but could not validate its Cancel button; the user draft was left untouched.'
        }
        $result.recoveryPromptPreserved = $true
    }

    function Find-RawElement($node, [scriptblock]$predicate) {
        try { if (& $predicate $node) { return $node } } catch { }
        $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
        try { $child = $walker.GetFirstChild($node) } catch { return $null }
        while ($child) {
            $found = Find-RawElement $child $predicate
            if ($found) { return $found }
            try { $child = $walker.GetNextSibling($child) } catch { return $null }
        }
        return $null
    }
    function Find-DocumentStatus {
        $tree = [System.Windows.Automation.AutomationElement]::FromHandle($mainWindow)
        Find-RawElement $tree { param($item) $item.Current.AutomationId -eq 'DocumentStatus' }
    }
    function Get-StatusDiagnostics {
        $document = '<unavailable>'; $bridge = '<unavailable>'
        try { $item = Find-DocumentStatus; if ($item) { $document = $item.Current.Name } } catch { }
        try {
            $tree = [System.Windows.Automation.AutomationElement]::FromHandle($mainWindow)
            $item = Find-RawElement $tree { param($node) $node.Current.AutomationId -eq 'BridgeStatus' }
            if ($item) { $bridge = $item.Current.Name }
        } catch { }
        $ownedTitles = @([MarkerFileWorkflowWin32]::GetOwnedDialogTitles($mainWindow, [uint32]$process.Id))
        $dialogText = if ($ownedTitles.Count) { $ownedTitles -join ' | ' } else { '<none>' }
        "DocumentStatus='$document'; BridgeStatus='$bridge'; OwnedDialogs='$dialogText'"
    }
    function Wait-DocumentStatus([scriptblock]$predicate, [string]$description, [int]$timeoutMs = 12000) {
        $until = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
        do {
            Clear-RecoveryPrompt
            $item = Find-DocumentStatus
            if ($item -and (& $predicate $item.Current.Name)) { return $item.Current.Name }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $until)
        throw "Timed out waiting for document status: $description. $(Get-StatusDiagnostics)"
    }
    function Wait-BridgeReady([int]$timeoutMs = 15000) {
        $until = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
        do {
            Clear-RecoveryPrompt
            $tree = [System.Windows.Automation.AutomationElement]::FromHandle($mainWindow)
            $status = Find-RawElement $tree { param($item) $item.Current.AutomationId -eq 'BridgeStatus' -and $item.Current.Name -match '^预览已同步 · v[0-9]+' }
            if ($status) { return $status.Current.Name }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $until)
        throw 'Timed out waiting for the Marker editor/preview handshake.'
    }
    function Invoke-OwnedDialogButton([string]$title, [uint32]$buttonId, [string]$buttonText, [int]$timeoutMs = 10000) {
        $until = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
        do {
            $dialog = [MarkerFileWorkflowWin32]::FindOwnedDialog($mainWindow, [uint32]$process.Id, $title)
            if ($dialog -ne [IntPtr]::Zero) {
                if (-not [MarkerFileWorkflowWin32]::ClickDialogButton($dialog, $mainWindow, [uint32]$process.Id, $title, $buttonId, $buttonText)) {
                    throw "Found own '$title' dialog but its exact native button $buttonId could not be validated."
                }
                return
            }
            if ($process.HasExited) { throw "Marker exited while waiting for its '$title' dialog." }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $until)
        throw "Timed out waiting for Marker owned '$title' dialog; the workflow remains failed."
    }
    function Get-OwnedPicker([string[]]$fieldIds, [string]$buttonCaption, [int]$timeoutMs = 15000) {
        $until = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
        do {
            foreach ($candidate in [MarkerFileWorkflowWin32]::FindOwnedWindows($mainWindow, '#32770')) {
                $ownerPid = [uint32]0
                [void][MarkerFileWorkflowWin32]::GetWindowThreadProcessId($candidate, [ref]$ownerPid)
                if (-not [MarkerFileWorkflowWin32]::IsOwnedPicker($candidate, $mainWindow, [uint32]$process.Id)) { continue }
                $field = $null
                $fieldHandle = [IntPtr]::Zero
                $fieldId = $null
                foreach ($fieldId in $fieldIds) {
                    $fieldHandle = [MarkerFileWorkflowWin32]::FindDialogDescendant($candidate, [uint32]$process.Id, [int]$fieldId, 'Edit')
                    if ($fieldHandle -ne [IntPtr]::Zero -and [MarkerFileWorkflowWin32]::IsChild($candidate, $fieldHandle) -and
                        [MarkerFileWorkflowWin32]::GetAncestor($fieldHandle, 2) -eq $candidate) {
                        $field = [System.Windows.Automation.AutomationElement]::FromHandle($fieldHandle)
                        if ($field.Current.AutomationId -eq $fieldId) { break }
                        $field = $null; $fieldHandle = [IntPtr]::Zero
                    }
                }
                $button = [MarkerFileWorkflowWin32]::GetDlgItem($candidate, 1)
                if ($field -and [MarkerFileWorkflowWin32]::IsPickerButton($candidate, $button, $buttonCaption)) {
                    $result.pickerPid = $ownerPid
                    $result.pickerClass = [MarkerFileWorkflowWin32]::ClassName($candidate)
                    $result.pickerFieldAutomationId = $field.Current.AutomationId
                    $result.pickerOwnerRoot = ('0x{0:X}' -f $mainWindow.ToInt64())
                    return @{ Handle = $candidate; FieldHandle = $fieldHandle; Field = $field; FieldId = [int]$fieldId; Button = $button; ButtonCaption = $buttonCaption; ProcessId = $ownerPid }
                }
            }
            if ($process.HasExited) { throw 'Marker exited while waiting for its owned file picker.' }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $until)
        throw "Timed out waiting for Marker-owned #32770 picker with filename Edit and '$buttonCaption' button."
    }
    function Assert-PickerInputTarget($picker) {
        $dialogPid = [uint32]0; $fieldPid = [uint32]0
        [void][MarkerFileWorkflowWin32]::GetWindowThreadProcessId($picker.Handle, [ref]$dialogPid)
        [void][MarkerFileWorkflowWin32]::GetWindowThreadProcessId($picker.FieldHandle, [ref]$fieldPid)
        if ([MarkerFileWorkflowWin32]::GetForegroundWindow() -ne $picker.Handle -or
            -not [MarkerFileWorkflowWin32]::IsOwnedPicker($picker.Handle, $mainWindow, [uint32]$process.Id) -or
            $dialogPid -ne $picker.ProcessId -or $fieldPid -ne $picker.ProcessId -or
            -not [MarkerFileWorkflowWin32]::IsChild($picker.Handle, $picker.FieldHandle) -or
            [MarkerFileWorkflowWin32]::GetAncestor($picker.FieldHandle, 2) -ne $picker.Handle -or
            [MarkerFileWorkflowWin32]::GetDlgCtrlID($picker.FieldHandle) -ne $picker.FieldId -or
            $picker.Field.Current.AutomationId -ne [string]$picker.FieldId) {
            throw 'The picker lost foreground or the validated filename Edit identity changed during input.'
        }
    }
    function Click-PickerControl($picker, [IntPtr]$control, [bool]$mayClosePicker = $false) {
        Assert-PickerInputTarget $picker
        if ($control -ne $picker.FieldHandle -and $control -ne $picker.Button) { throw 'Refused to click a control outside the validated picker Edit and action button.' }
        if ($control -eq $picker.Button -and -not [MarkerFileWorkflowWin32]::IsPickerButton($picker.Handle, $control, $picker.ButtonCaption)) {
            throw 'The picker action button changed before the mouse click.'
        }
        $rect = [MarkerFileWorkflowWin32+Rect]::new()
        if (-not [MarkerFileWorkflowWin32]::GetWindowRect($control, [ref]$rect)) { throw 'Could not read the validated picker control bounds.' }
        $x = [int](($rect.Left + $rect.Right) / 2); $y = [int](($rect.Top + $rect.Bottom) / 2)
        if (-not [MarkerFileWorkflowWin32]::SetCursorPos($x, $y)) { throw 'Could not move the pointer to the validated picker control.' }
        Assert-PickerInputTarget $picker
        [MarkerFileWorkflowWin32]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
        [MarkerFileWorkflowWin32]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
        if (-not $mayClosePicker) { Assert-PickerInputTarget $picker }
    }
    function Set-PickerPath($picker, [string]$path) {
        if (-not [MarkerFileWorkflowWin32]::IsOwnedPicker($picker.Handle, $mainWindow, [uint32]$process.Id) -or
            -not [MarkerFileWorkflowWin32]::IsChild($picker.Handle, $picker.FieldHandle) -or
            [MarkerFileWorkflowWin32]::GetAncestor($picker.FieldHandle, 2) -ne $picker.Handle -or
            [MarkerFileWorkflowWin32]::GetDlgCtrlID($picker.FieldHandle) -ne $picker.FieldId -or
            $picker.Field.Current.AutomationId -ne [string]$picker.FieldId) {
            throw 'The filename Edit is no longer the validated child of this Marker-owned picker.'
        }
        if (-not [MarkerFileWorkflowWin32]::SetForegroundWindow($picker.Handle) -and
            [MarkerFileWorkflowWin32]::GetForegroundWindow() -ne $picker.Handle) { throw 'Could not activate the validated file picker.' }
        Assert-PickerInputTarget $picker
        Click-PickerControl $picker $picker.FieldHandle
        Assert-PickerInputTarget $picker
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        Assert-PickerInputTarget $picker
        if (-not [MarkerFileWorkflowWin32]::SendUnicodeText($picker.FieldHandle, $path)) { throw 'Could not send the path characters to the validated filename Edit.' }
        Start-Sleep -Milliseconds 200
        Assert-PickerInputTarget $picker
        [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
        Start-Sleep -Milliseconds 100
        Assert-PickerInputTarget $picker
        # GetWindowText only reads captions across processes; ask the verified Edit directly for WM_GETTEXT.
        $fieldText = [Text.StringBuilder]::new([Math]::Max(512, $path.Length + 1))
        $readLengthResult = [MarkerFileWorkflowWin32]::ReadWindowTextMessage($picker.FieldHandle, 0x000D, [IntPtr]$fieldText.Capacity, $fieldText)
        $readLength = $readLengthResult.ToInt64()
        if ($readLength -ne $path.Length -or $fieldText.ToString() -cne $path) {
            throw ("Filename Edit path mismatch: expected=[{0}] actual=[{1}] readLength={2}." -f $path, $fieldText.ToString(), $readLength)
        }
        Start-Sleep -Milliseconds 100
        $button = $picker.Button
        $pickerPid = [uint32]0
        [void][MarkerFileWorkflowWin32]::GetWindowThreadProcessId($picker.Handle, [ref]$pickerPid)
        if (-not [MarkerFileWorkflowWin32]::IsOwnedPicker($picker.Handle, $mainWindow, [uint32]$process.Id) -or
            $pickerPid -ne $picker.ProcessId -or [MarkerFileWorkflowWin32]::ClassName($picker.Handle) -ne $result.pickerClass -or
            -not [MarkerFileWorkflowWin32]::IsChild($picker.Handle, $picker.FieldHandle) -or
            [MarkerFileWorkflowWin32]::GetAncestor($picker.FieldHandle, 2) -ne $picker.Handle -or
            [MarkerFileWorkflowWin32]::GetDlgCtrlID($picker.FieldHandle) -ne $picker.FieldId -or
            -not [MarkerFileWorkflowWin32]::IsPickerButton($picker.Handle, $button, $picker.ButtonCaption)) {
            throw 'The file picker owner or native OK button changed before selection.'
        }
        Click-PickerControl $picker $button $true
        $result.pickerValidated = $true
    }
    function Invoke-FilePicker([string]$automationId, [string]$path) {
        $tree = [System.Windows.Automation.AutomationElement]::FromHandle($mainWindow)
        $button = Find-RawElement $tree { param($item) $item.Current.AutomationId -eq $automationId }
        if (-not $button) { throw "Marker toolbar button '$automationId' was not found." }
        $invoke = $null
        if (-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { throw "Marker toolbar button '$automationId' has no InvokePattern." }
        ([System.Windows.Automation.InvokePattern]$invoke).Invoke()
        $fieldIds = if ($automationId -eq 'OpenDocument') { @('1148') } else { @('1001', '1148') }
        $buttonCaption = if ($automationId -eq 'OpenDocument') { '打开' } else { '保存' }
        $picker = Get-OwnedPicker $fieldIds $buttonCaption
        Set-PickerPath $picker $path
    }
    function Focus-Editor {
        Clear-RecoveryPrompt
        if (-not [MarkerFileWorkflowWin32]::SetForegroundWindow($mainWindow)) { throw 'Windows refused to focus this Marker window.' }
        Start-Sleep -Milliseconds 150
        if ([MarkerFileWorkflowWin32]::GetForegroundWindow() -ne $mainWindow) { throw 'Foreground is not the Marker process started by this test.' }
        $editor = [MarkerFileWorkflowWin32]::FindChildByTitle($mainWindow, 'Marker editor')
        if ($editor -eq [IntPtr]::Zero) { throw 'Marker editor native child window was not found.' }
        $rect = [MarkerFileWorkflowWin32+Rect]::new()
        if (-not [MarkerFileWorkflowWin32]::GetWindowRect($editor, [ref]$rect)) { throw 'Could not locate the native editor bounds.' }
        $x = [int](($rect.Left + $rect.Right) / 2); $y = [int](($rect.Top + $rect.Bottom) / 2)
        if (-not [MarkerFileWorkflowWin32]::SetCursorPos($x, $y) -or [MarkerFileWorkflowWin32]::GetForegroundWindow() -ne $mainWindow) { throw 'Editor click safety check failed.' }
        [MarkerFileWorkflowWin32]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
        [MarkerFileWorkflowWin32]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 150
    }
    function Assert-BomCrLf([string]$path, [string[]]$requiredText) {
        $bytes = [IO.File]::ReadAllBytes($path)
        if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) { throw "UTF-8 BOM was not preserved in '$path'." }
        $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes, 3, $bytes.Length - 3)
        if ($text -match '(?<!\r)\n' -or $text -notmatch '\r\n') { throw "CRLF format was not preserved in '$path'." }
        foreach ($required in $requiredText) { if (-not $text.Contains($required, [StringComparison]::Ordinal)) { throw "Expected text '$required' was not saved in '$path'." } }
        $text
    }
    function Wait-FileText([string]$path, [string[]]$requiredText, [int]$timeoutMs = 12000) {
        $until = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
        do {
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                try {
                    $bytes = [IO.File]::ReadAllBytes($path)
                    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
                        $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes, 3, $bytes.Length - 3)
                        if (($requiredText | Where-Object { -not $text.Contains($_, [StringComparison]::Ordinal) }).Count -eq 0) { return }
                    }
                } catch { }
            }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $until)
        throw "Timed out waiting for expected saved content in '$path'. $(Get-StatusDiagnostics)"
    }
    function Wait-BrowserInput([string]$stage, [string]$marker) {
        $donePath = Join-Path $fixtureRoot ("browser-input-{0}.done" -f $stage)
        $requestPath = Join-Path $artifactRoot 'm2-browser-input.json'
        $request = [ordered]@{ stage = $stage; marker = $marker; pid = $process.Id; root = ('0x{0:X}' -f $mainWindow.ToInt64()); fixture = $fixtureRoot; done = $donePath }
        $request | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $requestPath -Encoding UTF8
        $until = [DateTime]::UtcNow.AddSeconds(60)
        do {
            if (Test-Path -LiteralPath $donePath -PathType Leaf) { return }
            $process.Refresh()
            if ($process.HasExited) { throw "Marker exited while waiting for browser input stage '$stage'." }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $until)
        throw "Timed out waiting for browser input stage '$stage' signal '$donePath'. $(Get-StatusDiagnostics)"
    }

    if ($keepProcessOpen) {
        $previousWebViewArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1'
        try { $process = Start-Process -FilePath $exe -PassThru }
        finally {
            if ($null -eq $previousWebViewArgs) { Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue }
            else { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousWebViewArgs }
        }
    } else { $process = Start-Process -FilePath $exe -PassThru }
    $result.processId = $process.Id
    $until = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $process.Refresh()
        if ($process.HasExited) { throw "Marker exited during startup with code $($process.ExitCode)." }
        if ($process.MainWindowHandle -ne [IntPtr]::Zero -and $process.MainWindowTitle -eq 'Marker') { $mainWindow = $process.MainWindowHandle; break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $until)
    if ($mainWindow -eq [IntPtr]::Zero) { throw 'The Marker root window with its initial clean title was not found.' }
    $rootProcessId = [uint32]0
    [void][MarkerFileWorkflowWin32]::GetWindowThreadProcessId($mainWindow, [ref]$rootProcessId)
    if ($rootProcessId -ne [uint32]$process.Id -or [IO.Path]::GetFullPath($process.Path) -ne [IO.Path]::GetFullPath($exe)) {
        throw 'Marker root HWND does not belong to the exact executable process started by this test.'
    }
    $result.rootProcessId = $rootProcessId
    $result.rootWindowHandle = ('0x{0:X}' -f $mainWindow.ToInt64())
    $result.rootWindowTitle = [MarkerFileWorkflowWin32]::Title($mainWindow)

    for ($attempt = 0; $attempt -lt 20; $attempt++) { Clear-RecoveryPrompt; Start-Sleep -Milliseconds 100 }
    $null = Wait-DocumentStatus { param($name) $name -match '^未命名' } 'initial untitled document'
    $result.initialBridgeStatus = Wait-BridgeReady

    Invoke-FilePicker 'OpenDocument' $documentPath
    $openedStatus = Wait-DocumentStatus { param($name) $name.StartsWith('note.md', [StringComparison]::Ordinal) -and $name -match 'BOM' -and $name -match 'CRLF' } 'opened UTF-8 BOM CRLF note.md'
    $result.opened = $true
    $result.openStatus = $openedStatus
    $result.openBridgeStatus = Wait-BridgeReady
    if ($StopAfterOpen) {
        $result.preparedOnly = $true
        $result.passed = $true
        $result.keptOpen = $true
        $result.cdpEndpoint = 'http://127.0.0.1:9222'
        return
    }

    Focus-Editor
    $marker = 'M2_SAVE_' + [guid]::NewGuid().ToString('N')
    $result.editMarker = $marker
    Clear-RecoveryPrompt
    if ($BrowserInput) { Wait-BrowserInput 'initial' $marker }
    else { [System.Windows.Forms.SendKeys]::SendWait("^{END}{ENTER}${marker}^s") }
    Wait-FileText $documentPath @($marker)
    $savedText = Assert-BomCrLf $documentPath @('# M2', '![Pixel](assets/pixel.png)', '![Blocked](../outside.png)', $marker)
    $result.savedTextLength = $savedText.Length
    $null = Wait-DocumentStatus { param($name) $name -match '^note\.md' -and $name -notmatch '未保存' } 'immediate Ctrl+S completion'
    $result.savedImmediately = $true

    $externalText = "# M2 外部版本`r`n"
    $externalBytes = $utf8Bom + [Text.UTF8Encoding]::new($false).GetBytes($externalText)
    [IO.File]::WriteAllBytes($documentPath, $externalBytes)
    $result.externalFingerprint = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($externalBytes))
    Focus-Editor
    Clear-RecoveryPrompt
    [System.Windows.Forms.SendKeys]::SendWait('^s')
    Invoke-OwnedDialogButton 'Marker · 文件冲突' 2 '取消'
    $result.conflictCancelled = $true
    $afterConflict = [IO.File]::ReadAllBytes($documentPath)
    $result.externalUnchanged = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($afterConflict)) -eq $result.externalFingerprint
    if (-not $result.externalUnchanged) { throw 'The external version changed after cancelling the file-conflict prompt.' }
    $dirtyStatus = Wait-DocumentStatus { param($name) $name -match '^note\.md' -and $name -match '未保存' } 'preserved unsaved editor after conflict cancel'
    $result.conflictStatus = $dirtyStatus
    Focus-Editor
    $afterCancelMarker = 'M2_AFTER_CANCEL_' + [guid]::NewGuid().ToString('N')
    $result.afterCancelMarker = $afterCancelMarker
    Clear-RecoveryPrompt
    if ($BrowserInput) { Wait-BrowserInput 'afterCancel' $afterCancelMarker }
    else { [System.Windows.Forms.SendKeys]::SendWait("^{END}{ENTER}${afterCancelMarker}") }

    Invoke-FilePicker 'SaveAsDocument' $copyPath
    $copyStatus = Wait-DocumentStatus { param($name) $name.StartsWith('fixturecopy.md', [StringComparison]::Ordinal) -and $name -notmatch '未保存' } 'same-directory fixturecopy.md save-as'
    $result.copyStatus = $copyStatus
    Wait-FileText $copyPath @($marker, $afterCancelMarker)
    $copyText = Assert-BomCrLf $copyPath @('# M2', '![Pixel](assets/pixel.png)', '![Blocked](../outside.png)', $marker, $afterCancelMarker)
    $result.copyTextLength = $copyText.Length
    $result.editRetained = $copyText.Contains($marker, [StringComparison]::Ordinal) -and $copyText.Contains($afterCancelMarker, [StringComparison]::Ordinal)
    $result.sameImageRoot = [IO.Path]::GetDirectoryName($documentPath) -eq [IO.Path]::GetDirectoryName($copyPath)
    $result.savedAsCopy = $true
    if (-not $result.externalUnchanged) { throw 'Save As changed the externally modified source file.' }

    if ($keepProcessOpen) {
        $result.cdpEndpoint = 'http://127.0.0.1:9222'
        $result.keptOpen = $true
    } else {
        if (-not [MarkerFileWorkflowWin32]::PostMessage($mainWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Could not post WM_CLOSE to the Marker window started by this test.' }
        for ($attempt = 0; $attempt -lt 100; $attempt++) {
            $dirty = [MarkerFileWorkflowWin32]::FindOwnedDialog($mainWindow, [uint32]$process.Id, 'Marker · 未保存的修改')
            if ($dirty -ne [IntPtr]::Zero) {
                if (-not [MarkerFileWorkflowWin32]::ClickDialogButton($dirty, $mainWindow, [uint32]$process.Id, 'Marker · 未保存的修改', 7, '否')) { throw 'Could not validate the No button on this Marker process dirty-close prompt.' }
                $result.dirtyCloseNoClicked = $true
            }
            if ($process.WaitForExit(100)) { break }
        }
        if (-not $process.HasExited) { throw 'Marker did not exit after the normal close request.' }
        $result.closed = $true
    }
    $result.passed = $true
} catch {
    $result.error = $_.Exception.Message
    throw
} finally {
    $result.fixtureCopyExists = Test-Path -LiteralPath $copyPath -PathType Leaf
    if ($process -and -not ($keepProcessOpen -and $result.passed)) {
        try {
            $process.Refresh()
            if (-not $process.HasExited) {
                if ($mainWindow -ne [IntPtr]::Zero) {
                    [void][MarkerFileWorkflowWin32]::PostMessage($mainWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
                    for ($attempt = 0; $attempt -lt 30; $attempt++) {
                        $recovery = [MarkerFileWorkflowWin32]::FindOwnedDialog($mainWindow, [uint32]$process.Id, 'Marker · 恢复草稿')
                        if ($recovery -ne [IntPtr]::Zero) { [void][MarkerFileWorkflowWin32]::ClickDialogButton($recovery, $mainWindow, [uint32]$process.Id, 'Marker · 恢复草稿', 2, '取消') }
                        $dirty = [MarkerFileWorkflowWin32]::FindOwnedDialog($mainWindow, [uint32]$process.Id, 'Marker · 未保存的修改')
                        if ($dirty -ne [IntPtr]::Zero) { [void][MarkerFileWorkflowWin32]::ClickDialogButton($dirty, $mainWindow, [uint32]$process.Id, 'Marker · 未保存的修改', 7, '否') }
                        if ($process.WaitForExit(100)) { break }
                    }
                }
                if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $process.WaitForExit() }
            }
        } finally { $result.keptOpen = $false }
    }
    if ($fixtureCreated -and -not ($keepProcessOpen -and $result.passed)) {
        $artifactsFull = [IO.Path]::GetFullPath($artifactRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        $fixtureFull = [IO.Path]::GetFullPath($fixtureRoot)
        if ($fixtureFull.StartsWith($artifactsFull, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $fixtureFull -Leaf) -match '^m2-workflow-[0-9a-f]{32}$') {
            Remove-Item -LiteralPath $fixtureFull -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding UTF8
}
