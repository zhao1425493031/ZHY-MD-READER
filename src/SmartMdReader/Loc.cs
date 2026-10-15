namespace SmartMdReader;

/// <summary>
/// 界面文本。C# 侧直接用 <see cref="T(string)"/>；以 "ui." 开头的键会下发给 viewer.js。
/// </summary>
internal static class Loc
{
    public const string DefaultLanguage = "en";

    public static readonly IReadOnlyList<(string Code, string NativeName)> Languages =
    [
        ("en", "English"),
        ("zh", "简体中文"),
        ("ja", "日本語"),
    ];

    public static string Language { get; private set; } = DefaultLanguage;

    public static string Normalize(string? language) =>
        Languages.Any(l => l.Code == language) ? language! : DefaultLanguage;

    public static void SetLanguage(string? language) => Language = Normalize(language);

    public static string T(string key) =>
        Tables[Language].TryGetValue(key, out var text) ? text
        : Tables[DefaultLanguage].TryGetValue(key, out var fallback) ? fallback
        : key;

    public static string T(string key, params object[] args) => string.Format(T(key), args);

    /// <summary>按 Windows 系统显示语言取文本（用于资源管理器右键菜单），与应用内语言设置无关。</summary>
    public static string ForSystem(string key)
    {
        var system = Normalize(System.Globalization.CultureInfo.InstalledUICulture.TwoLetterISOLanguageName);
        return Tables[system].TryGetValue(key, out var text) ? text : Tables[DefaultLanguage][key];
    }

    public static Dictionary<string, string> ViewerStrings() =>
        Tables[DefaultLanguage].Keys
            .Where(k => k.StartsWith("ui.", StringComparison.Ordinal))
            .ToDictionary(k => k, T);

    private static readonly Dictionary<string, Dictionary<string, string>> Tables = new()
    {
        ["en"] = new()
        {
            ["app.registered"] =
                "Registered with File Explorer.\n\n" +
                "· Right-click a .md file → \"Open with SmartMdReader\" (on Windows 11 it is under \"Show more options\").\n" +
                "· SmartMdReader also appears in the \"Open with\" list.\n" +
                "· To open on double-click: right-click a .md file → Open with → Choose another app → SmartMdReader → Always.",
            ["app.unregistered"] = "Removed from File Explorer.",
            ["app.webview2Missing"] =
                "Unable to start the WebView2 runtime.\nPlease install the Microsoft Edge WebView2 Runtime:\n{0}\n\n{1}",
            ["dialog.openTitle"] = "Open Markdown File",
            ["dialog.filter"] = "Markdown files|*.md;*.markdown;*.mdown;*.mkd;*.mkdn|All files|*.*",
            ["toast.fileNotFound"] = "File not found: {0}",
            ["shell.menuText"] = "Open with SmartMdReader",
            ["shell.fileType"] = "Markdown Document",

            ["ui.toc.title"] = "Contents",
            ["ui.btn.toc"] = "Show/hide sidebar (Ctrl+\\)",
            ["ui.btn.back"] = "Back to previous file (Alt+←)",
            ["ui.btn.open"] = "Open",
            ["ui.btn.openTitle"] = "Open file (Ctrl+O)",
            ["ui.btn.reload"] = "Reload (F5)",
            ["ui.btn.theme"] = "Switch theme",
            ["ui.btn.settings"] = "Settings",
            ["ui.filePath.title"] = "Show in File Explorer",
            ["ui.theme.auto"] = "System",
            ["ui.theme.light"] = "Light",
            ["ui.theme.dark"] = "Dark",
            ["ui.welcome.line1"] = "Drag a Markdown file here, or press Ctrl + O to open one.",
            ["ui.welcome.hint"] = "In File Explorer, right-click a .md file → \"Open with SmartMdReader\"",
            ["ui.drop"] = "Drop to open",
            ["ui.copy"] = "Copy",
            ["ui.copy.done"] = "Copied",
            ["ui.copy.failed"] = "Copy failed",
            ["ui.error.loadFailed"] = "Unable to open file: {0}",
            ["ui.settings.title"] = "Settings",
            ["ui.settings.language"] = "Language",
            ["ui.settings.theme"] = "Theme",
            ["ui.settings.showToc"] = "Show sidebar",
            ["ui.settings.close"] = "Close",
            ["ui.files.title"] = "Files",
            ["ui.files.add"] = "Add files…",
            ["ui.files.newFolder"] = "New folder",
            ["ui.files.empty"] = "No files yet. Files you open or drag here are added automatically.",
            ["ui.files.open"] = "Open",
            ["ui.files.reveal"] = "Show in File Explorer",
            ["ui.files.moveTo"] = "Move to",
            ["ui.files.topLevel"] = "Top level",
            ["ui.files.remove"] = "Remove from list",
            ["ui.files.removeMissing"] = "Remove missing files",
            ["ui.files.rename"] = "Rename",
            ["ui.files.deleteFolder"] = "Delete folder",
            ["ui.files.missing"] = "File not found",
            ["ui.pane.collapse"] = "Collapse/expand",
        },
        ["zh"] = new()
        {
            ["app.registered"] =
                "已注册到资源管理器。\n\n" +
                "· 右键 .md 文件即可看到「用 SmartMdReader 打开」（Win11 在「显示更多选项」里）。\n" +
                "· 「打开方式」列表中也会出现 SmartMdReader。\n" +
                "· 想双击直接打开：右键 .md → 打开方式 → 选择其他应用 → SmartMdReader → 始终。",
            ["app.unregistered"] = "已从资源管理器中移除。",
            ["app.webview2Missing"] =
                "无法启动 WebView2 运行时。\n请安装 Microsoft Edge WebView2 Runtime：\n{0}\n\n{1}",
            ["dialog.openTitle"] = "打开 Markdown 文件",
            ["dialog.filter"] = "Markdown 文件|*.md;*.markdown;*.mdown;*.mkd;*.mkdn|所有文件|*.*",
            ["toast.fileNotFound"] = "文件不存在：{0}",
            ["shell.menuText"] = "用 SmartMdReader 打开",
            ["shell.fileType"] = "Markdown 文档",

            ["ui.toc.title"] = "目录",
            ["ui.btn.toc"] = "显示/隐藏侧栏 (Ctrl+\\)",
            ["ui.btn.back"] = "返回上一个文件 (Alt+←)",
            ["ui.btn.open"] = "打开",
            ["ui.btn.openTitle"] = "打开文件 (Ctrl+O)",
            ["ui.btn.reload"] = "重新加载 (F5)",
            ["ui.btn.theme"] = "切换主题",
            ["ui.btn.settings"] = "设置",
            ["ui.filePath.title"] = "在资源管理器中显示",
            ["ui.theme.auto"] = "跟随系统",
            ["ui.theme.light"] = "浅色",
            ["ui.theme.dark"] = "深色",
            ["ui.welcome.line1"] = "把 Markdown 文件拖到这里，或者按 Ctrl + O 打开。",
            ["ui.welcome.hint"] = "在资源管理器中右键 .md 文件 →「用 SmartMdReader 打开」",
            ["ui.drop"] = "松开以打开文件",
            ["ui.copy"] = "复制",
            ["ui.copy.done"] = "已复制",
            ["ui.copy.failed"] = "复制失败",
            ["ui.error.loadFailed"] = "无法打开文件：{0}",
            ["ui.settings.title"] = "设置",
            ["ui.settings.language"] = "语言",
            ["ui.settings.theme"] = "主题",
            ["ui.settings.showToc"] = "显示侧栏",
            ["ui.settings.close"] = "关闭",
            ["ui.files.title"] = "文件",
            ["ui.files.add"] = "添加文件…",
            ["ui.files.newFolder"] = "新建文件夹",
            ["ui.files.empty"] = "还没有文件。打开或拖进来的文件会自动加入这里。",
            ["ui.files.open"] = "打开",
            ["ui.files.reveal"] = "在资源管理器中显示",
            ["ui.files.moveTo"] = "移动到",
            ["ui.files.topLevel"] = "最外层",
            ["ui.files.remove"] = "从列表中移除",
            ["ui.files.removeMissing"] = "移除已不存在的文件",
            ["ui.files.rename"] = "重命名",
            ["ui.files.deleteFolder"] = "删除文件夹",
            ["ui.files.missing"] = "文件不存在",
            ["ui.pane.collapse"] = "折叠/展开",
        },
        ["ja"] = new()
        {
            ["app.registered"] =
                "エクスプローラーに登録しました。\n\n" +
                "· .md ファイルを右クリック →「SmartMdReader で開く」（Windows 11 では「その他のオプションを確認」内）。\n" +
                "· 「プログラムから開く」の一覧にも SmartMdReader が表示されます。\n" +
                "· ダブルクリックで開くには：.md を右クリック → プログラムから開く → 別のプログラムを選択 → SmartMdReader → 常に使う。",
            ["app.unregistered"] = "エクスプローラーから登録を解除しました。",
            ["app.webview2Missing"] =
                "WebView2 ランタイムを起動できません。\nMicrosoft Edge WebView2 Runtime をインストールしてください：\n{0}\n\n{1}",
            ["dialog.openTitle"] = "Markdown ファイルを開く",
            ["dialog.filter"] = "Markdown ファイル|*.md;*.markdown;*.mdown;*.mkd;*.mkdn|すべてのファイル|*.*",
            ["toast.fileNotFound"] = "ファイルが見つかりません：{0}",
            ["shell.menuText"] = "SmartMdReader で開く",
            ["shell.fileType"] = "Markdown ドキュメント",

            ["ui.toc.title"] = "目次",
            ["ui.btn.toc"] = "サイドバーの表示/非表示 (Ctrl+\\)",
            ["ui.btn.back"] = "前のファイルに戻る (Alt+←)",
            ["ui.btn.open"] = "開く",
            ["ui.btn.openTitle"] = "ファイルを開く (Ctrl+O)",
            ["ui.btn.reload"] = "再読み込み (F5)",
            ["ui.btn.theme"] = "テーマの切り替え",
            ["ui.btn.settings"] = "設定",
            ["ui.filePath.title"] = "エクスプローラーで表示",
            ["ui.theme.auto"] = "システム設定",
            ["ui.theme.light"] = "ライト",
            ["ui.theme.dark"] = "ダーク",
            ["ui.welcome.line1"] = "Markdown ファイルをここにドラッグするか、Ctrl + O で開いてください。",
            ["ui.welcome.hint"] = "エクスプローラーで .md ファイルを右クリック →「SmartMdReader で開く」",
            ["ui.drop"] = "ドロップして開く",
            ["ui.copy"] = "コピー",
            ["ui.copy.done"] = "コピーしました",
            ["ui.copy.failed"] = "コピー失敗",
            ["ui.error.loadFailed"] = "ファイルを開けません：{0}",
            ["ui.settings.title"] = "設定",
            ["ui.settings.language"] = "言語",
            ["ui.settings.theme"] = "テーマ",
            ["ui.settings.showToc"] = "サイドバーを表示する",
            ["ui.settings.close"] = "閉じる",
            ["ui.files.title"] = "ファイル",
            ["ui.files.add"] = "ファイルを追加…",
            ["ui.files.newFolder"] = "新しいフォルダー",
            ["ui.files.empty"] = "ファイルはまだありません。開いたファイルやドラッグしたファイルが自動で追加されます。",
            ["ui.files.open"] = "開く",
            ["ui.files.reveal"] = "エクスプローラーで表示",
            ["ui.files.moveTo"] = "移動先",
            ["ui.files.topLevel"] = "最上位",
            ["ui.files.remove"] = "一覧から削除",
            ["ui.files.removeMissing"] = "見つからないファイルを削除",
            ["ui.files.rename"] = "名前の変更",
            ["ui.files.deleteFolder"] = "フォルダーを削除",
            ["ui.files.missing"] = "ファイルが見つかりません",
            ["ui.pane.collapse"] = "折りたたみ/展開",
        },
    };
}
