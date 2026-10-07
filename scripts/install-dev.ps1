[CmdletBinding()]
param([Parameter(Mandatory)][string]$PackagePath, [switch]$TrustMachine)
$ErrorActionPreference = 'Stop'
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$root = Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($package)
try {
    $entry = $zip.GetEntry('AppxManifest.xml')
    if (-not $entry) { throw 'The package has no AppxManifest.xml.' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($manifest.Package.Identity.Name -ne 'Marker' -or $manifest.Package.Identity.Publisher -ne 'CN=Marker.Dev') {
        throw 'Only the Marker development package can be signed by this script.'
    }
} finally { $zip.Dispose() }
$tools = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin\10.0.26100.0\x64'
$signtool = Join-Path $tools 'signtool.exe'
if (-not (Test-Path $signtool)) { throw 'Windows SDK 10.0.26100.0 signing tools are required.' }
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
    Where-Object { $_.Subject -eq 'CN=Marker.Dev' -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(7) } |
    Sort-Object NotAfter -Descending | Select-Object -First 1
if (-not $cert) {
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=Marker.Dev' -CertStoreLocation Cert:\CurrentUser\My -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(1)
}
$certPath = Join-Path $root 'artifacts\Marker.Dev.cer'
New-Item -ItemType Directory -Path (Split-Path $certPath) -Force | Out-Null
Export-Certificate -Cert $cert -FilePath $certPath | Out-Null
Import-Certificate -FilePath $certPath -CertStoreLocation Cert:\CurrentUser\TrustedPeople | Out-Null
if ($TrustMachine) {
    Import-Certificate -FilePath $certPath -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
} else {
    Write-Warning 'MSIX installation requires this certificate in LocalMachine\TrustedPeople. Signing only; re-run with -TrustMachine in an administrator shell after approving machine-level trust.'
}
& $signtool sign /fd SHA256 /s My /sha1 $cert.Thumbprint $package
if ($LASTEXITCODE -ne 0) { throw 'Development signing failed.' }
if (-not $TrustMachine) { return }
& $signtool verify /pa $package
if ($LASTEXITCODE -ne 0) { throw 'Development signature verification failed.' }
Add-AppxPackage -Path $package
Get-AppxPackage -Name Marker | Where-Object Publisher -eq 'CN=Marker.Dev' | Select-Object Name,Version,PackageFullName,InstallLocation
