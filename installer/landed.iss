; Landed fuer Android/Chrome - Inno Setup Skript.
; Baut aus dem bestehenden build/-Ordner (node tools/build.mjs) einen
; richtigen Installer statt der bisherigen portablen ZIP - siehe
; tools/build-installer.mjs fuer den Aufruf (uebergibt MyAppVersion per /D).
;
; PrivilegesRequired=lowest + DefaultDirName unter {localappdata}\Programs:
; Installation nur fuer den aktuellen Nutzer, kein UAC-Dialog, keine
; Admin-Rechte noetig - passt zum bisherigen Anspruch "einfach lauffaehig",
; genau wie VS Code/Chrome das per Default machen. Nutzerdaten
; (%LOCALAPPDATA%\Landed\) liegen ohnehin schon ausserhalb des Programm-
; Verzeichnisses (siehe lib/config.mjs) - ein Deinstallieren loescht sie
; NICHT, nur die Programmdateien selbst.
;
; AppId bewusst als fest verdrahtete GUID (nicht {#MyAppName}): das ist die
; Identitaet, ueber die Windows "ist das dieselbe App, upgrade in place"
; erkennt UND ueber die Icons/Start-Menue-Eintraege ihre AppUserModelID
; bekommen (siehe [Icons] unten - die Antwort auf das Taskleisten-Pin-
; Problem, robuster als der reine Build-Fix von vorher). Diese GUID darf
; sich in keinem kuenftigen Installer-Release mehr aendern.
#define MyAppName "Landed"
#define MyAppPublisher "workbench"
#define MyAppExeName "Landed.exe"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
; workbench.Landed statt workbench.landed.Landed o.ae. - kurze, stabile
; AppUserModelID, die Windows fuer Taskleisten-/Start-Pins und
; Benachrichtigungsgruppierung als Identitaet nutzt.
#define MyAppUserModelID "workbench.Landed"

[Setup]
; Direkt als Literal statt ueber #define - Inno Setups eigene Escape-Regel
; fuer die einleitende geschweifte Klammer einer GUID ({{...}) kollidiert
; sonst mit der Konstanten-Syntax {#Name}.
AppId={{05865A9B-1D14-4267-9FFC-7FD86D56E824}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Landed-Setup-v{#MyAppVersion}
SetupIconFile=..\assets\landed.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

; Kompletter build/-Inhalt (Landed.exe, public/, platform-tools/, LICENSES/)
; unveraendert nach {app} - genau das Layout, das build.mjs schon erzeugt.
[Files]
Source: "..\build\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

; AppUserModelID hier gesetzt (Inno Setup >= 6.1) statt sie der App selbst
; ueberlassen zu muessen - loest die Taskleisten-/Start-Pin-Fragilitaet
; grundsaetzlicher als der reine "Datei nicht mehr loeschen"-Fix in
; tools/build.mjs, weil Windows die App jetzt unabhaengig vom konkreten
; Binary-Inhalt wiedererkennt.
[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; AppUserModelID: "{#MyAppUserModelID}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; AppUserModelID: "{#MyAppUserModelID}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
