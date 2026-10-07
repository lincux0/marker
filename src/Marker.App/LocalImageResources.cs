using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
using System.Text;

namespace Marker.App;

internal sealed class LocalImageResources
{
    private const long MaxImageBytes = 16 * 1024 * 1024;
    private const int MaxRegistrations = 8192;
    private readonly object _gate = new();
    private readonly Dictionary<string, string> _urlsByPath = new(PathComparer);
    private readonly Dictionary<string, ImageEntry> _entriesByUrl = new(StringComparer.Ordinal);
    private string? _root;
    private string? _sessionId;
    private long _generation;

    public void SetRoot(string? directory, string sessionId)
    {
        ArgumentNullException.ThrowIfNull(sessionId);
        if (sessionId.Length != 32 || sessionId.Any(character => character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')))
            throw new ArgumentException("会话标识必须是 32 位小写十六进制字符串。", nameof(sessionId));
        lock (_gate)
        {
            _generation++;
            _root = null;
            _sessionId = sessionId;
            _urlsByPath.Clear();
            _entriesByUrl.Clear();
            if (string.IsNullOrWhiteSpace(directory)) return;

            try
            {
                var root = Path.GetFullPath(directory);
                if (!Directory.Exists(root) || HasReparsePoint(root, includeAncestors: true)) return;
                _root = Path.TrimEndingDirectorySeparator(root);
            }
            catch (Exception exception) when (exception is ArgumentException or IOException or UnauthorizedAccessException or NotSupportedException or SecurityException)
            {
                _root = null;
            }
        }
    }

    public string? Resolve(string markdownImageUrl)
        => Resolve(markdownImageUrl, null, null);

    public Func<string, string?> CreateResolver(string sessionId)
    {
        lock (_gate)
        {
            var generation = _generation;
            return imageUrl => Resolve(imageUrl, sessionId, generation);
        }
    }

    private string? Resolve(string markdownImageUrl, string? expectedSessionId, long? expectedGeneration)
    {
        if (string.IsNullOrWhiteSpace(markdownImageUrl)) return null;
        lock (_gate)
        {
            if (_root is null || _sessionId is null
                || expectedSessionId is not null && expectedSessionId != _sessionId
                || expectedGeneration is not null && expectedGeneration != _generation) return null;
            try
            {
                if (!TryResolvePath(markdownImageUrl, out var path, out var relativePath)) return null;
                if (!TryGetMime(relativePath, out var mime)) return null;
                if (HasReparsePoint(path, _root) || !IsInsideRoot(_root, path)) return null;
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                if (stream.Length is <= 0 or > MaxImageBytes || !HasValidSignature(stream, mime)) return null;
                if (!TryGetOpenedFilePath(stream.SafeFileHandle, path, out var actualPath) || !IsInsideRoot(_root, actualPath)) return null;

                if (_urlsByPath.TryGetValue(relativePath, out var existingUrl)) return existingUrl;
                if (_entriesByUrl.Count >= MaxRegistrations) return null;
                var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
                var url = $"https://document.marker.example/{_sessionId}/image/{token}";
                _urlsByPath.Add(relativePath, url);
                _entriesByUrl.Add(url, new ImageEntry(path, mime));
                return url;
            }
            catch (Exception exception) when (exception is ArgumentException or IOException or UnauthorizedAccessException or NotSupportedException or System.Security.SecurityException)
            {
                return null;
            }
        }
    }

    public bool TryRead(string url, out byte[] bytes, out string mime)
    {
        bytes = [];
        mime = string.Empty;
        lock (_gate)
        {
            if (_root is null || !_entriesByUrl.TryGetValue(url, out var entry)) return false;
            try
            {
                if (HasReparsePoint(entry.Path, _root) || !IsInsideRoot(_root, entry.Path)) return false;
                using var stream = new FileStream(entry.Path, FileMode.Open, FileAccess.Read, FileShare.Read);
                if (stream.Length is <= 0 or > MaxImageBytes || stream.Length > int.MaxValue) return false;
                if (!TryGetOpenedFilePath(stream.SafeFileHandle, entry.Path, out var actualPath) || !IsInsideRoot(_root, actualPath)) return false;
                var content = new byte[(int)stream.Length];
                stream.ReadExactly(content);
                if (!HasValidSignature(content, entry.Mime)) return false;
                bytes = content;
                mime = entry.Mime;
                return true;
            }
            catch (Exception exception) when (exception is ArgumentException or IOException or UnauthorizedAccessException or NotSupportedException or System.Security.SecurityException)
            {
                return false;
            }
        }
    }

    private bool TryResolvePath(string reference, out string path, out string relativePath)
    {
        path = string.Empty;
        relativePath = string.Empty;
        if (reference.Contains('?') || reference.Contains('#') || reference.Contains('\\') || reference.Contains('\0')) return false;

        string decoded;
        try
        {
            decoded = reference;
            for (var i = 0; i < 8; i++)
            {
                var next = Uri.UnescapeDataString(decoded);
                if (next == decoded) break;
                decoded = next;
                if (i == 7 && decoded.Contains('%')) return false;
            }
        }
        catch (UriFormatException)
        {
            return false;
        }

        if (decoded.Length == 0 || decoded[0] == '/' || decoded[0] == '\\'
            || decoded.Contains('\\') || decoded.Contains(':') || decoded.Contains('?') || decoded.Contains('#')
            || Path.IsPathRooted(decoded)) return false;
        while (decoded.StartsWith("./", StringComparison.Ordinal)) decoded = decoded[2..];
        if (decoded.Length == 0) return false;
        var segments = decoded.Split('/');
        if (segments.Any(segment => segment.Length == 0 || segment is "." or "..")) return false;

        var root = _root!;
        relativePath = Path.Combine(segments);
        path = Path.GetFullPath(Path.Combine(root, relativePath));
        return IsInsideRoot(root, path);
    }

    private static bool TryGetMime(string relativePath, out string mime)
    {
        var extension = Path.GetExtension(relativePath);
        mime = extension.ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".bmp" => "image/bmp",
            _ => string.Empty
        };
        return mime.Length > 0;
    }

    private static bool HasValidSignature(Stream stream, string mime)
    {
        Span<byte> header = stackalloc byte[12];
        var count = stream.Read(header);
        return SignatureMatches(header[..count], mime);
    }

    private static bool HasValidSignature(ReadOnlySpan<byte> bytes, string mime) => SignatureMatches(bytes, mime);

    private static bool SignatureMatches(ReadOnlySpan<byte> data, string mime) => mime switch
    {
        "image/png" => data.Length >= 8 && data[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
        "image/jpeg" => data.Length >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff,
        "image/gif" => data.Length >= 6 && (data[..6].SequenceEqual("GIF87a"u8) || data[..6].SequenceEqual("GIF89a"u8)),
        "image/webp" => data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data[8..12].SequenceEqual("WEBP"u8),
        "image/bmp" => data.Length >= 2 && data[..2].SequenceEqual("BM"u8),
        _ => false
    };

    private static bool IsInsideRoot(string root, string path)
    {
        var relative = Path.GetRelativePath(root, path);
        return !Path.IsPathRooted(relative) && relative != ".."
            && !relative.StartsWith(".." + Path.DirectorySeparatorChar, PathComparison)
            && !relative.StartsWith(".." + Path.AltDirectorySeparatorChar, PathComparison);
    }

    private static bool HasReparsePoint(string path, bool includeAncestors)
    {
        var current = Path.GetFullPath(path);
        while (true)
        {
            if (File.Exists(current) || Directory.Exists(current))
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return true;
            }
            else
            {
                return true;
            }

            var parent = Path.GetDirectoryName(current);
            if (parent is null || parent == current) return false;
            if (!includeAncestors) return false;
            current = parent;
        }
    }

    private static bool HasReparsePoint(string path, string root)
    {
        var current = Path.GetFullPath(path);
        var canonicalRoot = Path.GetFullPath(root);
        while (!PathComparer.Equals(current, canonicalRoot))
        {
            if (!File.Exists(current) && !Directory.Exists(current)) return true;
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return true;
            var parent = Path.GetDirectoryName(current);
            if (parent is null || parent == current || !IsInsideRoot(canonicalRoot, parent)) return true;
            current = parent;
        }
        return false;
    }

    private static bool TryGetOpenedFilePath(Microsoft.Win32.SafeHandles.SafeFileHandle handle, string fallback, out string path)
    {
        if (!OperatingSystem.IsWindows())
        {
            path = Path.GetFullPath(fallback);
            return true;
        }
        var buffer = new StringBuilder(1024);
        var length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0 || length >= buffer.Capacity)
        {
            path = string.Empty;
            return false;
        }
        var value = buffer.ToString();
        if (value.StartsWith("\\\\?\\UNC\\", StringComparison.OrdinalIgnoreCase))
            value = "\\\\" + value[8..];
        else if (value.StartsWith("\\\\?\\", StringComparison.OrdinalIgnoreCase))
            value = value[4..];
        path = Path.GetFullPath(value);
        return true;
    }

    private static StringComparison PathComparison => OperatingSystem.IsWindows()
        ? StringComparison.OrdinalIgnoreCase
        : StringComparison.Ordinal;

    private static readonly StringComparer PathComparer = OperatingSystem.IsWindows()
        ? StringComparer.OrdinalIgnoreCase
        : StringComparer.Ordinal;

    private sealed record ImageEntry(string Path, string Mime);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(Microsoft.Win32.SafeHandles.SafeFileHandle file, StringBuilder path, uint length, uint flags);
}
