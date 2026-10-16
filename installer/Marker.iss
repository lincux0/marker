#ifndef AppVersion
  #error AppVersion must be supplied by scripts/build-setup.ps1
#endif
#define ProjectRoot AddBackslash(SourcePath) + ".."
#ifndef SourceDir
#define SourceDir ProjectRoot + "\src\Marker.App\bin\x64\Release\net10.0-windows10.0.26100.0\win-x64"
#endif
#ifndef OutputDir
#define OutputDir ProjectRoot + "\artifacts\setup"
#endif

[Setup]
AppId={{D4C8A016-195E-46A9-884B-7B960544F5B3}
AppName=Marker
AppVersion={#AppVersion}
AppVerName=Marker {#AppVersion}
AppPublisher=Marker
DefaultDirName={localappdata}\Programs\Marker
DefaultGroupName=Marker
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.26100
UninstallDisplayIcon={app}\Marker.App.exe
SetupIconFile="{#SourceDir}\Assets\Marker.ico"
OutputDir={#OutputDir}
OutputBaseFilename=Marker-Setup-{#AppVersion}-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
VersionInfoVersion={#AppVersion}
Uninstallable=yes
ChangesAssociations=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "*.pdb,AppxManifest.xml,*.appx,*.msix,*.appxbundle,*.msixbundle,*.appxrecipe,\LICENSE.txt,\THIRD_PARTY_NOTICES.md,\licenses\*"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ProjectRoot}\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "{#ProjectRoot}\THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\installer\licenses\MIT.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "{#ProjectRoot}\installer\licenses\Apache-2.0.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "{#ProjectRoot}\installer\licenses\WebThirdParty.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "{#ProjectRoot}\installer\licenses\NuGetThirdParty.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "{#ProjectRoot}\installer\licenses\Markdig.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion

[Icons]
Name: "{group}\Marker"; Filename: "{app}\Marker.App.exe"
Name: "{group}\许可证"; Filename: "{app}\LICENSE.txt"
Name: "{group}\第三方组件声明"; Filename: "{app}\THIRD_PARTY_NOTICES.md"
Name: "{group}\第三方许可证\MIT License"; Filename: "{app}\licenses\MIT.txt"
Name: "{group}\第三方许可证\Apache License 2.0"; Filename: "{app}\licenses\Apache-2.0.txt"
Name: "{autodesktop}\Marker"; Filename: "{app}\Marker.App.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\Marker.Markdown"; ValueType: string; ValueName: ""; ValueData: "Marker Markdown 文档"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Marker.Markdown\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\Marker.App.exe"",0"
Root: HKCU; Subkey: "Software\Classes\Marker.Markdown\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Marker.App.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "Marker.Markdown"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "Marker.Markdown"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\Classes\Applications\Marker.App.exe"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "Marker"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Applications\Marker.App.exe\SupportedTypes"; ValueType: string; ValueName: ".md"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\Applications\Marker.App.exe\SupportedTypes"; ValueType: string; ValueName: ".markdown"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\Applications\Marker.App.exe\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Marker.App.exe"" ""%1"""

[Code]
const
  WebView2RuntimeClientKey = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasRuntimeAt(RootKey: Integer; Key: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, Key, 'pv', Version) and
    (Version <> '') and (Version <> '0.0.0.0');
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not (HasRuntimeAt(HKLM32, WebView2RuntimeClientKey) or
          HasRuntimeAt(HKLM64, WebView2RuntimeClientKey) or
          HasRuntimeAt(HKCU32, WebView2RuntimeClientKey) or
          HasRuntimeAt(HKCU64, WebView2RuntimeClientKey)) then
    Result := MsgBox('未检测到 Microsoft Edge WebView2 Runtime。Marker 需要该运行时才能启动。本安装程序不会自动下载或安装运行时。仍要继续安装 Marker 吗？',
      mbConfirmation, MB_YESNO) = IDYES;
end;
