import path from 'node:path';
import { access, cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isSea } from 'node:sea';

// Im gepackten Zustand (Stufe 4) sind server.mjs und alle lib/*.mjs zu EINER
// CJS-Datei gebuendelt und in Landed.exe eingebettet - es gibt kein "lib/"-
// Unterverzeichnis mehr, dessen Elternordner der App-Ordner waere.
// import.meta.url wird durch esbuilds CJS-Bundle zu undefined (empirisch
// geprueft, nicht nur behauptet - haette hier zu einem sofortigen Crash
// gefuehrt). Die Verzweigung ueber isSea() sorgt dafuer, dass dieser Zweig
// dank Kurzschlussauswertung im SEA-Fall nie ausgewertet wird.
const APP_DIR = isSea()
  ? path.dirname(process.execPath)
  : path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const LOCAL_APP_DATA =
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');

// Gebuendelte platform-tools/adb.exe (Stufe 4) neben der .exe, falls
// vorhanden - damit funktioniert die App auch auf einer Maschine ganz ohne
// installiertes ADB. Fehlt der Ordner (z.B. Dev-Modus oder ein Build ohne
// node tools/fetch-platform-tools.mjs), bleibt es bei null und adb.mjs
// faellt auf 'adb' ueber PATH zurueck - unveraendertes Verhalten.
const BUNDLED_ADB = path.join(APP_DIR, 'platform-tools', 'adb.exe');
const bundledAdbPath = isSea() && existsSync(BUNDLED_ADB) ? BUNDLED_ADB : null;

// Einzige Wahrheit fuer Ports, Pfade und Stellschrauben. Ein mutierbares
// Objekt statt Dependency Injection: Tests biegen config.dataDir direkt um
// (lib/test-helpers.mjs), ohne dass jede Funktion einen config-Parameter
// durchreichen muesste - bei der Groesse dieses Projekts der bessere Tausch.
export const config = {
  port: Number(process.env.PORT) || 7890,
  host: '127.0.0.1',
  // eigener CDP-Port, unabhaengig vom Server-Port
  cdpPort: Number(process.env.LANDED_CDP_PORT) || 9222,
  // Reihenfolge: explizite ADB_PATH-Umgebungsvariable -> gebuendelte
  // platform-tools/adb.exe (nur im gepackten Zustand) -> null (adb.mjs
  // faellt dann auf 'adb' ueber PATH zurueck).
  adbPath: process.env.ADB_PATH || bundledAdbPath,
  // null = automatische Auswahl (genau ein per USB verbundenes Geraet noetig,
  // siehe lib/adb.mjs selectDevice()). Fuer Multi-Device (Stufe 5) oder Tests
  // mit mehreren angeschlossenen Geraeten explizit auf eine Seriennummer setzen.
  deviceSerial: process.env.LANDED_DEVICE || null,
  // LOCALAPPDATA statt APPDATA: archive.jsonl und Backups wachsen unbegrenzt
  // und duerfen nicht ins Roaming-Profil synchronisieren.
  dataDir: process.env.LANDED_DATA_DIR || path.join(LOCAL_APP_DATA, 'Landed'),
  publicDir: path.join(APP_DIR, 'public'),
  tabDelayMs: Number(process.env.LANDED_TAB_DELAY_MS) || 300,
  cdpTimeoutMs: 10_000,
  maxBodyBytes: 1 << 20,
};

// Pfade als Funktionen, nicht als beim Import eingefrorene Konstanten - das
// macht sie testbar (config.dataDir laesst sich vor dem Aufruf umbiegen)
// und paketierbar (Installationsverzeichnis ist nicht beschreibbar).
export const dataPath = (...segments) => path.join(config.dataDir, ...segments);
export const devicePath = (serial, ...segments) => dataPath('devices', serial, ...segments);

// Einmalige Uebernahme der Altdaten aus <install>/data (dem frueheren,
// neben dem Quellcode liegenden Speicherort) nach config.dataDir. Greift nur,
// wenn dort noch echte Daten liegen und im neuen Ziel noch keine vorhanden
// sind - kein Ueberschreiben, kein Verlust bei wiederholtem Aufruf.
// TODO(2026-08): nach einem Release wieder entfernen, wenn niemand mehr die
// alte Struktur hat.
export async function migrateLegacyDataDir() {
  const legacyDir = path.join(APP_DIR, 'data');
  const legacyInventory = path.join(legacyDir, 'inventory.json');
  try {
    await access(legacyInventory);
  } catch {
    return; // keine Altdaten - frische Installation
  }
  try {
    await access(dataPath('inventory.json'));
    return; // schon migriert
  } catch {
    // Ziel noch leer - weiter
  }
  await mkdir(config.dataDir, { recursive: true });
  await cp(legacyDir, config.dataDir, { recursive: true });
  console.log(`Alte Daten aus ${legacyDir} nach ${config.dataDir} uebernommen.`);
}
