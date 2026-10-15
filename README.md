# SmartMdReader

Windows 上的轻量 Markdown 阅览器。在资源管理器中右键 `.md` 文件即可打开阅读。

技术栈：C# WPF (.NET 10) + WebView2 + [Markdig](https://github.com/xoofx/markdig)，
样式使用 github-markdown-css，代码高亮使用 highlight.js（全部离线打包）。

## 功能

- 右键菜单「用 SmartMdReader 打开」，以及「打开方式」列表注册（只写 HKCU，不需要管理员权限）
- GitHub 风格渲染：表格、任务列表、脚注、emoji、YAML front matter 等
- 代码高亮（含 PowerShell、Nginx、Dockerfile、Apache、bat 等），代码块一键复制
- 左侧「文件」列表：打开、拖入或 ＋ 添加的文件会一直保留；可新建文件夹分类（一层），拖动调整顺序或移入文件夹；
  右键菜单可打开、在资源管理器中显示、移动到文件夹、从列表移除（不删除磁盘文件）、重命名/删除文件夹、移除已不存在的文件
- 左侧「目录」（TOC），滚动时自动高亮当前章节
- 侧栏的「文件」和「目录」两块都可折叠，中间分隔条可拖动调整高度，侧栏宽度也可拖动
- 编辑：工具栏可切换「阅读 / 分屏 / 编辑」（Ctrl+E）。分屏时左边源码（CodeMirror，语法高亮、Ctrl+F 查找替换）、
  右边实时预览并跟随滚动；Ctrl+S 保存，保留原文件的编码、BOM 和换行符；未保存时标题和文件列表显示 ●，
  切换文件/关闭/重新加载前会询问是否保存；文件被外部修改时提示「重新加载 / 保留我的修改」
- 演示笔（Ctrl+D）：开会或共享屏幕时在预览上圈画，支持笔/荧光笔/橡皮擦、4 种颜色、3 种粗细、撤销（Ctrl+Z）、清空，
  笔迹跟随滚动；按 Esc 退出，笔迹不保存（切换文件或改变窗口宽度时清空）
- 相对路径图片（包括 `../img/a.png`）正确显示
- 文件保存后自动刷新，并保持滚动位置
- 浅色 / 深色 / 跟随系统 三种主题
- 界面支持 English / 简体中文 / 日本語（默认英文），在工具栏 ⚙ 设置（Ctrl+,）中切换；资源管理器右键菜单文字跟随 Windows 系统显示语言
- 点击 `.md` 链接在阅览器内跳转（支持 `other.md#章节`），Alt+← 返回
- 外部链接用系统浏览器打开；其他本地文件只在资源管理器中定位，不会直接执行
- 拖拽文件到窗口打开
- 自动识别 UTF-8 / UTF-8 BOM / UTF-16 / Shift-JIS / GBK 编码
- 禁止执行 Markdown 中嵌入的脚本（CSP）

## 安装包（给用户用）

构建英文向导的安装包 `dist\SmartMdReader-Setup-<版本>.exe`：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
```

需要 .NET 10 SDK 和 [Inno Setup 6](https://jrsoftware.org/isinfo.php)（`winget install JRSoftware.InnoSetup`）。
版本号取自 `SmartMdReader.csproj` 的 `<Version>`，安装脚本是 `installer/SmartMdReader.iss`。

安装包的行为：

- 内置 .NET 运行时（self-contained），用户电脑不需要安装 .NET
- 只为当前用户安装到 `%LOCALAPPDATA%\Programs\SmartMdReader`，不需要管理员权限
- 可选任务：注册 .md 右键菜单（默认勾选）、桌面快捷方式；自动创建开始菜单快捷方式
- 检测 WebView2 运行时，缺失时提示下载
- 覆盖安装即升级；卸载时移除右键菜单、程序文件和用户数据
- 支持静默安装：`SmartMdReader-Setup-1.2.0.exe /VERYSILENT /TASKS="explorer"`

使用提示：

- Win11 的新版右键菜单里，「用 SmartMdReader 打开」在「显示更多选项」里；第一层菜单的「打开方式」中也能直接选。
- 想双击 `.md` 直接打开：右键 `.md` → 打开方式 → 选择其他应用 → SmartMdReader → 始终。
- 也可以直接运行 `SmartMdReader.exe --register` / `--unregister` 来注册或移除右键菜单。

## 开发时快速安装

不打安装包，直接编译并安装到本机（依赖本机的 .NET 运行时）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
```

## 快捷键

| 按键 | 功能 |
|---|---|
| Ctrl+O | 打开文件 |
| Ctrl+E | 切换 阅读 / 分屏 / 编辑 |
| Ctrl+S | 保存 |
| Ctrl+D | 演示笔开/关（Esc 退出，Ctrl+Z 撤销一笔） |
| F5 / Ctrl+R | 重新加载 |
| Alt+← | 返回上一个文件 |
| Ctrl+\ | 显示/隐藏目录 |
| Ctrl+, | 设置（语言、主题、目录） |
| Ctrl+F | 页内查找 |
| Ctrl+P | 打印 / 另存为 PDF |
| Ctrl+滚轮 / Ctrl+± | 缩放 |
| Ctrl+W | 关闭窗口 |

## 开发

```powershell
cd src\SmartMdReader
dotnet run -- ..\..\samples\demo.md
```

目录结构：

- `src/SmartMdReader/MainWindow.xaml.cs`：窗口、WebView2 初始化、文件加载与监听、链接处理
- `src/SmartMdReader/MarkdownRenderer.cs`：Markdig 渲染管线
- `src/SmartMdReader/FileAssociation.cs`：右键菜单 / 打开方式注册
- `src/SmartMdReader/Loc.cs`：中英日界面文本（`ui.*` 键会下发给前端）
- `src/SmartMdReader/assets/viewer.*`：阅读界面（HTML/CSS/JS）
- `editor/`：CodeMirror 6 编辑器源码，用 `scripts\build-editor.ps1` 打包成 `assets/vendor/editor.js`（需要 Node.js，产物已提交，平时不用重新打包）
- `installer/SmartMdReader.iss`：Inno Setup 安装包脚本
- `scripts/`：构建安装包、开发用安装/卸载、图标生成脚本
- `samples/`：测试用 Markdown

用户设置保存在 `%LOCALAPPDATA%\SmartMdReader\settings.json`。
