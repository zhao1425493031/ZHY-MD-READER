using System.Globalization;
using System.IO;
using System.Text;

namespace SmartMdReader;

/// <summary>读取时识别出的编码、BOM 和换行方式，保存时按原样写回。</summary>
internal sealed record TextFormat(Encoding Encoding, bool HasBom, string NewLine)
{
    public static TextFormat Utf8 { get; } = new(new UTF8Encoding(false), false, "\r\n");
}

internal static class TextFileReader
{
    static TextFileReader() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    public static string Read(string path) => Read(path, out _);

    public static string Read(string path, out TextFormat format)
    {
        byte[] bytes;
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (var ms = new MemoryStream())
        {
            fs.CopyTo(ms);
            bytes = ms.ToArray();
        }

        var text = Decode(bytes, out var encoding, out var hasBom);
        format = new TextFormat(encoding, hasBom, DetectNewLine(text));
        return text;
    }

    /// <summary>
    /// 按原编码保存。先写临时文件再替换，避免写到一半损坏原文件。
    /// 文本含有原编码无法表示的字符时抛出 <see cref="EncoderFallbackException"/>。
    /// </summary>
    public static void Write(string path, string text, TextFormat format)
    {
        var normalized = text.Replace("\r\n", "\n").Replace("\n", format.NewLine);
        var body = format.Encoding.GetBytes(normalized);
        var preamble = format.HasBom ? format.Encoding.GetPreamble() : [];

        var directory = Path.GetDirectoryName(path)!;
        var temp = Path.Combine(directory, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
        try
        {
            using (var fs = new FileStream(temp, FileMode.CreateNew, FileAccess.Write))
            {
                fs.Write(preamble);
                fs.Write(body);
                fs.Flush(flushToDisk: true);
            }

            if (!File.Exists(path))
            {
                File.Move(temp, path);
                return;
            }

            try
            {
                File.Replace(temp, path, null, ignoreMetadataErrors: true);
            }
            catch (IOException)
            {
                // 部分网络盘不支持 Replace，退回到覆盖复制
                File.Copy(temp, path, overwrite: true);
            }
        }
        finally
        {
            if (File.Exists(temp))
                File.Delete(temp);
        }
    }

    private static string Decode(byte[] bytes, out Encoding encoding, out bool hasBom)
    {
        hasBom = true;
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
        {
            encoding = new UTF8Encoding(true);
            return Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
        }
        if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
        {
            encoding = new UnicodeEncoding(false, true);
            return Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2);
        }
        if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF)
        {
            encoding = new UnicodeEncoding(true, true);
            return Encoding.BigEndianUnicode.GetString(bytes, 2, bytes.Length - 2);
        }

        hasBom = false;
        encoding = new UTF8Encoding(false);
        if (TryDecode(new UTF8Encoding(false, true), bytes, out var text))
            return text;

        // 非 UTF-8 的旧文件：依次尝试系统 ANSI 代码页、Shift-JIS、GB18030
        var codePages = new[] { CultureInfo.CurrentCulture.TextInfo.ANSICodePage, 932, 54936 }.Distinct();
        foreach (var cp in codePages)
        {
            var strict = Encoding.GetEncoding(cp, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);
            if (TryDecode(strict, bytes, out text))
            {
                encoding = strict;
                return text;
            }
        }
        return Encoding.UTF8.GetString(bytes);
    }

    private static string DetectNewLine(string text)
    {
        var index = text.IndexOf('\n');
        if (index < 0)
            return "\r\n";
        return index > 0 && text[index - 1] == '\r' ? "\r\n" : "\n";
    }

    private static bool TryDecode(Encoding encoding, byte[] bytes, out string text)
    {
        try
        {
            text = encoding.GetString(bytes);
            return true;
        }
        catch (DecoderFallbackException)
        {
            text = "";
            return false;
        }
    }
}
