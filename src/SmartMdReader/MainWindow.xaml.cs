using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace SmartMdReader;

public partial class MainWindow : Window
{
    private const string AppHost = "app.smartmd";
    private const string ViewerUrl = "https://" + AppHost + "/viewer.html";
    private const int MaxReloadRetries = 5;

    private static readonly Dictionary<string, string> MimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".gif"] = "image/gif",
        [".webp"] = "image/webp",
        [".svg"] = "image/svg+xml",
        [".bmp"] = "image/bmp",
        [".ico"] = "image/x-icon",
        [".avif"] = "image/avif",
        [".mp4"] = "video/mp4",
        [".webm"] = "video/webm",
        [".mp3"] = "audio/mpeg",
        [".wav"] = "audio/wav",
        [".ogg"] = "audio/ogg",
    };

    private readonly AppSettings _settings;
    private readonly DispatcherTimer _reloadTimer;
    private readonly Stack<string> _history = new();
    private FileSystemWatcher? _watcher;
    private string? _currentPath;
    private bool _viewerReady;
    private int _reloadRetries;
    private string? _lastLibraryJson;

    public MainWindow(string? path)
    {
        InitializeComponent();

        _settings = AppSettings.Load();
        Width = _settings.WindowWidth;
        Height = _settings.WindowHeight;
        if (_settings.Maximized)
            WindowState = WindowState.Maximized;

        _currentPath = TryGetFullPath(path);

        _reloadTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        _reloadTimer.Tick += (_, _) =>
        {
            _reloadTimer.Stop();
            RenderCurrent(keepScroll: true);
        };

        Loaded += async (_, _) => await InitializeWebViewAsync();
        PreviewKeyDown += OnPreviewKeyDown;
        Closing += (_, _) => SaveWindowState();
        Closed += (_, _) =>
        {
            Library.Changed -= PostLibrary;
            _watcher?.Dispose();
        };

        Library.StartWatching();
        Library.Changed += PostLibrary;
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, AppInfo.WebViewDataDir);
            await WebView.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                Loc.T("app.webview2Missing", "https://developer.microsoft.com/microsoft-edge/webview2/", ex.Message),
                AppInfo.Name, MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
            return;
        }

        var core = WebView.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
#if !DEBUG
        core.Settings.AreDevToolsEnabled = false;
#endif

        core.SetVirtualHostNameToFolderMapping(AppHost, AppInfo.AssetsDir, CoreWebView2HostResourceAccessKind.Deny);
        core.AddWebResourceRequestedFilter(DocUrl.Prefix + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnDocResourceRequested;
        core.NavigationStarting += OnNavigationStarting;
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            HandleLink(e.Uri);
        };
        core.WebMessageReceived += OnWebMessageReceived;

        core.Navigate(ViewerUrl);
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        var ctrl = Keyboard.Modifiers.HasFlag(ModifierKeys.Control);

        if (e.Key == Key.F5 || (ctrl && e.Key == Key.R))
        {
            RenderCurrent(keepScroll: true);
            e.Handled = true;
        }
        else if (ctrl && e.Key == Key.O)
        {
            ShowOpenDialog();
            e.Handled = true;
        }
        else if (ctrl && e.Key == Key.W)
        {
            Close();
            e.Handled = true;
        }
        else if ((e.Key == Key.System && e.SystemKey == Key.Left) || e.Key == Key.BrowserBack)
        {
            GoBack();
            e.Handled = true;
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        using var outer = JsonDocument.Parse(e.WebMessageAsJson);

        // 拖放文件时，消息是 postMessageWithAdditionalObjects 发来的 JSON 字符串
        if (outer.RootElement.ValueKind == JsonValueKind.String)
        {
            using var inner = JsonDocument.Parse(outer.RootElement.GetString() ?? "{}");
            var drop = inner.RootElement;
            if (drop.ValueKind == JsonValueKind.Object && GetString(drop, "type") == "drop")
            {
                var open = !drop.TryGetProperty("open", out var o) || o.ValueKind != JsonValueKind.False;
                OpenDroppedFiles(e.AdditionalObjects, GetString(drop, "folderId"), open);
            }
            return;
        }

        var root = outer.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
            return;

        switch (GetString(root, "type"))
        {
            case "ready":
                _viewerReady = true;
                _lastLibraryJson = null;
                PostInit();
                PostLibrary();
                RenderCurrent(keepScroll: false);
                break;
            case "open":
                ShowOpenDialog();
                break;
            case "openFile":
                if (GetString(root, "path") is { } openPath)
                {
                    if (File.Exists(openPath))
                        NavigateTo(openPath);
                    else
                        Post(new { type = "toast", message = Loc.T("toast.fileNotFound", openPath) });
                }
                break;
            case "addFiles":
                ShowAddFilesDialog(GetString(root, "folderId"));
                break;
            case "lib":
                HandleLibraryOp(root);
                break;
            case "layout":
                SaveLayout(root);
                break;
            case "reload":
                RenderCurrent(keepScroll: true);
                break;
            case "back":
                GoBack();
                break;
            case "reveal":
                if (_currentPath is not null)
                    RevealInExplorer(_currentPath);
                break;
            case "link":
                if (root.TryGetProperty("href", out var href) && href.GetString() is { } url)
                    HandleLink(url);
                break;
            case "settings":
                if (GetString(root, "theme") is { } theme)
                    _settings.Theme = theme;
                if (root.TryGetProperty("toc", out var toc) && toc.ValueKind is JsonValueKind.True or JsonValueKind.False)
                    _settings.ShowToc = toc.GetBoolean();
                if (GetString(root, "language") is { } lang && Loc.Normalize(lang) != Loc.Language)
                    ChangeLanguage(Loc.Normalize(lang));
                _settings.Language = Loc.Language;
                AppSettings.Update(s =>
                {
                    s.Theme = _settings.Theme;
                    s.ShowToc = _settings.ShowToc;
                    s.Language = _settings.Language;
                });
                break;
        }
    }

    private void HandleLibraryOp(JsonElement msg)
    {
        var key = GetString(msg, "key");
        var id = GetString(msg, "id");
        var name = GetString(msg, "name");

        switch (GetString(msg, "op"))
        {
            case "remove" when key is not null:
                Library.Mutate(lib => Library.RemoveFile(lib, key));
                break;
            case "removeMissing":
                Library.Mutate(Library.RemoveMissing);
                break;
            case "newFolder" when id is not null:
                Library.Mutate(lib => Library.NewFolder(lib, id, name ?? Loc.T("ui.files.newFolder")));
                break;
            case "rename" when id is not null && name is not null:
                Library.Mutate(lib => Library.RenameFolder(lib, id, name));
                break;
            case "deleteFolder" when id is not null:
                Library.Mutate(lib => Library.DeleteFolder(lib, id));
                break;
            case "toggle" when id is not null:
                var expanded = msg.TryGetProperty("expanded", out var ex) && ex.ValueKind == JsonValueKind.True;
                Library.Mutate(lib => Library.SetExpanded(lib, id, expanded));
                break;
            case "move" when key is not null:
                var folderId = GetString(msg, "folderId");
                var before = GetString(msg, "before");
                Library.Mutate(lib => Library.Move(lib, key, folderId, before));
                break;
            case "reveal" when key is not null:
                if (File.Exists(key))
                    RevealInExplorer(key);
                else
                    Post(new { type = "toast", message = Loc.T("toast.fileNotFound", key) });
                break;
        }
    }

    private void SaveLayout(JsonElement msg)
    {
        AppSettings.Update(s =>
        {
            if (msg.TryGetProperty("sidebarWidth", out var w) && w.TryGetDouble(out var width))
                s.SidebarWidth = Math.Clamp(width, 160, 800);
            if (msg.TryGetProperty("filesRatio", out var r) && r.TryGetDouble(out var ratio))
                s.FilesPaneRatio = Math.Clamp(ratio, 0.1, 0.9);
            if (msg.TryGetProperty("filesCollapsed", out var fc) && fc.ValueKind is JsonValueKind.True or JsonValueKind.False)
                s.FilesCollapsed = fc.GetBoolean();
            if (msg.TryGetProperty("tocCollapsed", out var tc) && tc.ValueKind is JsonValueKind.True or JsonValueKind.False)
                s.TocCollapsed = tc.GetBoolean();
        });
    }

    private void PostInit()
    {
        var latest = AppSettings.Load();
        Post(new
        {
            type = "init",
            theme = _settings.Theme,
            toc = _settings.ShowToc,
            language = Loc.Language,
            languages = Loc.Languages.Select(l => new { code = l.Code, name = l.NativeName }),
            strings = Loc.ViewerStrings(),
            layout = new
            {
                sidebarWidth = latest.SidebarWidth,
                filesRatio = latest.FilesPaneRatio,
                filesCollapsed = latest.FilesCollapsed,
                tocCollapsed = latest.TocCollapsed,
            },
        });
    }

    private void PostLibrary()
    {
        if (!_viewerReady || WebView.CoreWebView2 is null)
            return;
        var json = JsonSerializer.Serialize(new { type = "library", items = Library.ToView(AppSettings.Load().Library) });
        if (json == _lastLibraryJson)
            return;
        _lastLibraryJson = json;
        WebView.CoreWebView2.PostWebMessageAsJson(json);
    }

    private static string? GetString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static void ChangeLanguage(string language)
    {
        Loc.SetLanguage(language);
        foreach (var window in Application.Current.Windows.OfType<MainWindow>())
            window.ApplyLanguage();
    }

    private void ApplyLanguage()
    {
        _settings.Language = Loc.Language;
        if (!_viewerReady)
            return;
        PostInit();
        RenderCurrent(keepScroll: true);
    }

    /// <summary>拖进来的 Markdown 文件全部加入列表；拖到正文区域时同时打开第一个。</summary>
    private void OpenDroppedFiles(IEnumerable<object> objects, string? folderId, bool open)
    {
        var paths = objects.OfType<CoreWebView2File>()
            .Select(f => TryGetFullPath(f.Path))
            .OfType<string>()
            .Where(p => AppInfo.IsMarkdown(p) && File.Exists(p))
            .ToList();
        if (paths.Count == 0)
            return;

        Library.Mutate(lib => Library.AddFiles(lib, paths, folderId));
        if (open || _currentPath is null)
            NavigateTo(paths[0]);
    }

    private void ShowOpenDialog()
    {
        var paths = PickFiles();
        if (paths.Length == 0)
            return;

        Library.Mutate(lib => Library.AddFiles(lib, paths, null));
        NavigateTo(paths[0]);
    }

    private void ShowAddFilesDialog(string? folderId)
    {
        var paths = PickFiles();
        if (paths.Length == 0)
            return;

        Library.Mutate(lib => Library.AddFiles(lib, paths, folderId));
        if (_currentPath is null)
            NavigateTo(paths[0]);
    }

    private string[] PickFiles()
    {
        var dialog = new OpenFileDialog
        {
            Title = Loc.T("dialog.openTitle"),
            Filter = Loc.T("dialog.filter"),
            Multiselect = true,
        };
        if (_currentPath is not null)
            dialog.InitialDirectory = Path.GetDirectoryName(_currentPath);

        return dialog.ShowDialog(this) == true
            ? dialog.FileNames.Select(TryGetFullPath).OfType<string>().ToArray()
            : [];
    }

    private void NavigateTo(string path, string? fragment = null)
    {
        var full = TryGetFullPath(path);
        if (full is null)
            return;

        if (_currentPath is not null && !PathEquals(_currentPath, full))
            _history.Push(_currentPath);

        _currentPath = full;
        RenderCurrent(keepScroll: false, fragment);
    }

    private void GoBack()
    {
        while (_history.Count > 0)
        {
            var previous = _history.Pop();
            if (!File.Exists(previous))
                continue;
            _currentPath = previous;
            RenderCurrent(keepScroll: false);
            return;
        }
    }

    private void RenderCurrent(bool keepScroll, string? fragment = null)
    {
        if (!_viewerReady)
            return;

        if (_currentPath is null)
        {
            Title = AppInfo.Name;
            Post(new { type = "empty" });
            return;
        }

        var path = _currentPath;
        WatchFile(path);

        string html;
        try
        {
            html = MarkdownRenderer.ToHtml(TextFileReader.Read(path));
            _reloadRetries = 0;
        }
        catch (IOException) when (keepScroll && _reloadRetries < MaxReloadRetries)
        {
            // 编辑器保存时文件可能被短暂锁定或替换，稍后重试
            _reloadRetries++;
            _reloadTimer.Start();
            return;
        }
        catch (Exception ex)
        {
            _reloadRetries = 0;
            Title = $"{Path.GetFileName(path)} - {AppInfo.Name}";
            Post(new { type = "error", path, name = Path.GetFileName(path), message = ex.Message });
            return;
        }

        if (!keepScroll && !Library.Contains(AppSettings.Load().Library, path))
            Library.Mutate(lib => Library.AddFiles(lib, [path], null));

        Title = $"{Path.GetFileName(path)} - {AppInfo.Name}";
        Post(new
        {
            type = "render",
            html,
            path,
            name = Path.GetFileName(path),
            baseHref = DocUrl.FromDirectory(Path.GetDirectoryName(path)!),
            keepScroll,
            fragment,
            canGoBack = _history.Count > 0,
        });
    }

    private void WatchFile(string path)
    {
        var directory = Path.GetDirectoryName(path)!;
        var name = Path.GetFileName(path);
        if (_watcher is not null
            && PathEquals(_watcher.Path, directory)
            && string.Equals(_watcher.Filter, name, StringComparison.OrdinalIgnoreCase))
            return;

        _watcher?.Dispose();
        _watcher = null;
        if (!Directory.Exists(directory))
            return;

        try
        {
            _watcher = new FileSystemWatcher(directory, name)
            {
                NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName | NotifyFilters.CreationTime,
            };
            FileSystemEventHandler onChange = (_, _) => Dispatcher.BeginInvoke(ScheduleReload);
            _watcher.Changed += onChange;
            _watcher.Created += onChange;
            _watcher.Renamed += (_, _) => Dispatcher.BeginInvoke(ScheduleReload);
            _watcher.EnableRaisingEvents = true;
        }
        catch
        {
            _watcher = null;
        }
    }

    private void ScheduleReload()
    {
        _reloadTimer.Stop();
        _reloadTimer.Start();
    }

    private void HandleLink(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            return;

        var local = uri.IsFile ? uri.LocalPath : DocUrl.ToLocalPath(uri);
        if (local is not null)
        {
            var fragment = uri.Fragment.Length > 1 ? Uri.UnescapeDataString(uri.Fragment[1..]) : null;
            if (AppInfo.IsMarkdown(local))
            {
                if (_currentPath is not null && PathEquals(_currentPath, local))
                    Post(new { type = "scroll", fragment });
                else if (File.Exists(local))
                    NavigateTo(local, fragment);
                else
                    Post(new { type = "toast", message = Loc.T("toast.fileNotFound", local) });
            }
            else if (File.Exists(local) || Directory.Exists(local))
            {
                // 非 Markdown 文件只在资源管理器里定位，不直接执行，避免恶意链接启动程序
                RevealInExplorer(local);
            }
            else
            {
                Post(new { type = "toast", message = Loc.T("toast.fileNotFound", local) });
            }
            return;
        }

        if (uri.Scheme is "http" or "https" or "mailto")
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (e.Uri.StartsWith(ViewerUrl, StringComparison.OrdinalIgnoreCase))
            return;
        e.Cancel = true;
        HandleLink(e.Uri);
    }

    private void OnDocResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var env = WebView.CoreWebView2.Environment;
        var path = Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) ? DocUrl.ToLocalPath(uri) : null;

        if (path is null || !MimeTypes.TryGetValue(Path.GetExtension(path), out var mime) || !File.Exists(path))
        {
            e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "");
            return;
        }

        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var ms = new MemoryStream();
            fs.CopyTo(ms);
            ms.Position = 0;
            e.Response = env.CreateWebResourceResponse(ms, 200, "OK", $"Content-Type: {mime}\r\nCache-Control: no-cache");
        }
        catch
        {
            e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "");
        }
    }

    private void Post(object message)
    {
        if (WebView.CoreWebView2 is { } core)
            core.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }

    private void SaveWindowState()
    {
        var maximized = WindowState == WindowState.Maximized;
        var bounds = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
        AppSettings.Update(s =>
        {
            s.Maximized = maximized;
            if (bounds.Width > 0 && bounds.Height > 0)
            {
                s.WindowWidth = bounds.Width;
                s.WindowHeight = bounds.Height;
            }
        });
    }

    private static void RevealInExplorer(string path) =>
        Process.Start("explorer.exe", $"/select,\"{path}\"");

    private static string? TryGetFullPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return null;
        try
        {
            return Path.GetFullPath(path.Trim('"'));
        }
        catch
        {
            return null;
        }
    }

    private static bool PathEquals(string a, string b) =>
        string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
}
