using System.IO;

namespace ZhyMdReader;

internal static class AppInfo
{
    public const string Name = "ZHY MD Reader";

    public static string AssetsDir { get; } = Path.Combine(AppContext.BaseDirectory, "assets");

    public static string DataDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ZhyMdReader");

    public static string WebViewDataDir { get; } = Path.Combine(DataDir, "WebView2");

    public static readonly string[] MarkdownExtensions = [".md", ".markdown", ".mdown", ".mkd", ".mkdn"];

    public static bool IsMarkdown(string path) =>
        MarkdownExtensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase);
}
