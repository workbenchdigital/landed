import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { dataPath } from './config.mjs';

// Ein Ort fuer alle Default-Werte: eine bestehende settings.json aus einer
// aelteren Version kennt neue Felder noch nicht, ohne dieses Zusammenfuehren
// waere wirelessAdbEnabled dort undefined statt false.
const DEFAULTS = {
  setupCompletedAt: null,
  setupVersion: null,
  completedVia: null,
  // Opt-in, standardmaessig AUS. Solange das Flag false ist, verhaelt sich
  // Landed exakt wie zuvor: ausschliesslich USB (siehe lib/adb.mjs
  // pickDevice()). Bewusste Entscheidung des Nutzers, kein Automatismus.
  wirelessAdbEnabled: false,
  // Reine Bequemlichkeit: die zuletzt erfolgreich verbundene ip:port, um das
  // Feld vorzubelegen. KEIN Geheimnis - der Pairing-Code ist einmalig und
  // wird nie gespeichert, den ausgetauschten Schluessel verwaltet adb selbst.
  lastWirelessTarget: null,
};

// Serverseitig statt localStorage: das App-Fenster kann laut Fallback-Kette
// (Stufe 4) auch von Edge statt Chrome geoeffnet werden, und localStorage ist
// pro Browserprofil - der Assistent wuerde sonst pro Browser erneut aufploppen.
async function readSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(await readFile(dataPath('settings.json'), 'utf8')) };
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULTS };
    throw e;
  }
}

export async function getSettings() {
  return readSettings();
}

// Ein Schreibpfad fuer alle Felder statt je Einstellung eine eigene Funktion.
// Kein serialized()-Schutz noetig: wird nur bei expliziten Nutzeraktionen
// aufgerufen (Assistent abschliessen, Schalter umlegen), keine parallelen
// Schreibzugriffe zu erwarten.
export async function updateSettings(patch) {
  const settings = { ...(await readSettings()), ...patch };
  await mkdir(path.dirname(dataPath('settings.json')), { recursive: true });
  await writeFile(dataPath('settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  return settings;
}

// Ueberspringen zaehlt als abgeschlossen (completedVia:'skip') - weniger
// Zustaende, kein Noergeln bei jedem Laden.
export async function completeSetup(completedVia) {
  return updateSettings({
    setupCompletedAt: new Date().toISOString(),
    setupVersion: 1,
    completedVia,
  });
}
