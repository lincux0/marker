[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SetupPath,
    [string]$InstallDir = (Join-Path $PSScriptRoot '..\artifacts\association test 中文\Marker'),
    [scriptblock]$InstalledCheck
)

$ErrorActionPreference = 'Stop'
$SetupPath = (Resolve-Path -LiteralPath $SetupPath).Path
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$artifacts = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\artifacts')) + '\'
if (-not $InstallDir.StartsWith($artifacts, [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $InstallDir)) {
    throw 'The isolated install directory must be new and inside this workspace artifacts directory.'
}
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser', 'Registry64')
$appKey = 'Software\Classes\Applications\Marker.App.exe'
$progIdKey = 'Software\Classes\Marker.Markdown'
$uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{D4C8A016-195E-46A9-884B-7B960544F5B3}_is1'
$extensions = @('.md', '.markdown')
$sentinel = 'Marker.AssociationTest.' + [Guid]::NewGuid().ToString('N')

function Read-Values([string]$Path, [string[]]$Exclude = @()) {
    $key = $registry.OpenSubKey($Path)
    try {
        if ($null -eq $key) { return 'null' }
        $values = @($key.GetValueNames() | Sort-Object | Where-Object { $_ -notin $Exclude } | ForEach-Object {
            [ordered]@{ name = $_; kind = $key.GetValueKind($_).ToString(); value = $key.GetValue($_, $null, 'DoNotExpandEnvironmentNames') }
        })
        return ConvertTo-Json -InputObject $values -Depth 8 -Compress
    } finally { if ($null -ne $key) { $key.Dispose() } }
}

function Assert-String([string]$Path, [string]$Name, [string]$Expected) {
    $key = $registry.OpenSubKey($Path)
    try {
        if ($null -eq $key -or $key.GetValueNames() -notcontains $Name -or
            $key.GetValueKind($Name) -ne 'String' -or $key.GetValue($Name) -cne $Expected) {
            throw "Unexpected registry value: $Path [$Name]"
        }
    } finally { if ($null -ne $key) { $key.Dispose() } }
}

# Do not overwrite an existing user installation or another test's association keys.
foreach ($path in @($appKey, $progIdKey, $uninstallKey)) {
    if ((Read-Values $path) -ne 'null') { throw "Existing registration blocks isolated acceptance: $path" }
}
foreach ($extension in $extensions) {
    $key = $registry.OpenSubKey("Software\Classes\$extension\OpenWithProgids")
    try {
        if ($null -ne $key -and $key.GetValueNames() -contains 'Marker.Markdown') { throw "Existing Marker association: $extension" }
    } finally { if ($null -ne $key) { $key.Dispose() } }
}

$before = @{}
$openWithBefore = @{}
$created = @()
$installed = $false
try {
    foreach ($extension in $extensions) {
        $extensionKey = "Software\Classes\$extension"
        $openWith = "$extensionKey\OpenWithProgids"
        $userChoice = "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoice"
        foreach ($path in @($extensionKey, $openWith, $userChoice)) { $before[$path] = Read-Values $path }
        if ($before[$extensionKey] -eq 'null') { $created += $extensionKey }
        if ($before[$openWith] -eq 'null') { $created += $openWith }
        $key = $registry.CreateSubKey($openWith)
        try { $key.SetValue($sentinel, 'preserve-other-program', 'String') } finally { $key.Dispose() }
        $openWithBefore[$openWith] = Read-Values $openWith
    }

    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/NOICONS', '/TASKS=', "/DIR=`"$InstallDir`"")
    $process = Start-Process -FilePath $SetupPath -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    $installed = Test-Path -LiteralPath (Join-Path $InstallDir 'unins000.exe')
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
    $licenseSource = Join-Path (Split-Path $PSScriptRoot -Parent) 'installer\licenses\Markdig.txt'
    $licenseInstalled = Join-Path $InstallDir 'licenses\Markdig.txt'
    if (-not (Test-Path -LiteralPath $licenseInstalled) -or
        (Get-FileHash -LiteralPath $licenseSource).Hash -cne (Get-FileHash -LiteralPath $licenseInstalled).Hash) {
        throw 'The installed Markdig license is missing or differs from the upstream text.'
    }
    $command = '"' + (Join-Path $InstallDir 'Marker.App.exe') + '" "%1"'
    Assert-String $progIdKey '' 'Marker Markdown 文档'
    Assert-String "$progIdKey\DefaultIcon" '' ('"' + (Join-Path $InstallDir 'Marker.App.exe') + '",0')
    Assert-String "$progIdKey\shell\open\command" '' $command
    Assert-String $appKey 'FriendlyAppName' 'Marker'
    Assert-String "$appKey\shell\open\command" '' $command
    foreach ($extension in $extensions) {
        Assert-String "$appKey\SupportedTypes" $extension ''
        Assert-String "Software\Classes\$extension\OpenWithProgids" 'Marker.Markdown' ''
        Assert-String "Software\Classes\$extension\OpenWithProgids" $sentinel 'preserve-other-program'
    }
    foreach ($path in $openWithBefore.Keys) {
        if ((Read-Values $path 'Marker.Markdown') -cne $openWithBefore[$path]) { throw "Other programs' registrations changed during install: $path" }
    }
    foreach ($path in $before.Keys | Where-Object { $_ -notlike '*\OpenWithProgids' }) {
        # A previously absent extension key is now present only to hold OpenWithProgids.
        $expected = $before[$path]
        if ($expected -eq 'null' -and $path -like 'Software\Classes\*') { $expected = '[]' }
        if ((Read-Values $path) -cne $expected) { throw "Default association changed: $path" }
    }
    if ($InstalledCheck) { & $InstalledCheck (Join-Path $InstallDir 'Marker.App.exe') }

    $process = Start-Process -FilePath (Join-Path $InstallDir 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
    $installed = $false
    foreach ($path in @($appKey, $progIdKey, $uninstallKey)) {
        if ((Read-Values $path) -ne 'null') { throw "Registration remains after uninstall: $path" }
    }
    foreach ($extension in $extensions) {
        $path = "Software\Classes\$extension\OpenWithProgids"
        Assert-String $path $sentinel 'preserve-other-program'
        $expected = $before[$path]
        if ($expected -eq 'null') { $expected = '[]' }
        if ((Read-Values $path $sentinel) -cne $expected) { throw "Other programs' registrations changed: $path" }
    }
    foreach ($path in $before.Keys | Where-Object { $_ -notlike '*\OpenWithProgids' }) {
        $expected = $before[$path]
        if ($expected -eq 'null' -and $path -like 'Software\Classes\*') { $expected = '[]' }
        if ((Read-Values $path) -cne $expected) { throw "Default association changed after uninstall: $path" }
    }
    if (Test-Path -LiteralPath $InstallDir) { throw 'Install directory remains after uninstall.' }
    [pscustomobject]@{ passed = $true; installDirectory = $InstallDir; extensions = $extensions; defaultUnchanged = $true; otherProgramsPreserved = $true; uninstalled = $true } | ConvertTo-Json
} finally {
    if ($installed -and (Test-Path -LiteralPath (Join-Path $InstallDir 'unins000.exe'))) {
        Start-Process -FilePath (Join-Path $InstallDir 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -WindowStyle Hidden -Wait | Out-Null
    }
    foreach ($extension in $extensions) {
        $key = $registry.OpenSubKey("Software\Classes\$extension\OpenWithProgids", $true)
        try { if ($null -ne $key) { $key.DeleteValue($sentinel, $false) } } finally { if ($null -ne $key) { $key.Dispose() } }
    }
    # Remove only keys this test created, and only if no values or subkeys remain.
    foreach ($path in $created | Sort-Object Length -Descending) {
        $key = $registry.OpenSubKey($path)
        $empty = $null -ne $key -and $key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0
        if ($null -ne $key) { $key.Dispose() }
        if ($empty) { $registry.DeleteSubKey($path, $false) }
    }
    $registry.Dispose()
}
