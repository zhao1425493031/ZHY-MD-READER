using System.IO;
using System.Text.Json;

namespace ZhyMdReader;

internal sealed class AppSettings
{
    public string Language { get; set; } = Loc.DefaultLanguage;
    public string Theme { get; set; } = "auto";
    public bool ShowToc { get; set; } = true;
    public double WindowWidth { get; set; } = 1100;
    public double WindowHeight { get; set; } = 800;
    public bool Maximized { get; set; }

    private static string FilePath => Path.Combine(AppInfo.DataDir, "settings.json");

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new AppSettings();
        }
        catch
        {
        }
        return new AppSettings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(AppInfo.DataDir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, JsonOptions));
        }
        catch
        {
        }
    }
}
