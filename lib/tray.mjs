// Eigenes Landed-Systray-Icon, solange der Server laeuft - egal ob gerade
// ein Fenster offen ist oder nicht (Nutzerwunsch 22.08.2026, abgeschaut bei
// der Schwester-App LANDED Bookmarks, dort nach demselben Weg gebaut und
// nachgebessert: nicht "kein Tray-Icon mehr", sondern "ein RICHTIGES, nicht
// Chromes generisches").
//
// Eine erste Fassung hostete das Tray-Icon in einem per PowerShell/WinForms
// gestarteten Skript - bei LANDED Bookmarks live gescheitert, per Recherche
// (nodejs/node#51018) und eigenem isoliertem Test bestaetigt: ein per Node
// spawn() direkt "detached" gestarteter powershell.exe/pwsh.exe-Host laesst
// den WinForms-Message-Loop ([Application]::Run()) sofort mit Exit-Code 0
// zurueckkehren statt zu laufen - eine Windows/PowerShell-spezifische
// Eigenart, keine allgemeine "detached WinForms"-Einschraenkung (isoliert
// nachgewiesen: derselbe spawn(..., {detached:true}) funktioniert fuer eine
// ECHTE kompilierte .exe anstandslos). Ausserdem verfolgt Windows
// Tray-Icon-Sichtbarkeit (NotifyIconSettings) ueber den Pfad der HOSTENDEN
// .exe - ein generisches "powershell.exe" war nicht von jedem anderen
// PowerShell-Tray-Skript auf demselben Rechner unterscheidbar.
//
// Fix, direkt von LANDED Bookmarks uebernommen: tools/tray-helper/TrayHelper.cs,
// zur Build-Zeit per csc.exe zu einer eigenstaendigen build/LandedTray.exe
// kompiliert (siehe tools/build.mjs) - eigene Datei-Identitaet, eigenes
// eingebettetes Icon, startet beim direkten spawn(..., {detached:true})
// nachweislich zuverlaessig.
import { spawn } from 'node:child_process';
import path from 'node:path';

export function startTrayIcon({ exePath, port }) {
  // Das gesamte Projekt ist Windows-only, aber ein billiger expliziter
  // Guard verhindert trotzdem jeden Versuch auf einer anderen Plattform.
  if (process.platform !== 'win32') return;

  // Bewusst kein Fehlschlag fuer den gesamten Serverstart, falls die
  // Helfer-Exe fehlt (z.B. ein manuell aus dem source-Baum gestartetes
  // build/Landed.exe ohne den zugehoerigen Build-Schritt) - das Tray-Icon
  // ist eine kosmetische Zusatzfunktion, kein Kernfeature. spawn() wirft
  // dafuer ein 'error'-Event, das unten abgefangen wird statt die ganze,
  // bereits erfolgreich gestartete App abstuerzen zu lassen.
  const helperPath = path.join(path.dirname(exePath), 'LandedTray.exe');
  const child = spawn(helperPath, [exePath, String(port)], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', (err) => {
    console.error('Tray-Icon-Start fehlgeschlagen:', err?.message || err);
  });
  child.unref();
}
