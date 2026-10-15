using System.IO;

namespace ZhyMdReader;

/// <summary>
/// 把本地路径映射成 https://doc.zhymd/C%3A/dir/file 这样的虚拟 URL，
/// 让 Markdown 里的相对图片路径（包括 ../ 形式）都能被正确解析。
/// </summary>
internal static class DocUrl
{
    public const string Host = "doc.zhymd";
    public const string Prefix = "https://" + Host + "/";

    public static string FromDirectory(string directory)
    {
        var full = Path.GetFullPath(directory).TrimEnd('\\');
        IEnumerable<string> segments = full.StartsWith(@"\\", StringComparison.Ordinal)
            ? new[] { "UNC" }.Concat(full[2..].Split('\\'))
            : full.Split('\\');
        return Prefix + string.Join('/', segments.Select(Uri.EscapeDataString)) + "/";
    }

    public static string? ToLocalPath(Uri uri)
    {
        if (!uri.Host.Equals(Host, StringComparison.OrdinalIgnoreCase))
            return null;

        var segments = uri.AbsolutePath
            .Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(Uri.UnescapeDataString)
            .ToArray();
        if (segments.Length == 0)
            return null;

        var path = segments[0] == "UNC"
            ? @"\\" + string.Join('\\', segments[1..])
            : string.Join('\\', segments);
        if (path.Length == 2 && path[1] == ':')
            path += '\\';

        try
        {
            return Path.GetFullPath(path);
        }
        catch
        {
            return null;
        }
    }
}
