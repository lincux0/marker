[CmdletBinding()]
param([switch]$UpdateLockfile, [switch]$Package)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$localSdk = Join-Path $root '.tools\dotnet\dotnet.exe'
$dotnet = if (Test-Path $localSdk) { $localSdk } else { (Get-Command dotnet -ErrorAction Stop).Source }
$env:DOTNET_ROOT = Split-Path $dotnet
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_CLI_HOME = Join-Path $root '.tools\dotnet-home'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:NUGET_PACKAGES = Join-Path $root '.tools\nuget'
$env:NUGET_HTTP_CACHE_PATH = Join-Path $root '.tools\nuget-http'
$env:npm_config_cache = Join-Path $root '.tools\npm-cache'
function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}
Push-Location $root
try {
    Invoke-Checked $dotnet @('--version')
    Push-Location (Join-Path $root 'src\Marker.Web')
    try {
        Invoke-Checked 'npm.cmd' @('ci')
        Invoke-Checked 'node' @((Join-Path $root 'scripts\update-web-licenses.mjs'))
        Invoke-Checked 'npm.cmd' @('run', 'check')
        Invoke-Checked 'npm.cmd' @('run', 'build')
    } finally { Pop-Location }
    $restoreArgs = @('restore', 'Marker.sln', '-p:Platform=x64')
    if (-not $UpdateLockfile) { $restoreArgs += '--locked-mode' }
    Invoke-Checked $dotnet $restoreArgs
    Invoke-Checked $dotnet @('build', 'Marker.sln', '-c', 'Release', '-p:Platform=x64', '--no-restore')
    Invoke-Checked $dotnet @('test', 'tests\Marker.Tests\Marker.Tests.csproj', '-c', 'Release', '--no-restore')
    if ($Package) {
        $packageArgs = @('build', 'src\Marker.App\Marker.App.csproj', '-c', 'Release', '-p:Platform=x64', '--no-restore', '-p:GenerateAppxPackageOnBuild=true', '-p:AppxPackageSigningEnabled=false', '-p:AppxBundle=Never', "-p:AppxPackageDir=$root\artifacts\msix\")
        $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
        if (Test-Path $vswhere) {
            $pdbTool = & $vswhere -products '*' -latest -find 'VC\Tools\MSVC\**\bin\Hostx64\x64\mspdbcmf.exe' | Select-Object -First 1
            if ($pdbTool) { $packageArgs += "-p:MsPdbCmfExeFullpath=$pdbTool" }
        }
        Invoke-Checked $dotnet $packageArgs
    }
} finally { Pop-Location }
