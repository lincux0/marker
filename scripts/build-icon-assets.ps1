param(
    [string]$SourcePath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'asserts/icon.png'),
    [string]$AssetsPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'src/Marker.App/Assets'),
    # The source uses a full-canvas gradient, so background-color detection cannot
    # identify the document mark. Rectangle is x, y, width, height in source pixels.
    [int[]]$CropRectangle = @(361, 355, 534, 534)
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
        # Apply one antialiased alpha mask before resizing so every PNG and ICO
        # frame has real transparent corners rather than CSS-only rounding.
        $mask = [System.Drawing.Bitmap]::new($cropWidth, $cropHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $roundedCrop = [System.Drawing.Bitmap]::new($cropWidth, $cropHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $radius = [Math]::Round($cropWidth * 0.18)
            $diameter = $radius * 2
            $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
            try {
                $path.AddArc(0.5, 0.5, $diameter, $diameter, 180, 90)
                $path.AddArc($cropWidth - $diameter - 0.5, 0.5, $diameter, $diameter, 270, 90)
                $path.AddArc($cropWidth - $diameter - 0.5, $cropHeight - $diameter - 0.5, $diameter, $diameter, 0, 90)
                $path.AddArc(0.5, $cropHeight - $diameter - 0.5, $diameter, $diameter, 90, 90)
                $path.CloseFigure()

                $maskGraphics = [System.Drawing.Graphics]::FromImage($mask)
                try {
                    $maskGraphics.Clear([System.Drawing.Color]::Transparent)
                    $maskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
                    $maskGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                    $maskGraphics.FillPath([System.Drawing.Brushes]::White, $path)
                }
                finally { $maskGraphics.Dispose() }

                for ($y = 0; $y -lt $cropHeight; $y++) {
                    for ($x = 0; $x -lt $cropWidth; $x++) {
                        $sourcePixel = $crop.GetPixel($x, $y)
                        $maskAlpha = $mask.GetPixel($x, $y).A
                        $alpha = [int][Math]::Round($sourcePixel.A * $maskAlpha / 255.0)
                        $roundedCrop.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $sourcePixel.R, $sourcePixel.G, $sourcePixel.B))
                    }
                }
            }
            finally { $path.Dispose() }
        }
        finally {
            $mask.Dispose()
        }

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
                Set-TransparentCorners $output
                Assert-RoundedCorners $output
                $output.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
            }
            finally { $output.Dispose() }
        }

        function Set-TransparentCorners([System.Drawing.Bitmap]$Image) {
            $transparent = [System.Drawing.Color]::Transparent
            $Image.SetPixel(0, 0, $transparent)
            $Image.SetPixel($Image.Width - 1, 0, $transparent)
            $Image.SetPixel(0, $Image.Height - 1, $transparent)
            $Image.SetPixel($Image.Width - 1, $Image.Height - 1, $transparent)
        }

        function Assert-RoundedCorners([System.Drawing.Bitmap]$Image) {
            if ($Image.GetPixel([int]($Image.Width / 2), [int]($Image.Height / 2)).A -ne 255 -or
                ($Image.Width -ge 32 -and $Image.GetPixel(1, 1).A -gt 64)) {
                throw "Rounded-corner mask is missing or the icon center is transparent."
            }
            $cornerPoints = @(
                [System.Drawing.Point]::new(0, 0),
                [System.Drawing.Point]::new($Image.Width - 1, 0),
                [System.Drawing.Point]::new(0, $Image.Height - 1),
                [System.Drawing.Point]::new($Image.Width - 1, $Image.Height - 1)
            )
            foreach ($point in $cornerPoints) {
                $alpha = $Image.GetPixel($point.X, $point.Y).A
                if ($alpha -ne 0) {
                    throw "Rounded-corner check failed for $($Image.Width)x$($Image.Height) image at ($($point.X),$($point.Y)): alpha=$alpha."
                }
            }
        }

        Save-PngSize $roundedCrop (Join-Path $assetsPath 'AppLogo.png') 256 256
        Save-PngSize $roundedCrop (Join-Path $assetsPath 'Square44x44Logo.png') 44 44
        Save-PngSize $roundedCrop (Join-Path $assetsPath 'Square150x150Logo.png') 150 150
        Save-PngSize $roundedCrop (Join-Path $assetsPath 'StoreLogo.png') 50 50

        $wide = [System.Drawing.Bitmap]::new(310, 150, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($wide)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($roundedCrop, [System.Drawing.Rectangle]::new(80, 0, 150, 150))
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
                    $graphics.DrawImage($roundedCrop, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
                }
                finally { $graphics.Dispose() }
                Set-TransparentCorners $frame
                Assert-RoundedCorners $frame
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
    finally { $roundedCrop.Dispose(); $crop.Dispose() }

    $webPublicPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'src/Marker.Web/public'
    New-Item -ItemType Directory -Path $webPublicPath -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $assetsPath 'AppLogo.png') -Destination (Join-Path $webPublicPath 'app-logo.png')

    Write-Output "Source: $sourcePath ($($source.Width)x$($source.Height))"
    Write-Output "CropRectangle: x=$cropX..$($cropX + $cropWidth - 1), y=$cropY..$($cropY + $cropHeight - 1), $cropWidth x $cropHeight"
    Write-Output 'Estimated document-mark occupancy: 60.0% width x 74.9% height (source bounds x=468..788, y=423..823).'
    Write-Output "Rounded-corner alpha mask: radius=$([Math]::Round($cropWidth * 0.18)) source px (18% of crop edge)."
    Write-Output "Generated AppLogo.png, Store/Square/Wide MSIX PNGs and Marker.ico (16, 24, 32, 48, 64, 128, 256 px)."
}
finally { $source.Dispose() }
