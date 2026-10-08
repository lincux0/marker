namespace Marker.App;

public sealed record WindowPlacement(int Left, int Top, int Width, int Height, bool Maximized)
{
    public bool IsValid => Left is >= -32768 and <= 32767 && Top is >= -32768 and <= 32767
        && Width is >= 320 and <= 16384 && Height is >= 240 and <= 16384;

    public static WindowPlacement ClampToWorkArea(WindowPlacement placement, int workLeft, int workTop,
        int workRight, int workBottom, int minimumWidth, int minimumHeight)
    {
        if (!placement.IsValid || workRight <= workLeft || workBottom <= workTop
            || minimumWidth <= 0 || minimumHeight <= 0)
            throw new ArgumentException("窗口位置或工作区无效。", nameof(placement));

        var width = Math.Min(Math.Max(placement.Width, minimumWidth), workRight - workLeft);
        var height = Math.Min(Math.Max(placement.Height, minimumHeight), workBottom - workTop);
        var left = Math.Clamp(placement.Left, workLeft, Math.Max(workLeft, workRight - width));
        var top = Math.Clamp(placement.Top, workTop, Math.Max(workTop, workBottom - height));
        return placement with { Left = left, Top = top, Width = width, Height = height };
    }
}
