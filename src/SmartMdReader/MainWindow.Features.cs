using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using Microsoft.Win32;

namespace SmartMdReader;

public partial class MainWindow
{
    private const int MaxImageBytes = 20 * 1024 * 1024;
    private const int MaxSearchResults = 300;
    private const int MaxResultsPerFile = 50;

    private static readonly Dictionary<string, string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/png"] = ".png",
        ["image/jpeg"] = ".jpg",
        ["image/gif"] = ".gif",
        ["image/webp"] = ".webp",
        ["image/bmp"] = ".bmp",
    };

    // ---------- 粘贴图片 ----------

    /// <summary>把编辑器里粘贴的图片存到 md 同目录的 images 文件夹，返回相对路径；失败返回 null。</summary>
    private string? SavePastedImage(JsonElement msg)
    {
        if (_currentPath is null || GetString(msg, "data") is not { } data)
            return null;

        try
        {
            var bytes = Convert.FromBase64String(data);
            if (bytes.Length == 0 || bytes.Length > MaxImageBytes)
                return null;

            var ext = ImageExtensions.GetValueOrDefault(GetString(msg, "mime") ?? "", ".png");
            var docDir = Path.GetDirectoryName(_currentPath)!;
            var imageDir = Path.Combine(docDir, "images");
            Directory.CreateDirectory(imageDir);

            var baseName = Regex.Replace(Path.GetFileNameWithoutExtension(_currentPath), @"[\s#%?\[\]()<>]+", "-");
            var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            var fileName = $"{baseName}-{stamp}{ext}";
            for (var i = 2; File.Exists(Path.Combine(imageDir, fileName)); i++)
                fileName = $"{baseName}-{stamp}-{i}{ext}";

            File.WriteAllBytes(Path.Combine(imageDir, fileName), bytes);
            return "images/" + fileName;
        }
        catch (Exception ex)
        {
            Post(new { type = "toast", message = Loc.T("toast.imageFailed", ex.Message) });
            return null;
        }
    }

    // ---------- 全文搜索 ----------

    private void SearchLibrary(string query, int seq)
    {
        query = query.Trim();
        if (query.Length == 0)
        {
            Post(new { type = "searchResults", seq, query, results = Array.Empty<object>(), truncated = false });
            return;
        }

        var files = LibraryFiles(AppSettings.Load().Library).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        Task.Run(() =>
        {
            var results = new List<object>();
            var truncated = false;
            foreach (var file in files)
            {
                if (results.Count >= MaxSearchResults)
                {
                    truncated = true;
                    break;
                }
                if (!File.Exists(file))
                    continue;

                string[] lines;
                try
                {
                    lines = TextFileReader.Read(file).Split('\n');
                }
                catch
                {
                    continue;
                }

                var inFile = 0;
                for (var i = 0; i < lines.Length && inFile < MaxResultsPerFile && results.Count < MaxSearchResults; i++)
                {
                    var line = lines[i].TrimEnd('\r');
                    var index = line.IndexOf(query, StringComparison.OrdinalIgnoreCase);
                    if (index < 0)
                        continue;
                    results.Add(new { path = file, name = Path.GetFileName(file), line = i, text = Snippet(line, index, query.Length) });
                    inFile++;
                }
            }

            Dispatcher.BeginInvoke(() => Post(new { type = "searchResults", seq, query, results, truncated }));
        });
    }

    private static IEnumerable<string> LibraryFiles(IEnumerable<LibraryItem> items)
    {
        foreach (var item in items)
        {
            if (item.Type == "file" && item.Path is not null)
                yield return item.Path;
            if (item.Items is not null)
            {
                foreach (var path in LibraryFiles(item.Items))
                    yield return path;
            }
        }
    }

    private static string Snippet(string line, int index, int length)
    {
        const int context = 40;
        var start = Math.Max(0, index - context);
        var end = Math.Min(line.Length, index + length + context * 2);
        var text = line[start..end].Trim();
        return (start > 0 ? "…" : "") + text + (end < line.Length ? "…" : "");
    }

    // ---------- 导出 HTML ----------

    private static readonly Regex DocImageSrc = new(
        "(<img\\b[^>]*?\\bsrc=\")(https://" + Regex.Escape(DocUrl.Host) + "/[^\"]+)(\")",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private const string ExportCss = """
        body { margin: 0; background: #fff; }
        .markdown-body { box-sizing: border-box; max-width: 980px; margin: 0 auto; padding: 32px 48px 80px; }
        .markdown-body .katex-html { display: none; }
        .markdown-body div.math { overflow-x: auto; text-align: center; margin: 1em 0; }
        .markdown-body .mermaid { text-align: center; margin: 1em 0; }
        .markdown-body pre.mermaid { background: transparent; white-space: normal; }
        .markdown-body .mermaid svg { max-width: 100%; height: auto; }
        @media print { .markdown-body { max-width: none; padding: 0; } }
        """;

    /// <summary>导出成单个 HTML 文件：内联样式和本地图片，发给没装本程序的人也能看。</summary>
    private void ExportHtml(string html, string title)
    {
        if (_currentPath is null || html.Length == 0)
            return;

        var dialog = new SaveFileDialog
        {
            Title = Loc.T("dialog.exportTitle"),
            Filter = Loc.T("dialog.htmlFilter"),
            FileName = Path.GetFileNameWithoutExtension(_currentPath) + ".html",
            InitialDirectory = Path.GetDirectoryName(_currentPath),
            DefaultExt = ".html",
            AddExtension = true,
        };
        if (dialog.ShowDialog(this) != true)
            return;

        try
        {
            var body = DocImageSrc.Replace(html, m => m.Groups[1].Value + InlineImage(m.Groups[2].Value) + m.Groups[3].Value);
            var css = new StringBuilder();
            foreach (var name in new[] { "github-markdown-light.css", "hljs-light.min.css" })
            {
                var file = Path.Combine(AppInfo.AssetsDir, "vendor", name);
                if (File.Exists(file))
                    css.AppendLine(File.ReadAllText(file));
            }
            css.AppendLine(ExportCss);

            var lang = Loc.Language switch { "zh" => "zh-CN", "ja" => "ja", _ => "en" };
            var document = $"""
                <!DOCTYPE html>
                <html lang="{lang}">
                <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <meta name="generator" content="{AppInfo.Name}">
                <title>{WebUtility.HtmlEncode(title)}</title>
                <style>
                {css}
                </style>
                </head>
                <body>
                <article class="markdown-body">
                {body}
                </article>
                </body>
                </html>
                """;

            File.WriteAllText(dialog.FileName, document, new UTF8Encoding(false));
            Post(new { type = "toast", message = Loc.T("toast.exported", Path.GetFileName(dialog.FileName)) });
            RevealInExplorer(dialog.FileName);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, Loc.T("toast.exportFailed", ex.Message), AppInfo.Name, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private static string InlineImage(string url)
    {
        try
        {
            var uri = new Uri(WebUtility.HtmlDecode(url));
            var path = DocUrl.ToLocalPath(uri);
            if (path is null || !File.Exists(path))
                return url;
            if (!MimeTypes.TryGetValue(Path.GetExtension(path), out var mime) || !mime.StartsWith("image/", StringComparison.Ordinal))
                return url;
            var info = new FileInfo(path);
            if (info.Length > MaxImageBytes)
                return url;
            return $"data:{mime};base64,{Convert.ToBase64String(File.ReadAllBytes(path))}";
        }
        catch
        {
            return url;
        }
    }

    // ---------- 单实例：其他进程转发过来的打开请求 ----------

    /// <summary>另一个进程（比如资源管理器右键打开）把文件交给已经打开的窗口。</summary>
    public void OpenFromOtherInstance(string? path)
    {
        if (WindowState == WindowState.Minimized)
            WindowState = WindowState.Normal;
        Activate();
        Topmost = true;
        Topmost = false;
        Focus();

        var full = TryGetFullPath(path);
        if (full is null || !File.Exists(full))
            return;
        if (_currentPath is not null && PathEquals(_currentPath, full))
        {
            if (!_dirty)
                RenderCurrent(keepScroll: true);
            return;
        }
        if (!_viewerReady)
        {
            _currentPath = full;
            return;
        }
        NavigateGuarded(full);
    }
}
