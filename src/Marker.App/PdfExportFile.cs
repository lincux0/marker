using System.Security.Cryptography;

namespace Marker.App;

public static class PdfExportFile
{
    public static string Fingerprint(string path)
    {
        DocumentFile.RejectReparsePath(path, includeTarget: true);
        using var file = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(file));
    }

    public static void Save(Stream pdf, string path, string? expectedFingerprint)
    {
        path = Path.GetFullPath(path);
        if (!Path.GetExtension(path).Equals(".pdf", StringComparison.OrdinalIgnoreCase)) throw new IOException("导出目标必须为 PDF。");
        DocumentFile.RejectReparsePath(path, includeTarget: true);
        var temporary = Path.Combine(Path.GetDirectoryName(path)!, $".marker-pdf-{Guid.NewGuid():N}.tmp");
        var backup = path + $".{Guid.NewGuid():N}.external";
        try
        {
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                pdf.CopyTo(file);
                file.Flush(flushToDisk: true);
            }
            DocumentFile.RejectReparsePath(path, includeTarget: true);
            if ((File.Exists(path) ? Fingerprint(path) : null) != expectedFingerprint)
                throw new IOException("导出目标已被其他程序修改，请重新选择文件。");
            if (expectedFingerprint is null) File.Move(temporary, path);
            else
            {
                File.Replace(temporary, path, backup, ignoreMetadataErrors: true);
                if (Fingerprint(backup) != expectedFingerprint)
                    throw new IOException($"导出时检测到并发修改，被替换的外部版本已保存在：{backup}");
                File.Delete(backup);
            }
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
