import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { isSea } from 'node:sea';
import { dataPath } from './config.mjs';

const execFileAsync = promisify(execFile);

// Gleicher Fund wie in lib/adb.mjs: reg.exe/powershell.exe sind Konsolen-
// Anwendungen, ohne windowsHide blitzt aus dem konsolenlosen Landed.exe
// (siehe tools/build.mjs PE-Subsystem-Patch) fuer jeden Aufruf kurz ein
// Fenster auf.
const HIDDEN = { windowsHide: true };

// App Paths ist Windows' eigener Mechanismus fuer "wo liegt Programm X" -
// robuster als zwei fest verdrahtete Installationspfade (die je nach
// x86/x64-Installer, Systemsprache oder benutzerspezifischer Installation
// variieren). HKCU zuerst (Chrome installiert oft nur fuer den aktuellen
// Nutzer), HKLM als Fallback (System-weite Installation, wie hier real
// verifiziert). REG_SZ als Ankerpunkt statt des Wertnamens "(Standard)"/
// "(Default)" - der ist sprachabhaengig, REG_SZ nicht.
async function findViaRegistry(key) {
  try {
    const { stdout } = await execFileAsync('reg', ['query', key, '/ve'], HIDDEN);
    const match = stdout.match(/REG_SZ\s+(.+)\r?\n/);
    return match ? match[1].trim() : null;
  } catch {
    return null; // Schluessel existiert nicht - kein Fehlerfall, naechste Quelle versuchen
  }
}

async function findAppPath(exeName) {
  const base = `SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`;
  return (await findViaRegistry(`HKCU\\${base}`)) || (await findViaRegistry(`HKLM\\${base}`));
}

export const findChrome = () => findAppPath('chrome.exe');
export const findEdge = () => findAppPath('msedge.exe');

// Eigenes Browserprofil fuer das App-Fenster. Der Ordnername ist NICHT
// beliebig: Chrome baut die AppUserModelID (AUMID) eines --app-Fensters als
// "<BaseAppId>.<host>_<pfad>.<Profilordner>.<Profil>" - der letzte Teil kommt
// aus dem --user-data-dir. Ohne dieses Flag steckt darin das persoenliche
// Chrome-Profil des Nutzers (real gemessen: "Chrome.127.0.0.1_/.UserData.
// Profile1"), das kein Installer vorher kennen kann. Mit festem Ordnernamen
// wird daraus auf JEDEM Rechner "Chrome.127.0.0.1_/.LandedApp.Default" -
// weder Benutzername noch Port gehen ein. Genau diese Zeichenkette traegt die
// Verknuepfung aus installer/landed.iss, und erst dadurch findet Windows ein
// Icon fuer das Fenster, statt auf das Chrome-Icon zurueckzufallen.
// Ordnername also nur zusammen mit MyAppUserModelID dort aendern.
const APP_PROFILE_DIR_NAME = 'LandedApp';

// Oeffnet die App als eigenstaendiges Fenster ohne Adressleiste/Tabs - wirkt
// wie eine echte Desktop-App statt wie ein Browser-Tab. Fallback-Kette:
// Chrome (per Registry, kein fest verdrahteter Pfad) -> Edge (ebenfalls
// Chromium, kann genauso --app=) -> Standardbrowser (kein App-Fenster-
// Effekt mehr, aber die App bleibt so oder so erreichbar).
export async function openAppWindow(url) {
  const browser = (await findChrome()) || (await findEdge());
  if (browser) {
    spawn(
      browser,
      [
        `--app=${url}`,
        `--user-data-dir=${dataPath(APP_PROFILE_DIR_NAME)}`,
        // Eigenes Profil heisst sonst: Willkommensseite und
        // "Chrome ist nicht dein Standardbrowser"-Leiste bei jedem Start.
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1240,840',
      ],
      { detached: true, stdio: 'ignore' }
    ).unref();
    return;
  }
  spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// Einen Link im ALLTAGSBROWSER des Nutzers oeffnen, bewusst OHNE
// --user-data-dir. Seit das App-Fenster ein eigenes Profil benutzt (siehe
// oben, noetig fuer eine vorhersagbare AppUserModelID), landete sonst jeder
// angeklickte Link in genau diesem anmeldungsfreien Profil - der Nutzer sah
// ueberall Abmeldeseiten. Das Fenster darf isoliert sein, die Inhalte gehoeren
// dorthin, wo der Nutzer angemeldet ist.
//
// Kein "cmd /c start" hier: die URL kommt aus einem eingelesenen Tab und damit
// letztlich von aussen. cmd.exe wuerde &, ^ und % selbst interpretieren.
// rundll32 bekommt die URL als eigenes argv-Element, ohne Shell dazwischen.
// Zweite Schranke, absichtlich redundant zur Pruefung im Handler: Chrome
// deutet jedes Argument, das mit "--" beginnt, als FLAG statt als URL. Solange
// hier eine normalisierte http(s)-URL ankommt, kann das nicht passieren - sie
// faengt immer mit dem Schema an. Verliesse sich diese Funktion allein auf
// ihren Aufrufer, wuerde ein spaeterer Umbau, der die Roh-Eingabe statt
// URL.href durchreicht, unbemerkt eine Flag-Einschleusung aufmachen
// (z.B. "--disable-web-security"). Deshalb hier noch einmal selbst pruefen.
export async function openInDefaultBrowser(url) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Nur http/https darf geöffnet werden, nicht: ${url}`);
  }
  const browser = (await findChrome()) || (await findEdge());
  const [cmd, args] = browser
    ? [browser, [url]]
    : ['rundll32', ['url.dll,FileProtocolHandler', url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// PowerShell + WScript.Shell-COM-Objekt statt einer npm-Abhaengigkeit fuer
// .lnk-Dateien - beides ist auf jedem Windows vorhanden. Alle Pfade kommen
// aus process.execPath/[Environment]::GetFolderPath, NIE aus dem Request -
// eine Verknuepfung mit einem vom Client kontrollierten Ziel waere ein
// Command-Injection-Weg. Nur im gepackten Zustand sinnvoll: im Dev-Modus
// zeigt process.execPath auf node.exe, nicht auf eine echte "Landed"-Binary.
//
// Realer Bug, an einem echten Windows-Rechner gefunden: os.homedir()+'Desktop'
// (fruehere Version) ignoriert eine per OneDrive umgeleitete Desktop-
// Ordner-Registrierung (User Shell Folders\Desktop) - unter Windows 11 mit
// Microsoft-Konto heute der Standardfall, nicht die Ausnahme. Die
// Verknuepfung landete dann in C:\Users\<Name>\Desktop, waehrend der
// Explorer tatsaechlich C:\Users\<Name>\OneDrive\Desktop als "Desktop"
// anzeigt - fuer den Nutzer unsichtbar erstellt. [Environment]::GetFolderPath
// fragt Windows selbst nach dem echten, aktuell gueltigen Pfad statt ihn
// aus dem Benutzerverzeichnis zu erraten.
export async function createDesktopShortcut() {
  if (!isSea()) {
    throw new Error('Verknüpfung nur in der gepackten App verfügbar (nicht im Entwicklungsmodus).');
  }
  const exePath = process.execPath;
  // Einfache Anfuehrungszeichen innerhalb eines PS-Single-Quote-Literals
  // werden durch Verdopplung escaped ('' statt \') - ohne das bricht z.B.
  // ein Benutzerprofil wie "O'Brien" das generierte Skript.
  const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const psScript = [
    '$desktop = [Environment]::GetFolderPath("Desktop")',
    '$shortcutPath = Join-Path $desktop "Landed.lnk"',
    '$s = New-Object -ComObject WScript.Shell',
    '$sc = $s.CreateShortcut($shortcutPath)',
    `$sc.TargetPath = ${psQuote(exePath)}`,
    // Explizit leeren, nicht nur weglassen: CreateShortcut() liest eine
    // bereits vorhandene .lnk-Datei ein und Save() ueberschreibt nur die
    // Felder, die dieses Skript setzt - ein Argument aus einer alten
    // Verknuepfung (real beobachtet: der veraltete Pfad zum entfernten
    // start-app.vbs) wuerde sonst stehen bleiben und Landed.exe beim
    // naechsten Neuanlegen mit einem irrefuehrenden Kommandozeilenargument
    // starten.
    "$sc.Arguments = ''",
    `$sc.IconLocation = ${psQuote(`${exePath},0`)}`,
    `$sc.WorkingDirectory = ${psQuote(path.dirname(exePath))}`,
    '$sc.Save()',
    'Write-Output $shortcutPath',
  ].join('; ');
  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], HIDDEN);
  return stdout.trim();
}
