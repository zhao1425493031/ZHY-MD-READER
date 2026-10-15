using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace SmartMdReader;

/// <summary>
/// 左侧「文件」列表：根级别可以放文件和文件夹，文件夹只有一层。
/// 所有修改都通过 <see cref="Mutate"/> 写回 settings.json，并通知所有窗口刷新。
/// </summary>
internal static class Library
{
    public static event Action? Changed;

    private static FileSystemWatcher? _watcher;
    private static DispatcherTimer? _debounce;

    public static void StartWatching()
    {
        if (_watcher is not null)
            return;

        _debounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
        _debounce.Tick += (_, _) =>
        {
            _debounce.Stop();
            Changed?.Invoke();
        };

        try
        {
            Directory.CreateDirectory(AppInfo.DataDir);
            _watcher = new FileSystemWatcher(AppInfo.DataDir, Path.GetFileName(AppSettings.FilePath))
            {
                NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size,
            };
            FileSystemEventHandler onChange = (_, _) => Application.Current?.Dispatcher.BeginInvoke(() =>
            {
                _debounce.Stop();
                _debounce.Start();
            });
            _watcher.Changed += onChange;
            _watcher.Created += onChange;
            _watcher.Renamed += (s, e) => onChange(s, e);
            _watcher.EnableRaisingEvents = true;
        }
        catch
        {
            _watcher = null;
        }
    }

    public static void Mutate(Func<List<LibraryItem>, bool> change)
    {
        var changed = false;
        AppSettings.Update(s => changed = change(s.Library));
        if (changed)
            Changed?.Invoke();
    }

    public static bool Contains(List<LibraryItem> root, string path) => FindFile(root, path).Container is not null;

    public static bool AddFiles(List<LibraryItem> root, IEnumerable<string> paths, string? folderId)
    {
        var container = FindFolder(root, folderId)?.Items ?? root;
        var changed = false;
        foreach (var path in paths)
        {
            if (Contains(root, path))
                continue;
            container.Add(new LibraryItem { Type = LibraryItem.FileType, Path = path });
            changed = true;
        }
        return changed;
    }

    public static bool RemoveFile(List<LibraryItem> root, string path)
    {
        var (container, index) = FindFile(root, path);
        if (container is null)
            return false;
        container.RemoveAt(index);
        return true;
    }

    public static bool RemoveMissing(List<LibraryItem> root)
    {
        var removed = root.RemoveAll(i => !i.IsFolder && !FileExists(i.Path));
        foreach (var folder in root.Where(i => i.IsFolder))
            removed += folder.Items?.RemoveAll(i => !FileExists(i.Path)) ?? 0;
        return removed > 0;
    }

    public static bool NewFolder(List<LibraryItem> root, string id, string name)
    {
        if (string.IsNullOrWhiteSpace(id) || FindFolder(root, id) is not null)
            return false;
        root.Add(new LibraryItem { Type = LibraryItem.FolderType, Id = id, Name = CleanName(name), Items = [] });
        return true;
    }

    public static bool RenameFolder(List<LibraryItem> root, string id, string name)
    {
        var folder = FindFolder(root, id);
        if (folder is null || string.IsNullOrWhiteSpace(name))
            return false;
        folder.Name = CleanName(name);
        return true;
    }

    /// <summary>删除文件夹，里面的文件移到最外层原来的位置。</summary>
    public static bool DeleteFolder(List<LibraryItem> root, string id)
    {
        var index = root.FindIndex(i => i.IsFolder && i.Id == id);
        if (index < 0)
            return false;
        var children = root[index].Items ?? [];
        root.RemoveAt(index);
        root.InsertRange(index, children);
        return true;
    }

    public static bool SetExpanded(List<LibraryItem> root, string id, bool expanded)
    {
        var folder = FindFolder(root, id);
        if (folder is null || folder.Expanded == expanded)
            return false;
        folder.Expanded = expanded;
        return true;
    }

    /// <summary>
    /// 把条目移动到 <paramref name="targetFolderId"/>（null 表示最外层）里、<paramref name="beforeKey"/> 之前（null 表示末尾）。
    /// 条目用 key 标识：文件是路径，文件夹是 id。
    /// </summary>
    public static bool Move(List<LibraryItem> root, string key, string? targetFolderId, string? beforeKey)
    {
        if (beforeKey is not null && KeyEquals(key, beforeKey))
            return false;

        var item = Extract(root, key);
        if (item is null)
            return false;

        // 文件夹只有一层，文件夹只能放在最外层
        var container = item.IsFolder ? root : FindFolder(root, targetFolderId)?.Items ?? root;
        var index = beforeKey is null ? -1 : container.FindIndex(i => Matches(i, beforeKey));
        if (index < 0)
            container.Add(item);
        else
            container.Insert(index, item);
        return true;
    }

    public static object ToView(List<LibraryItem> root) => root.Select(i => i.IsFolder
        ? (object)new
        {
            type = LibraryItem.FolderType,
            id = i.Id,
            name = i.Name,
            expanded = i.Expanded,
            items = (i.Items ?? []).Select(FileView).ToList(),
        }
        : FileView(i)).ToList();

    private static object FileView(LibraryItem file) => new
    {
        type = LibraryItem.FileType,
        path = file.Path,
        name = Path.GetFileName(file.Path),
        missing = !FileExists(file.Path),
    };

    private static LibraryItem? Extract(List<LibraryItem> root, string key)
    {
        var index = root.FindIndex(i => Matches(i, key));
        if (index >= 0)
        {
            var item = root[index];
            root.RemoveAt(index);
            return item;
        }

        var (container, fileIndex) = FindFile(root, key);
        if (container is null)
            return null;
        var file = container[fileIndex];
        container.RemoveAt(fileIndex);
        return file;
    }

    private static (List<LibraryItem>? Container, int Index) FindFile(List<LibraryItem> root, string path)
    {
        var index = root.FindIndex(i => !i.IsFolder && PathEquals(i.Path, path));
        if (index >= 0)
            return (root, index);

        foreach (var folder in root.Where(i => i.IsFolder && i.Items is not null))
        {
            index = folder.Items!.FindIndex(i => PathEquals(i.Path, path));
            if (index >= 0)
                return (folder.Items, index);
        }
        return (null, -1);
    }

    private static LibraryItem? FindFolder(List<LibraryItem> root, string? id)
    {
        if (string.IsNullOrEmpty(id))
            return null;
        var folder = root.FirstOrDefault(i => i.IsFolder && i.Id == id);
        if (folder is not null)
            folder.Items ??= [];
        return folder;
    }

    private static bool Matches(LibraryItem item, string key) =>
        item.IsFolder ? item.Id == key : PathEquals(item.Path, key);

    private static bool KeyEquals(string a, string b) =>
        string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    private static bool PathEquals(string? a, string? b) =>
        a is not null && b is not null && string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    private static bool FileExists(string? path) => path is not null && File.Exists(path);

    private static string CleanName(string name)
    {
        var trimmed = name.Trim();
        return trimmed.Length > 100 ? trimmed[..100] : trimmed;
    }
}
