[CmdletBinding()]
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = ([xml](Get-Content -Raw (Join-Path $root 'src\Marker.App\Package.appxmanifest'))).Package.Identity.Version
if ($version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "Unexpected package version: $version" }

$publishDir = Join-Path $root 'src\Marker.App\bin\x64\Release\net10.0-windows10.0.26100.0\win-x64'
$appExe = Join-Path $publishDir 'Marker.App.exe'
if (-not $SkipBuild) {
    & (Join-Path $root 'scripts\build.ps1')
    if ($LASTEXITCODE -ne 0) { throw "Release build failed with exit code $LASTEXITCODE" }
}
if (-not (Test-Path -LiteralPath $appExe)) { throw "Release output not found: $appExe" }
foreach ($file in 'LICENSE', 'THIRD_PARTY_NOTICES.md') {
    if (-not (Test-Path -LiteralPath (Join-Path $root $file))) { throw "Required installer notice missing: $file" }
}

$compilerVersion = '6.7.3'
$compilerSha256 = '9C73C3BAE7ED48D44112A0F48E66742C00090BDB5BEF71D9D3C056C66E97B732'
$compilerUrl = 'https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe'
$compilerRoot = Join-Path $root ".tools\innosetup-$compilerVersion"
$compiler = Join-Path $compilerRoot 'ISCC.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $installer = Join-Path $root ".tools\innosetup-$compilerVersion.exe"
    if (-not (Test-Path -LiteralPath $installer)) { Invoke-WebRequest -Uri $compilerUrl -OutFile $installer }
    $actualHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
    if ($actualHash -ne $compilerSha256) { throw "Inno Setup $compilerVersion SHA-256 mismatch: $actualHash" }
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike 'CN=Pyrsys B.V.*') {
        throw 'The Inno Setup installer does not have the expected valid Pyrsys B.V. signature.'
    }
    New-Item -ItemType Directory -Path $compilerRoot -Force | Out-Null
    $process = Start-Process -FilePath $installer -WindowStyle Hidden -ArgumentList @('/PORTABLE=1', '/CURRENTUSER', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', '/SP-', "/DIR=$compilerRoot") -Wait -PassThru
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $compiler)) {
        throw "Could not install the pinned Inno Setup compiler (exit $($process.ExitCode)). Install Inno Setup $compilerVersion and retry."
    }
}

$outputDir = Join-Path $root 'artifacts\setup'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$iss = Join-Path $root 'installer\Marker.iss'
& $compiler "/DAppVersion=$version" "/DSourceDir=$publishDir" "/DOutputDir=$outputDir" $iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed with exit code $LASTEXITCODE" }

$package = Join-Path $outputDir "Marker-Setup-$version-x64.exe"
if (-not (Test-Path -LiteralPath $package)) { throw "Setup output not found: $package" }
$hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$package.sha256" -Value "$hash  $(Split-Path $package -Leaf)" -Encoding ascii
Write-Output "Setup: $package"
Write-Output "SHA-256: $hash"
