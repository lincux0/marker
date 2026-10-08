namespace Marker.App;

internal static class MarkdownActivation
{
    internal static bool TryNormalizePath(string? path, out string fullPath)
    {
        fullPath = "";
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path)) return false;
        try
        {
            var candidate = Path.GetFullPath(path);
            var extension = Path.GetExtension(candidate);
            if (!extension.Equals(".md", StringComparison.OrdinalIgnoreCase)
                && !extension.Equals(".markdown", StringComparison.OrdinalIgnoreCase)) return false;
            fullPath = candidate;
            return true;
        }
        catch (ArgumentException) { return false; }
        catch (NotSupportedException) { return false; }
        catch (PathTooLongException) { return false; }
    }
}
