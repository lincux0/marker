[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$sdkRoot = Join-Path $root '.tools\dotnet'
if (Test-Path (Join-Path $sdkRoot 'dotnet.exe')) {
    & (Join-Path $sdkRoot 'dotnet.exe') --version
    if ($LASTEXITCODE -ne 0) { throw 'The local .NET SDK is unavailable.' }
    return
}
$archive = Join-Path $root '.tools\dotnet-sdk-10.0.401-win-x64.zip'
New-Item -ItemType Directory -Path (Split-Path $archive) -Force | Out-Null
Invoke-WebRequest -Uri 'https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.401/dotnet-sdk-10.0.401-win-x64.zip' -OutFile $archive
$expected = '24b670ad3d923bfcf47df6c3b034152398b42f6dbc388e10d783aee1cfb5e5817d399fc0ae2a12cfa822a55e61d34830ccb15c50ef6efee437ab874bb7c79430'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA512).Hash.ToLowerInvariant() -ne $expected) {
    throw 'The downloaded SDK does not match the Microsoft SHA512 checksum.'
}
Expand-Archive -LiteralPath $archive -DestinationPath $sdkRoot -Force
& (Join-Path $sdkRoot 'dotnet.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'SDK bootstrap failed.' }
