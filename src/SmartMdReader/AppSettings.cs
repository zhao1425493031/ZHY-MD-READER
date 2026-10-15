using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SmartMdReader;

internal sealed class AppSettings
{
    public string Language { get; set; } = Loc.DefaultLanguage;
    public string Theme { get; set; } = "auto";
    public bool ShowToc { get; set; } = true;
    public double WindowWidth { get; set; } = 1100;
    public double WindowHeight { get; set; } = 800;
    public bool Maximized { get; set; }

    public double SidebarWidth { get; set; } = 280;
    public double FilesPaneRatio { get; set; } = 0.45;
    public bool FilesCollapsed { get; set; }
    public bool TocCollapsed { get; set; }
    public double EditorRatio { get; set; } = 0.5;

    /// <summary>正文宽度（窗口宽度的百分比）。</summary>
    public int ContentWidth { get; set; } = 90;
    public int FontSize { get; set; } = 16;

    public List<LibraryItem> Library { get; set; } = [];

    public static string FilePath => Path.Combine(AppInfo.DataDir, "settings.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    // 每次打开文件都是一个独立进程，用命名互斥量串行化「读-改-写」
    private static readonly Mutex FileMutex = new(false, @"Local\SmartMdReader.Settings");

    public static AppSettings Load() => TryLoad(out var settings) ? settings : new AppSettings();

    /// <summary>读取最新设置、修改、保存。读取失败时不写入，避免用默认值覆盖用户数据。</summary>
    public static void Update(Action<AppSettings> change)
    {
        var locked = false;
        try
        {
            try
            {
                locked = FileMutex.WaitOne(TimeSpan.FromSeconds(3));
            }
            catch (AbandonedMutexException)
            {
                locked = true;
            }

            if (!TryLoad(out var settings))
                return;
            change(settings);
            settings.Save();
        }
        finally
        {
            if (locked)
                FileMutex.ReleaseMutex();
        }
    }

    private static bool TryLoad(out AppSettings settings)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                settings = File.Exists(FilePath)
                    ? JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath), JsonOptions) ?? new AppSettings()
                    : new AppSettings();
                return true;
            }
            catch (IOException)
            {
                Thread.Sleep(40);
            }
            catch (JsonException)
            {
                settings = new AppSettings();
                return true;
            }
        }
        settings = new AppSettings();
        return false;
    }

    private void Save()
    {
        try
        {
            Directory.CreateDirectory(AppInfo.DataDir);
            var temp = FilePath + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(this, JsonOptions));
            File.Move(temp, FilePath, overwrite: true);
        }
        catch
        {
        }
    }
}

internal sealed class LibraryItem
{
    public const string FileType = "file";
    public const string FolderType = "folder";

    public string Type { get; set; } = FileType;
    public string? Path { get; set; }
    public string? Id { get; set; }
    public string? Name { get; set; }
    public bool Expanded { get; set; } = true;
    public List<LibraryItem>? Items { get; set; }

    [JsonIgnore]
    public bool IsFolder => Type == FolderType;
}
