using System.Globalization;
using System.IO;
using System.Text;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace SmartMdReader;

public partial class MainWindow
{
    private bool _exporting;

    // ---------- 新建 / 重命名 ----------

    /// <summary>新建 md 文件：选位置和文件名，加入列表（可指定文件夹），打开并进入分屏编辑。</summary>
    private async void CreateNewFile(string? folderId, string? nearPath)
    {
        var baseDir = nearPath is not null && File.Exists(nearPath) ? Path.GetDirectoryName(nearPath)
            : _currentPath is not null ? Path.GetDirectoryName(_currentPath)
            : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);

        var dialog = new SaveFileDialog
        {
            Title = Loc.T("dialog.newFileTitle"),
            Filter = Loc.T("dialog.filter"),
            FileName = Loc.T("file.untitled") + ".md",
            InitialDirectory = baseDir,
            DefaultExt = ".md",
            AddExtension = true,
            OverwritePrompt = false,
        };
        if (dialog.ShowDialog(this) != true)
            return;

        var path = TryGetFullPath(dialog.FileName);
        if (path is null)
            return;

        try
        {
            // 已存在的文件不覆盖，直接加入列表并打开
            if (!File.Exists(path))
            {
                var title = Path.GetFileNameWithoutExtension(path);
                File.WriteAllText(path, $"# {title}\n\n", new UTF8Encoding(false));
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, Loc.T("toast.createFailed", ex.Message), AppInfo.Name, MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        Library.Mutate(lib => Library.AddFiles(lib, [path], folderId));
        if (!await ConfirmLeaveAsync())
            return;
        NavigateTo(path);
        Post(new { type = "setMode", mode = "split" });
    }

    /// <summary>重命名磁盘上的文件（同一目录内），列表、当前窗口和历史记录跟着更新。</summary>
    private void RenameFile(string oldPath, string newName)
    {
        newName = newName.Trim();
        if (newName.Length == 0 || newName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || newName is "." or "..")
        {
            Post(new { type = "toast", message = Loc.T("toast.renameInvalid", newName) });
            PostLibraryForce();
            return;
        }
        if (!File.Exists(oldPath))
        {
            Post(new { type = "toast", message = Loc.T("toast.fileNotFound", oldPath) });
            return;
        }

        var extension = Path.GetExtension(oldPath);
        if (!AppInfo.IsMarkdown(newName))
            newName += extension;

        var newPath = Path.Combine(Path.GetDirectoryName(oldPath)!, newName);
        if (string.Equals(oldPath, newPath, StringComparison.Ordinal))
            return;

        var caseOnly = string.Equals(oldPath, newPath, StringComparison.OrdinalIgnoreCase);
        if (!caseOnly && (File.Exists(newPath) || Directory.Exists(newPath)))
        {
            Post(new { type = "toast", message = Loc.T("toast.renameExists", newName) });
            PostLibraryForce();
            return;
        }

        try
        {
            foreach (var window in Application.Current.Windows.OfType<MainWindow>())
                window._ignoreChangesUntil = DateTime.UtcNow.AddSeconds(2);
            File.Move(oldPath, newPath);
        }
        catch (Exception ex)
        {
            Post(new { type = "toast", message = Loc.T("toast.renameFailed", ex.Message) });
            PostLibraryForce();
            return;
        }

        Library.Mutate(lib => Library.RenameFile(lib, oldPath, newPath));
        foreach (var window in Application.Current.Windows.OfType<MainWindow>())
            window.OnFileRenamed(oldPath, newPath);
    }

    private void OnFileRenamed(string oldPath, string newPath)
    {
        if (_history.Count > 0)
        {
            var entries = _history.Reverse().Select(p => PathEquals(p, oldPath) ? newPath : p).ToList();
            _history.Clear();
            foreach (var entry in entries)
                _history.Push(entry);
        }

        if (_currentPath is null || !PathEquals(_currentPath, oldPath))
            return;

        _currentPath = newPath;
        WatchFile(newPath);
        UpdateTitle();
        Post(new { type = "renamed", path = newPath, name = Path.GetFileName(newPath) });
    }

    /// <summary>重命名失败时让前端恢复原来的名字。</summary>
    private void PostLibraryForce()
    {
        _lastLibraryJson = null;
        PostLibrary();
    }

    // ---------- 导出 PDF ----------

    private async void ExportPdf()
    {
        if (_exporting || _currentPath is null || WebView.CoreWebView2 is null)
            return;

        var dialog = new SaveFileDialog
        {
            Title = Loc.T("dialog.exportPdfTitle"),
            Filter = Loc.T("dialog.pdfFilter"),
            FileName = Path.GetFileNameWithoutExtension(_currentPath) + ".pdf",
            InitialDirectory = Path.GetDirectoryName(_currentPath),
            DefaultExt = ".pdf",
            AddExtension = true,
        };
        if (dialog.ShowDialog(this) != true)
            return;

        var core = WebView.CoreWebView2;
        _exporting = true;
        try
        {
            // 打印时临时切到浅色主题，等 Mermaid 用浅色重新渲染完
            await core.ExecuteScriptAsync("window.SmartMd && window.SmartMd.beginPrint()");
            for (var i = 0; i < 50; i++)
            {
                var ready = await core.ExecuteScriptAsync("window.SmartMd ? window.SmartMd.printReady() : true");
                if (ready == "true")
                    break;
                await Task.Delay(100);
            }

            var settings = core.Environment.CreatePrintSettings();
            var metric = RegionInfo.CurrentRegion.IsMetric;
            settings.PageWidth = metric ? 8.27 : 8.5;
            settings.PageHeight = metric ? 11.69 : 11;
            settings.MarginTop = settings.MarginBottom = 0.6;
            settings.MarginLeft = settings.MarginRight = 0.6;
            settings.ShouldPrintBackgrounds = true;
            settings.ShouldPrintHeaderAndFooter = true;
            settings.HeaderTitle = Path.GetFileName(_currentPath);
            settings.FooterUri = "";
            settings.Orientation = CoreWebView2PrintOrientation.Portrait;

            var ok = await core.PrintToPdfAsync(dialog.FileName, settings);
            if (!ok)
                throw new IOException(dialog.FileName);

            Post(new { type = "toast", message = Loc.T("toast.exported", Path.GetFileName(dialog.FileName)) });
            RevealInExplorer(dialog.FileName);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, Loc.T("toast.exportFailed", ex.Message), AppInfo.Name, MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            _exporting = false;
            try
            {
                await core.ExecuteScriptAsync("window.SmartMd && window.SmartMd.endPrint()");
            }
            catch
            {
                // 窗口已关闭
            }
        }
    }
}
