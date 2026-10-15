using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace SmartMdReader;

/// <summary>
/// 在 HKCU 下注册右键菜单和「打开方式」，不需要管理员权限。
/// </summary>
internal static class FileAssociation
{
    private const string ProgId = "SmartMdReader.Markdown";
    private const string VerbName = "SmartMdReader";
    private const string AppKey = @"Applications\SmartMdReader.exe";

    public static void Register(string exePath)
    {
        var command = $"\"{exePath}\" \"%1\"";
        var icon = $"\"{exePath}\",0";

        using var classes = Registry.CurrentUser.CreateSubKey(@"Software\Classes");

        using (var prog = classes.CreateSubKey(ProgId))
        {
            prog.SetValue("", Loc.ForSystem("shell.fileType"));
            using (var k = prog.CreateSubKey("DefaultIcon")) k.SetValue("", icon);
            using (var k = prog.CreateSubKey(@"shell\open\command")) k.SetValue("", command);
        }

        using (var app = classes.CreateSubKey(AppKey))
        {
            app.SetValue("FriendlyAppName", AppInfo.Name);
            using (var k = app.CreateSubKey("DefaultIcon")) k.SetValue("", icon);
            using (var k = app.CreateSubKey(@"shell\open\command")) k.SetValue("", command);
            using var types = app.CreateSubKey("SupportedTypes");
            foreach (var ext in AppInfo.MarkdownExtensions)
                types.SetValue(ext, "");
        }

        foreach (var ext in AppInfo.MarkdownExtensions)
        {
            using (var k = classes.CreateSubKey($@"{ext}\OpenWithProgids")) k.SetValue(ProgId, "");

            using var verb = classes.CreateSubKey($@"SystemFileAssociations\{ext}\shell\{VerbName}");
            verb.SetValue("", Loc.ForSystem("shell.menuText"));
            verb.SetValue("Icon", icon);
            using var cmd = verb.CreateSubKey("command");
            cmd.SetValue("", command);
        }

        NotifyShell();
    }

    /// <summary>已注册时，让右键菜单文字跟随当前 Windows 显示语言（系统语言变更后启动一次即可同步）。</summary>
    public static void SyncMenuTextWithSystem()
    {
        try
        {
            using var classes = Registry.CurrentUser.OpenSubKey(@"Software\Classes", writable: true);
            if (classes is null)
                return;

            var changed = false;
            using (var prog = classes.OpenSubKey(ProgId, writable: true))
                changed |= SetIfDifferent(prog, Loc.ForSystem("shell.fileType"));

            foreach (var ext in AppInfo.MarkdownExtensions)
            {
                using var verb = classes.OpenSubKey($@"SystemFileAssociations\{ext}\shell\{VerbName}", writable: true);
                changed |= SetIfDifferent(verb, Loc.ForSystem("shell.menuText"));
            }

            if (changed)
                NotifyShell();
        }
        catch
        {
        }
    }

    private static bool SetIfDifferent(RegistryKey? key, string value)
    {
        if (key is null || key.GetValue("") as string == value)
            return false;
        key.SetValue("", value);
        return true;
    }

    public static void Unregister()
    {
        using var classes = Registry.CurrentUser.CreateSubKey(@"Software\Classes");
        classes.DeleteSubKeyTree(ProgId, false);
        classes.DeleteSubKeyTree(AppKey, false);

        foreach (var ext in AppInfo.MarkdownExtensions)
        {
            classes.DeleteSubKeyTree($@"SystemFileAssociations\{ext}\shell\{VerbName}", false);
            using var openWith = classes.OpenSubKey($@"{ext}\OpenWithProgids", writable: true);
            openWith?.DeleteValue(ProgId, false);
        }

        NotifyShell();
    }

    private static void NotifyShell() => SHChangeNotify(0x08000000 /* SHCNE_ASSOCCHANGED */, 0, IntPtr.Zero, IntPtr.Zero);

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
}
