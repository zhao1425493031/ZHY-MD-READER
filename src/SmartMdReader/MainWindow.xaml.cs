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
        Closed += (_, _) => _watcher?.Dispose();
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
        using var doc = JsonDocument.Parse(e.WebMessageAsJson);
        var root = doc.RootElement;

        if (root.ValueKind == JsonValueKind.String && root.GetString() == "drop")
        {
            OpenDroppedFiles(e.AdditionalObjects);
            return;
        }
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var typeProp))
            return;

        switch (typeProp.GetString())
        {
            case "ready":
                _viewerReady = true;
                PostInit();
                RenderCurrent(keepScroll: false);
                break;
            case "open":
                ShowOpenDialog();
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
                if (root.TryGetProperty("theme", out var theme) && theme.GetString() is { } t)
                    _settings.Theme = t;
                if (root.TryGetProperty("toc", out var toc) && toc.ValueKind is JsonValueKind.True or JsonValueKind.False)
                    _settings.ShowToc = toc.GetBoolean();
                if (root.TryGetProperty("language", out var lang) && lang.GetString() is { } l
                    && Loc.Normalize(l) != Loc.Language)
                {
                    ChangeLanguage(Loc.Normalize(l));
                }
                _settings.Language = Loc.Language;
                _settings.Save();
                break;
        }
    }

    private void PostInit() => Post(new
    {
        type = "init",
        theme = _settings.Theme,
        toc = _settings.ShowToc,
        language = Loc.Language,
        languages = Loc.Languages.Select(l => new { code = l.Code, name = l.NativeName }),
        strings = Loc.ViewerStrings(),
    });

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

    private void OpenDroppedFiles(IEnumerable<object> objects)
    {
        var paths = objects.OfType<CoreWebView2File>().Select(f => f.Path).ToList();
        if (paths.Count == 0)
            return;

        NavigateTo(paths[0]);
        foreach (var extra in paths.Skip(1))
            new MainWindow(extra).Show();
    }

    private void ShowOpenDialog()
    {
        var dialog = new OpenFileDialog
        {
            Title = Loc.T("dialog.openTitle"),
            Filter = Loc.T("dialog.filter"),
            Multiselect = true,
        };
        if (_currentPath is not null)
            dialog.InitialDirectory = Path.GetDirectoryName(_currentPath);

        if (dialog.ShowDialog(this) != true)
            return;

        NavigateTo(dialog.FileNames[0]);
        foreach (var extra in dialog.FileNames.Skip(1))
            new MainWindow(extra).Show();
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
        var latest = AppSettings.Load();
        latest.Language = Loc.Language;
        latest.Theme = _settings.Theme;
        latest.ShowToc = _settings.ShowToc;
        latest.Maximized = WindowState == WindowState.Maximized;
        var bounds = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
        if (bounds.Width > 0 && bounds.Height > 0)
        {
            latest.WindowWidth = bounds.Width;
            latest.WindowHeight = bounds.Height;
        }
        latest.Save();
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
