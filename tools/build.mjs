#!/usr/bin/env node
// Baut Landed.exe als Node Single Executable Application (SEA):
//   1. esbuild buendelt server.mjs + alle lib/*.mjs-Importe zu EINER CJS-Datei
//      (SEA fuehrt das "main"-Skript immer als CommonJS aus - import.meta.url
//      wird dabei zu undefined, siehe lib/config.mjs und server.mjs fuer die
//      isSea()-Weichen, die das umgehen).
//   2. node --build-sea erzeugt daraus direkt eine lauffaehige Landed.exe -
//      auf Node 26 kein separater postject-Schritt mehr noetig (empirisch
//      geprueft; bei einer aelteren Node-Version muesste das neu verifiziert
//      werden, bevor man sich darauf verlaesst).
//   3. public/ wird unveraendert danebenkopiert (bleibt Dateien auf der
//      Platte, nicht Teil des Bundles - adb.exe braucht ohnehin echte
//      Dateien daneben, der Ordner existiert also so oder so).
//   4. PE-Subsystem-Byte auf GUI patchen (kein Konsolenfenster beim
//      Doppelklick) und Icon + Versionsfelder per rcedit setzen
//      (assets/landed.ico, siehe tools/make-icon.mjs).
//   5. Selbsttest: die frisch gebaute .exe muss tatsaechlich starten - mit
//      einem dedizierten Testport und einem Temp-Datenverzeichnis, damit
//      der Test niemals mit einer echten, laufenden Landed-Instanz
//      kollidiert oder echte Nutzerdaten anfasst.
//
// Aufruf: node tools/build.mjs
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, cpSync, mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rcedit } from 'rcedit';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(ROOT, 'build');
const BUNDLE_FILE = path.join(BUILD_DIR, 'landed.cjs');
const SEA_CONFIG_FILE = path.join(BUILD_DIR, 'sea-config.json');
const EXE_FILE = path.join(BUILD_DIR, 'Landed.exe');
const ESBUILD_BIN = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
const ICON_FILE = path.join(ROOT, 'assets', 'landed.ico');
const PLATFORM_TOOLS_CACHE = path.join(ROOT, 'platform-tools-cache');
const TRAY_HELPER_SRC = path.join(ROOT, 'tools', 'tray-helper', 'TrayHelper.cs');
const TRAY_HELPER_OUT = path.join(BUILD_DIR, 'LandedTray.exe');
const PKG_VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const WIN_VERSION = `${PKG_VERSION}.0`; // Windows-Versionsfelder brauchen 4 Teile (X.X.X.X)

async function step(label, fn) {
  process.stdout.write(`-> ${label}...`);
  const result = await fn();
  console.log(' ok');
  return result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Frisch geschriebene, grosse .exe-Dateien werden auf diesem System
// wiederholt kurzzeitig von etwas gesperrt (vermutlich Echtzeit-Virenscan,
// mehrfach empirisch als transientes EPERM/"Unable to commit changes"
// beobachtet - nicht spekuliert, sondern wiederholt aufgetreten). Ein
// erneuter Versuch nach kurzer Pause behebt es zuverlaessig.
async function withRetry(fn, { attempts = 4, delayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  throw lastErr;
}

await step('assets/landed.ico muss existieren (node tools/make-icon.mjs)', () => {
  try {
    statSync(ICON_FILE);
  } catch {
    throw new Error(`${ICON_FILE} fehlt. Einmalig erzeugen: node tools/make-icon.mjs`);
  }
});

await step('platform-tools-cache muss existieren (node tools/fetch-platform-tools.mjs)', () => {
  try {
    statSync(path.join(PLATFORM_TOOLS_CACHE, 'adb.exe'));
  } catch {
    throw new Error(`${PLATFORM_TOOLS_CACHE} fehlt. Einmalig erzeugen: node tools/fetch-platform-tools.mjs`);
  }
});

// Nutzer-Fund: das Taskleisten-Icon verschwand nach JEDEM Neubau. Ursache:
// hier stand vorher ein rmSync(BUILD_DIR, {recursive:true}) - das loeschte
// bei jedem Neubau auch die bestehende Landed.exe, bevor die neue geschrieben
// wurde. Fuer die paar Sekunden bis zum naechsten Schritt existierte am
// (moeglicherweise angehefteten) Pfad buchstaeblich keine Datei mehr -
// Windows verwaist ein Taskleisten-Pin zuverlaessig, wenn sein Ziel
// kurzzeitig verschwindet. Landed.exe bleibt jetzt die ganze Zeit ueber
// bestehen: node --build-sea ueberschreibt eine vorhandene Ausgabedatei
// direkt (empirisch getestet, kein EEXIST) statt eine neue zu erstellen -
// nur die Zwischenartefakte und die Ordner, die ohnehin komplett neu
// zusammengestellt werden, werden vorab entfernt.
await step('Zwischenartefakte und zu ersetzende Ordner entfernen (Landed.exe bleibt bestehen)', async () => {
  mkdirSync(BUILD_DIR, { recursive: true });
  await withRetry(() => rmSync(BUNDLE_FILE, { force: true }));
  await withRetry(() => rmSync(SEA_CONFIG_FILE, { force: true }));
  await withRetry(() => rmSync(path.join(BUILD_DIR, 'public'), { recursive: true, force: true }));
  await withRetry(() => rmSync(path.join(BUILD_DIR, 'platform-tools'), { recursive: true, force: true }));
  await withRetry(() => rmSync(path.join(BUILD_DIR, 'LICENSES'), { recursive: true, force: true }));
});

await step('server.mjs mit esbuild zu einer CJS-Datei buendeln', () => {
  execFileSync(process.execPath, [
    ESBUILD_BIN,
    path.join(ROOT, 'server.mjs'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node22',
    `--outfile=${BUNDLE_FILE}`,
  ]);
});

await step('sea-config.json schreiben', () => {
  writeFileSync(
    SEA_CONFIG_FILE,
    JSON.stringify({ main: BUNDLE_FILE, output: EXE_FILE, disableExperimentalSEAWarning: true }, null, 2)
  );
});

await step('node --build-sea ausfuehren', () => {
  execFileSync(process.execPath, [`--build-sea=${SEA_CONFIG_FILE}`]);
});

// landed.cjs und sea-config.json sind reine Zwischenartefakte - der Bundle-
// Inhalt steckt nach --build-sea bereits in Landed.exe. Im Release-Layout
// (4.2 im Plan) haben sie nichts verloren.
await step('Build-Zwischenartefakte entfernen', () => {
  rmSync(BUNDLE_FILE, { force: true });
  rmSync(SEA_CONFIG_FILE, { force: true });
});

await step('public/ danebenkopieren', () => {
  cpSync(path.join(ROOT, 'public'), path.join(BUILD_DIR, 'public'), { recursive: true });
});

// platform-tools als echte Dateien daneben statt gebuendelt - adb.exe
// braucht AdbWinApi.dll/AdbWinUsbApi.dll ohnehin als echte Dateien in
// seinem eigenen Verzeichnis (kein Einzeldatei-SEA fuer Drittbinaries).
// lib/config.mjs findet das automatisch (isSea() + Pfad neben der .exe).
await step('platform-tools danebenkopieren', () => {
  cpSync(PLATFORM_TOOLS_CACHE, path.join(BUILD_DIR, 'platform-tools'), {
    recursive: true,
    filter: (src) => !src.endsWith('NOTICE.txt'), // landet stattdessen gesammelt in LICENSES/
  });
});

await step('LICENSES/ zusammenstellen', () => {
  const licensesDir = path.join(BUILD_DIR, 'LICENSES');
  mkdirSync(licensesDir, { recursive: true });
  cpSync(path.join(ROOT, 'assets', 'licenses', 'NOTICE.txt'), path.join(licensesDir, 'NOTICE.txt'));
  cpSync(path.join(ROOT, 'assets', 'licenses', 'APACHE-2.0.txt'), path.join(licensesDir, 'APACHE-2.0.txt'));
  cpSync(path.join(ROOT, 'assets', 'licenses', 'NODEJS-LICENSE.txt'), path.join(licensesDir, 'NODEJS-LICENSE.txt'));
  cpSync(path.join(PLATFORM_TOOLS_CACHE, 'NOTICE.txt'), path.join(licensesDir, 'PLATFORM-TOOLS-NOTICE.txt'));
});

// SEA erbt Nodes CONSOLE-Subsystem - ein Doppelklick auf Landed.exe wuerde
// sonst kurz ein schwarzes Konsolenfenster aufblitzen lassen. PE32+-
// Optional-Header-Layout: Subsystem-Feld (WORD) liegt bei Offset 68 relativ
// zum Optional-Header-Start (e_lfanew + 4 Byte PE-Signatur + 20 Byte COFF-
// Header). 2 = IMAGE_SUBSYSTEM_WINDOWS_GUI statt 3 = ...CONSOLE. Layout an
// der real gebauten Landed.exe verifiziert, bevor dieser Code geschrieben wurde.
await step('PE-Subsystem auf GUI patchen (kein Konsolenfenster)', async () => {
  const buf = readFileSync(EXE_FILE);
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.subarray(peOffset, peOffset + 4).toString('ascii') !== 'PE\0\0') {
    throw new Error('PE-Signatur nicht gefunden - Layout-Annahme stimmt nicht mehr, Patch abgebrochen.');
  }
  const optionalHeaderStart = peOffset + 4 + 20;
  const magic = buf.readUInt16LE(optionalHeaderStart);
  if (magic !== 0x20b) {
    throw new Error(`Unerwartetes PE-Format (Magic 0x${magic.toString(16)}, erwartet PE32+/0x20b) - Patch abgebrochen.`);
  }
  const subsystemOffset = optionalHeaderStart + 68;
  const current = buf.readUInt16LE(subsystemOffset);
  if (current !== 3) {
    throw new Error(`Unerwarteter Subsystem-Wert ${current} (erwartet 3/CUI) - Patch abgebrochen, um nicht blind zu ueberschreiben.`);
  }
  buf.writeUInt16LE(2, subsystemOffset); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  await withRetry(() => writeFileSync(EXE_FILE, buf));
});

// Icon aus assets/landed.ico (siehe tools/make-icon.mjs) + Versionsfelder.
// FileDescription ist keine Kosmetik: das ist der Text, den SmartScreens
// Warndialog bei einer unsignierten Binary anzeigt. Nach dem Subsystem-Patch
// ausgefuehrt und danach erneut auf GUI(2) geprueft (empirisch bestaetigt,
// dass rcedit den Optional-Header-Bereich nicht beruehrt - trotzdem ein
// Assert statt blind zu vertrauen).
await step('Icon + Versionsinfo mit rcedit setzen', async () => {
  await withRetry(() =>
    rcedit(EXE_FILE, {
      icon: ICON_FILE,
      'version-string': {
        FileDescription: 'Landed für Android/Chrome',
        ProductName: 'Landed',
        CompanyName: 'workbench',
        LegalCopyright: 'workbench',
      },
      'file-version': WIN_VERSION,
      'product-version': WIN_VERSION,
    })
  );
  const buf = readFileSync(EXE_FILE);
  const peOffset = buf.readUInt32LE(0x3c);
  const subsystem = buf.readUInt16LE(peOffset + 24 + 68);
  if (subsystem !== 2) {
    throw new Error(`rcedit hat das Subsystem veraendert (jetzt ${subsystem}, erwartet 2/GUI) - Build abgebrochen.`);
  }
});

// Nutzerwunsch 22.08.2026, 1:1 von der Schwester-App LANDED Bookmarks
// uebernommen (dort zuerst gebaut, per Nutzer-Fund nachgebessert - siehe
// lib/tray.mjs fuer die volle Begruendung, warum kein PowerShell-Skript):
// das Systray-Hilfsprogramm ist eine zur Build-Zeit per csc.exe (.NET
// Framework, auf jedem Windows vorhanden - kein SDK-Install, keine
// npm-Abhaengigkeit) kompilierte eigenstaendige .exe. Kein separates,
// manuell aufzurufendes Skript wie tools/make-icon.mjs (dort: Chrome/Edge-
// Rasterisierung, langsam, nur bei Logo-Aenderung noetig) - der Compile hier
// ist ein schneller, deterministischer csc.exe-Aufruf, deshalb bei JEDEM
// Build frisch erzeugt, kein eingechecktes Binary.
const CSC_CANDIDATES = ['Framework64', 'Framework'].map((dir) =>
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', dir, 'v4.0.30319', 'csc.exe')
);

function findCsc() {
  for (const candidate of CSC_CANDIDATES) {
    try {
      statSync(candidate);
      return candidate;
    } catch {
      // naechster Kandidat
    }
  }
  throw new Error(`csc.exe nicht gefunden (geprueft: ${CSC_CANDIDATES.join(', ')}) - .NET Framework 4.x fehlt oder ist beschaedigt.`);
}

await step('Systray-Hilfsprogramm kompilieren (csc.exe)', () => {
  const csc = findCsc();
  execFileSync(csc, [
    '/nologo',
    '/target:winexe',
    `/out:${TRAY_HELPER_OUT}`,
    `/win32icon:${ICON_FILE}`,
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Drawing.dll',
    TRAY_HELPER_SRC,
  ]);
  statSync(TRAY_HELPER_OUT); // csc.exe liefert bei Erfolg trotzdem exit 0 mit leerer Ausgabe - Existenz zusaetzlich hart pruefen
});

await step('Selbsttest: Landed.exe muss starten', async () => {
  const tempDataDir = mkdtempSync(path.join(tmpdir(), 'landed-build-selftest-'));
  await new Promise((resolve, reject) => {
    // Nicht PORT=0 ("freier Port"): config.mjs liest ueber
    // `Number(process.env.PORT) || 7890` - 0 ist falsy in JS, wuerde also
    // still auf den echten Produktions-Port 7890 zurueckfallen und dort
    // kollidieren. Ein hoher, unwahrscheinlicher fester Port umgeht das,
    // ohne die Produktionslogik fuer einen einzigen Testaufrufer anzufassen.
    const child = spawn(EXE_FILE, [], {
      env: { ...process.env, PORT: '18790', LANDED_DATA_DIR: tempDataDir },
      cwd: BUILD_DIR,
    });
    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Kein Startsignal innerhalb von 10s. Ausgabe bisher:\n${output}`));
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('Landed laeuft auf')) {
        clearTimeout(timeout);
        child.kill();
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Landed.exe beendete sich vorzeitig mit Code ${code}. Ausgabe:\n${output}`));
      }
    });
  }).finally(() => withRetry(() => rmSync(tempDataDir, { recursive: true, force: true })));
});

const sizeMb = (statSync(EXE_FILE).size / (1024 * 1024)).toFixed(1);
console.log(`\nFertig: ${EXE_FILE} (${sizeMb} MB)`);
