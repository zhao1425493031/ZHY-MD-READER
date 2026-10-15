using System.Globalization;
using System.IO;
using System.Text;

namespace ZhyMdReader;

internal static class TextFileReader
{
    static TextFileReader() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    public static string Read(string path)
    {
        byte[] bytes;
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (var ms = new MemoryStream())
        {
            fs.CopyTo(ms);
            bytes = ms.ToArray();
        }
        return Decode(bytes);
    }

    private static string Decode(byte[] bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
            return Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
        if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
            return Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2);
        if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF)
            return Encoding.BigEndianUnicode.GetString(bytes, 2, bytes.Length - 2);

        if (TryDecode(new UTF8Encoding(false, true), bytes, out var text))
            return text;

        // 非 UTF-8 的旧文件：依次尝试系统 ANSI 代码页、Shift-JIS、GB18030
        var codePages = new[] { CultureInfo.CurrentCulture.TextInfo.ANSICodePage, 932, 54936 }.Distinct();
        foreach (var cp in codePages)
        {
            var strict = Encoding.GetEncoding(cp, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);
            if (TryDecode(strict, bytes, out text))
                return text;
        }
        return Encoding.UTF8.GetString(bytes);
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
