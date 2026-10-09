namespace Marker.App;

internal static class MarkdownLinkResolver
{
    private static readonly HashSet<string> DangerousExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".com", ".bat", ".cmd", ".ps1", ".psm1", ".psd1", ".vbs", ".vbe", ".js", ".jse",
        ".wsf", ".wsh", ".hta", ".msi", ".msp", ".msix", ".msixbundle", ".appx", ".appxbundle",
        ".appinstaller", ".scr", ".cpl", ".msc", ".reg", ".lnk", ".url", ".dll", ".sys", ".ocx", ".pif", ".scf",
        ".jar", ".application", ".appref-ms", ".py", ".pyw", ".pyc", ".rb", ".pl", ".pm", ".php",
        ".sh", ".bash", ".command", ".fish", ".lua", ".tcl", ".ahk", ".au3"
    };

    internal static bool IsDangerousExtension(string path) => DangerousExtensions.Contains(Path.GetExtension(path));

    internal static bool TryResolveLocalPath(string target, string? documentPath, out string fullPath)
    {
        fullPath = "";
        if (string.IsNullOrWhiteSpace(target) || target.Length > 2048 || target.Any(char.IsControl)) return false;

        string path;
        if (IsDrivePath(target))
        {
            path = Uri.UnescapeDataString(target.Split(['?', '#'], 2)[0]);
        }
        else if (Uri.TryCreate(target, UriKind.Absolute, out var uri))
        {
            if (uri.Scheme != Uri.UriSchemeFile || uri.IsUnc || !string.IsNullOrEmpty(uri.Host) && !uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return false;
            path = uri.LocalPath;
        }
        else
        {
            var decoded = Uri.UnescapeDataString(target.Split(['?', '#'], 2)[0]);
            if (decoded.StartsWith('\\') || decoded.StartsWith('/')) return false;
            if (IsDrivePath(decoded)) path = decoded;
            else
            {
                if (documentPath is null) return false;
                var baseDirectory = Path.GetDirectoryName(documentPath);
                if (baseDirectory is null) return false;
                path = Path.Combine(baseDirectory, decoded.Replace('/', Path.DirectorySeparatorChar));
            }
        }

        try
        {
            path = Path.GetFullPath(path);
            var root = Path.GetPathRoot(path);
            if (root is null || !IsDrivePath(root) || path.StartsWith("\\\\", StringComparison.Ordinal) ||
                path.StartsWith("\\\\?\\", StringComparison.Ordinal) || path.StartsWith("\\\\.\\", StringComparison.Ordinal) ||
                path.IndexOf(':', 2) >= 0) return false;
            DocumentFile.RejectReparsePath(path, includeTarget: true);
            fullPath = path;
            return true;
        }
        catch (Exception error) when (error is ArgumentException or IOException or NotSupportedException or UriFormatException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static bool IsDrivePath(string path) => path.Length >= 3 && char.IsAsciiLetter(path[0]) && path[1] == ':' && path[2] is '\\' or '/';
}
