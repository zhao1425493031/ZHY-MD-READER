; SmartMdReader installer (Inno Setup 6)
; Build with: powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef PublishDir
  #define PublishDir "..\publish\app"
#endif

#define AppName "SmartMdReader"
#define AppExe "SmartMdReader.exe"

[Setup]
AppId={{D68FBC23-B059-4AE9-82E1-F389E73D58DC}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppName}
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Setup

; 只为当前用户安装，不需要管理员权限；{autopf} 解析为 %LOCALAPPDATA%\Programs
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763

WizardStyle=modern
ShowLanguageDialog=no
SetupIconFile=..\src\SmartMdReader\assets\app.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}

OutputDir=..\dist
OutputBaseFilename={#AppName}-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes

CloseApplications=yes
RestartApplications=no
ChangesAssociations=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "explorer"; Description: "Add ""Open with {#AppName}"" to the right-click menu of .md files"; GroupDescription: "File Explorer integration:"
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; 升级时清掉旧版本留下的 assets，避免残留文件
Type: filesandordirs; Name: "{app}\assets"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Parameters: "--register --quiet"; Flags: runhidden waituntilterminated; Tasks: explorer; StatusMsg: "Registering with File Explorer..."
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#AppExe}"; Parameters: "--unregister --quiet"; Flags: runhidden waituntilterminated; RunOnceId: "Unregister"

[UninstallDelete]
; 设置文件和 WebView2 缓存
Type: filesandordirs; Name: "{localappdata}\{#AppName}"

[Code]
const
  WebView2ClientKey = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2DownloadUrl = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

function HasWebView2Value(RootKey: Integer; SubKey: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, SubKey, 'pv', Version)
    and (Version <> '') and (Version <> '0.0.0.0');
end;

function IsWebView2Installed: Boolean;
begin
  Result := HasWebView2Value(HKLM, 'SOFTWARE\WOW6432Node\' + WebView2ClientKey)
    or HasWebView2Value(HKLM, 'SOFTWARE\' + WebView2ClientKey)
    or HasWebView2Value(HKCU, 'Software\' + WebView2ClientKey);
end;

function InitializeSetup: Boolean;
var
  ErrorCode: Integer;
begin
  Result := True;
  if IsWebView2Installed then
    Exit;

  case MsgBox(
    '{#AppName} requires the Microsoft Edge WebView2 Runtime, which was not found on this computer.' + #13#10#13#10 +
    'Yes: open the download page now (install it, then run this setup again).' + #13#10 +
    'No: continue installing anyway.' + #13#10 +
    'Cancel: exit setup.',
    mbConfirmation, MB_YESNOCANCEL) of
    IDYES:
      begin
        ShellExec('open', WebView2DownloadUrl, '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
        Result := False;
      end;
    IDCANCEL:
      Result := False;
  end;
end;
