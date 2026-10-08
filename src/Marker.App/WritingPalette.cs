using Windows.UI;

namespace Marker.App;

// Native writing chrome uses the same background/accent values as the Web editor.
internal static class WritingPalette
{
    internal static (Color Background, Color Accent) GetColors(string palette, bool dark)
    {
        var (background, accent) = (palette, dark) switch
        {
            ("forest", false) => (0xEDF3EEu, 0x3D7656u),
            ("forest", true) => (0x17211Bu, 0x9AC9A8u),
            ("ocean", false) => (0xEDF3F7u, 0x347493u),
            ("ocean", true) => (0x172027u, 0x8EC9DFu),
            ("paper", false) => (0xF4F0E7u, 0x986D38u),
            ("paper", true) => (0x28231Bu, 0xE3BD80u),
            ("graphite", false) => (0xEEF0F1u, 0x596B79u),
            ("graphite", true) => (0x1B1F22u, 0xB1C3CEu),
            (_, true) => (0x1B1A20u, 0xB6A5DFu),
            _ => (0xF2F0F7u, 0x7665A8u)
        };
        return (FromRgb(background), FromRgb(accent));
    }

    private static Color FromRgb(uint rgb) => Color.FromArgb(255, (byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb);
}
