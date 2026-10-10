using System.Security.Cryptography;
using System.Text;

namespace Marker.App;

public sealed record DocumentFileFormat(string EncodingName, bool HasBom, string Newline)
{
    public static DocumentFileFormat Default { get; } = new("utf-8", false, "LF");
}

public sealed record DocumentFileData(
    string Text,
    string? Path,
    string EncodingName,
    bool HasBom,
    string Newline,
    string Fingerprint)
{
    public DocumentFileFormat Format => new(EncodingName, HasBom, Newline);
}

public sealed class DocumentConflictException : IOException
{
    public string? PreservedExternalCopyPath { get; }

    public DocumentConflictException(string message, string? preservedExternalCopyPath = null, Exception? innerException = null)
        : base(message, innerException) => PreservedExternalCopyPath = preservedExternalCopyPath;
}

public static class DocumentFile
{
    public const int MaxReadBytes = 8 * 1024 * 1024;
    private static readonly byte[] Utf8Bom = [0xEF, 0xBB, 0xBF];
    private static readonly byte[] Utf16LeBom = [0xFF, 0xFE];
    private static readonly byte[] Utf16BeBom = [0xFE, 0xFF];

    public static DocumentFileData New(string? path = null) => new(string.Empty, path, "utf-8", false, "LF", Fingerprint([]));

    internal static string ReadFingerprint(string path)
    {
        var fullPath = ValidatePath(path);
        RejectReparsePath(fullPath, includeTarget: true);
        return Fingerprint(ReadBounded(fullPath));
    }

    public static DocumentFileData Read(string path, string? encodingName = null)
    {
        var fullPath = ValidatePath(path);
        RejectReparsePath(fullPath, includeTarget: true);
        var bytes = ReadBounded(fullPath);
        var offset = 0;
        Encoding encoding;
        var hasBom = false;
        string canonicalName;

        if (StartsWith(bytes, Utf8Bom))
        {
            encoding = StrictEncoding(new UTF8Encoding(false));
            canonicalName = "utf-8";
            offset = Utf8Bom.Length;
            hasBom = true;
        }
        else if (StartsWith(bytes, Utf16LeBom))
        {
            encoding = StrictEncoding(new UnicodeEncoding(false, false));
            canonicalName = "utf-16le";
            offset = Utf16LeBom.Length;
            hasBom = true;
        }
        else if (StartsWith(bytes, Utf16BeBom))
        {
            encoding = StrictEncoding(new UnicodeEncoding(true, false));
            canonicalName = "utf-16be";
            offset = Utf16BeBom.Length;
            hasBom = true;
        }
        else if (encodingName is not null)
        {
            encoding = GetStrictEncoding(encodingName);
            canonicalName = CanonicalEncodingName(encoding);
        }
        else
        {
            encoding = StrictEncoding(new UTF8Encoding(false));
            canonicalName = "utf-8";
        }

        string text;
        try
        {
            text = encoding.GetString(bytes, offset, bytes.Length - offset);
        }
        catch (DecoderFallbackException ex)
        {
            throw new InvalidDataException("文件不是有效的 UTF-8/UTF-16 文本。请明确选择文件编码；简体中文旧文件可尝试 GB18030。", ex);
        }

        var newline = DetectNewline(text);
        return new DocumentFileData(ToLf(text), fullPath, canonicalName, hasBom, newline, Fingerprint(bytes));
    }

    public static DocumentFileData Save(string path, string text, DocumentFileFormat format, string? expectedFingerprint)
    {
        ArgumentNullException.ThrowIfNull(text);
        ArgumentNullException.ThrowIfNull(format);
        var fullPath = ValidatePath(path);
        var directory = Path.GetDirectoryName(fullPath) ?? throw new IOException("目标文件没有有效的父目录。");
        RejectReparsePath(fullPath, includeTarget: false);
        Directory.CreateDirectory(directory);
        RejectReparsePath(fullPath, includeTarget: true);
        ValidateFormat(format);

        var exists = File.Exists(fullPath);
        if (exists && expectedFingerprint is null)
            throw new DocumentConflictException("目标文件已存在，必须先读取并确认当前版本后才能覆盖。");
        if (!exists && expectedFingerprint is not null)
            throw new DocumentConflictException("目标文件已被删除或移动；请另存为或重新载入后再保存。");

        var tempPath = Path.Combine(directory, $".{Path.GetFileName(fullPath)}.{Guid.NewGuid():N}.tmp");
        var backupPath = exists ? Path.Combine(directory, $".{Path.GetFileName(fullPath)}.{Guid.NewGuid():N}.external") : null;
        FileStream? targetGuard = null;
        FileStream? savedGuard = null;
        try
        {
            if (exists)
            {
                var attributes = File.GetAttributes(fullPath);
                if ((attributes & FileAttributes.ReadOnly) != 0)
                    throw new IOException("目标文件为只读文件。");
                targetGuard = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
                if (!FixedTimeEquals(Fingerprint(targetGuard), expectedFingerprint!))
                    throw new DocumentConflictException("磁盘文件已被外部修改，未覆盖该版本。");
            }

            var bytes = Encode(ToLf(text), format);
            if (bytes.Length > MaxReadBytes)
                throw new InvalidDataException($"保存内容超过 {MaxReadBytes / (1024 * 1024)} MiB。");
            using (var stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }

            RejectReparsePath(fullPath, includeTarget: true);
            if (!exists)
            {
                try { File.Move(tempPath, fullPath); }
                catch (IOException ex) when (File.Exists(fullPath))
                {
                    throw new DocumentConflictException("保存期间其他程序创建了目标文件，未覆盖该文件。", innerException: ex);
                }
            }
            else
            {
                if (!File.Exists(fullPath))
                    throw new DocumentConflictException("磁盘文件在保存期间被删除；未创建替代文件。");
                if (targetGuard is null || !FixedTimeEquals(Fingerprint(targetGuard), expectedFingerprint!))
                    throw new DocumentConflictException("磁盘文件在保存期间已被外部修改，未覆盖该版本。");

                File.Replace(tempPath, fullPath, backupPath, ignoreMetadataErrors: true);
                savedGuard = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read);
                var replacedFingerprint = FingerprintPath(backupPath!);
                if (!FixedTimeEquals(replacedFingerprint, expectedFingerprint!))
                {
                    throw new DocumentConflictException(
                        $"保存时检测到并发修改。被替换的外部版本已保存在：{backupPath}", backupPath);
                }
            }

            savedGuard ??= new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read);
            RejectReparsePath(fullPath, includeTarget: true);
            var savedFingerprint = Fingerprint(savedGuard);
            if (!FixedTimeEquals(savedFingerprint, Fingerprint(bytes)))
                throw new DocumentConflictException("写入后目标文件与本次保存内容不一致；未将文档标记为已保存。", backupPath);
            if (backupPath is not null) TryDelete(backupPath);
            return new DocumentFileData(ToLf(text), fullPath, CanonicalFormatName(format.EncodingName), format.HasBom,
                format.Newline, savedFingerprint);
        }
        finally
        {
            savedGuard?.Dispose();
            targetGuard?.Dispose();
            TryDelete(tempPath);
        }
    }

    internal static string ValidatePath(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        return Path.GetFullPath(path);
    }

    internal static void RejectReparsePath(string fullPath, bool includeTarget)
    {
        var current = Path.GetPathRoot(fullPath) ?? throw new IOException("无法确定路径根目录。");
        var relative = Path.GetRelativePath(current, fullPath);
        var parts = relative.Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries);
        var count = includeTarget ? parts.Length : Math.Max(0, parts.Length - 1);
        for (var i = 0; i < count; i++)
        {
            current = Path.Combine(current, parts[i]);
            if (File.Exists(current) || Directory.Exists(current))
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException($"不支持通过符号链接或重解析点访问文件：{current}");
            }
        }
    }

    internal static string ToLf(string text) => text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');

    internal static string DetectNewline(string text)
    {
        var lf = 0;
        var crlf = 0;
        var cr = 0;
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] == '\r')
            {
                if (i + 1 < text.Length && text[i + 1] == '\n') { crlf++; i++; }
                else cr++;
            }
            else if (text[i] == '\n') lf++;
        }
        var styles = (lf > 0 ? 1 : 0) + (crlf > 0 ? 1 : 0) + (cr > 0 ? 1 : 0);
        return styles > 1 ? "Mixed" : crlf > 0 ? "CRLF" : cr > 0 ? "CR" : "LF";
    }

    internal static string Fingerprint(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));

    private static string Fingerprint(Stream stream)
    {
        stream.Position = 0;
        return Convert.ToHexString(SHA256.HashData(stream));
    }

    private static string FingerprintPath(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Fingerprint(stream);
    }

    private static byte[] ReadBounded(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > MaxReadBytes)
            throw new InvalidDataException($"文件超过 {MaxReadBytes / (1024 * 1024)} MiB，暂不支持打开。");
        var bytes = new byte[checked((int)stream.Length)];
        stream.ReadExactly(bytes);
        return bytes;
    }

    internal static bool FixedTimeEquals(string left, string right)
    {
        try { return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(left), Convert.FromHexString(right)); }
        catch (FormatException) { return false; }
    }

    private static bool StartsWith(byte[] bytes, byte[] prefix) => bytes.AsSpan().StartsWith(prefix);

    private static Encoding StrictEncoding(Encoding encoding) => Encoding.GetEncoding(encoding.CodePage, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);

    private static Encoding GetStrictEncoding(string name)
    {
        try
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            return Encoding.GetEncoding(name, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);
        }
        catch (ArgumentException ex)
        {
            throw new InvalidDataException($"不支持编码“{name}”。请明确选择 UTF-8、UTF-16 或 GB18030。", ex);
        }
    }

    private static string CanonicalEncodingName(Encoding encoding) => encoding.CodePage switch
    {
        65001 => "utf-8",
        1200 => "utf-16le",
        1201 => "utf-16be",
        54936 => "gb18030",
        _ => encoding.WebName.ToLowerInvariant()
    };

    private static string CanonicalFormatName(string name) => CanonicalEncodingName(GetStrictEncoding(name));

    private static void ValidateFormat(DocumentFileFormat format)
    {
        if (format.Newline is not ("LF" or "CRLF" or "CR"))
            throw new InvalidOperationException("混合换行文件必须先由用户明确选择 LF、CRLF 或 CR 后才能保存。");
        _ = GetStrictEncoding(format.EncodingName);
    }

    private static byte[] Encode(string lfText, DocumentFileFormat format)
    {
        var newlineText = format.Newline switch { "CRLF" => lfText.Replace("\n", "\r\n", StringComparison.Ordinal), "CR" => lfText.Replace('\n', '\r'), _ => lfText };
        var encoding = GetStrictEncoding(format.EncodingName);
        var payload = encoding.GetBytes(newlineText);
        var bom = format.HasBom ? encoding.CodePage switch
        {
            65001 => Utf8Bom,
            1200 => Utf16LeBom,
            1201 => Utf16BeBom,
            _ => throw new InvalidOperationException($"编码 {format.EncodingName} 不支持 BOM。")
        } : [];
        return [.. bom, .. payload];
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
