param(
    [string]$SourcePath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'asserts/icon.png'),
    [string]$AssetsPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'src/Marker.App/Assets'),
    # The source uses a full-canvas gradient, so background-color detection cannot
    # identify the document mark. Rectangle is x, y, width, height in source pixels.
    [int[]]$CropRectangle = @(393, 388, 470, 470)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourcePath = (Resolve-Path -LiteralPath $SourcePath).Path
$assetsPath = [System.IO.Path]::GetFullPath($AssetsPath)
if (-not (Test-Path -LiteralPath $assetsPath -PathType Container)) {
    throw "Assets directory does not exist: $assetsPath"
}

$source = [System.Drawing.Bitmap]::FromFile($sourcePath)
try {
    if ($CropRectangle.Count -ne 4) { throw 'CropRectangle must contain x, y, width, height.' }
    $cropX, $cropY, $cropWidth, $cropHeight = $CropRectangle
    if ($cropX -lt 0 -or $cropY -lt 0 -or $cropWidth -le 0 -or $cropHeight -le 0) {
        throw 'CropRectangle coordinates must be non-negative and dimensions must be positive.'
    }
    if ($cropWidth -ne $cropHeight) { throw 'CropRectangle must be square to generate the app icon assets.' }
    if ($cropX + $cropWidth -gt $source.Width -or $cropY + $cropHeight -gt $source.Height) {
        throw "CropRectangle ($($CropRectangle -join ', ')) exceeds source bounds $($source.Width)x$($source.Height)."
    }

    $crop = $source.Clone(
        [System.Drawing.Rectangle]::new($cropX, $cropY, $cropWidth, $cropHeight),
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        function Save-PngSize([System.Drawing.Bitmap]$Image, [string]$Path, [int]$Width, [int]$Height) {
            $output = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            try {
                $graphics = [System.Drawing.Graphics]::FromImage($output)
                try {
                    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                    $graphics.DrawImage($Image, [System.Drawing.Rectangle]::new(0, 0, $Width, $Height))
                }
                finally { $graphics.Dispose() }
                $output.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
            }
            finally { $output.Dispose() }
        }

        Save-PngSize $crop (Join-Path $assetsPath 'AppLogo.png') 256 256
        Save-PngSize $crop (Join-Path $assetsPath 'Square44x44Logo.png') 44 44
        Save-PngSize $crop (Join-Path $assetsPath 'Square150x150Logo.png') 150 150
        Save-PngSize $crop (Join-Path $assetsPath 'StoreLogo.png') 50 50

        $wide = [System.Drawing.Bitmap]::new(310, 150, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($wide)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($crop, [System.Drawing.Rectangle]::new(80, 0, 150, 150))
            }
            finally { $graphics.Dispose() }
            $wide.Save((Join-Path $assetsPath 'Wide310x150Logo.png'), [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally { $wide.Dispose() }

        $iconSizes = @(16, 24, 32, 48, 64, 128, 256)
        $frames = foreach ($size in $iconSizes) {
            $frame = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            try {
                $graphics = [System.Drawing.Graphics]::FromImage($frame)
                try {
                    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                    $graphics.DrawImage($crop, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
                }
                finally { $graphics.Dispose() }
                $stream = [System.IO.MemoryStream]::new()
                try {
                    $frame.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
                    ,@{ Size = $size; Bytes = $stream.ToArray() }
                }
                finally { $stream.Dispose() }
            }
            finally { $frame.Dispose() }
        }

        $icoStream = [System.IO.MemoryStream]::new()
        try {
            $writer = [System.IO.BinaryWriter]::new($icoStream)
            $writer.Write([UInt16]0)
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]$frames.Count)
            $offset = 6 + (16 * $frames.Count)
            foreach ($frame in $frames) {
                $dimensionByte = if ($frame.Size -eq 256) { [byte]0 } else { [byte]$frame.Size }
                $writer.Write($dimensionByte)
                $writer.Write($dimensionByte)
                $writer.Write([byte]0)
                $writer.Write([byte]0)
                $writer.Write([UInt16]1)
                $writer.Write([UInt16]32)
                $writer.Write([UInt32]$frame.Bytes.Length)
                $writer.Write([UInt32]$offset)
                $offset += $frame.Bytes.Length
            }
            foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
            $writer.Flush()
            [System.IO.File]::WriteAllBytes((Join-Path $assetsPath 'Marker.ico'), $icoStream.ToArray())
        }
        finally { $icoStream.Dispose() }
    }
    finally { $crop.Dispose() }

    $webPublicPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'src/Marker.Web/public'
    New-Item -ItemType Directory -Path $webPublicPath -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $assetsPath 'AppLogo.png') -Destination (Join-Path $webPublicPath 'app-logo.png')

    Write-Output "Source: $sourcePath ($($source.Width)x$($source.Height))"
    Write-Output "CropRectangle: x=$cropX..$($cropX + $cropWidth - 1), y=$cropY..$($cropY + $cropHeight - 1), $cropWidth x $cropHeight"
    Write-Output 'Estimated document-mark occupancy: 68.1% width x 85.1% height (source bounds x=468..788, y=423..823).'
    Write-Output "Generated AppLogo.png, Store/Square/Wide MSIX PNGs and Marker.ico (16, 24, 32, 48, 64, 128, 256 px)."
}
finally { $source.Dispose() }
