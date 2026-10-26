import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// LANDED Bookmarks ist eine eigene Installation mit eigenem
// %LOCALAPPDATA%-Verzeichnis, unabhaengig von diesem Programm (config.mjs
// dataDir hier zeigt auf .../Landed, nicht .../LandedBookmarks) - deshalb
// hier bewusst ein eigener, direkter Pfadaufbau statt eine Abhaengigkeit auf
// das andere Repo.
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
const BOOKMARKS_TOKEN_FILE = path.join(LOCAL_APP_DATA, 'LandedBookmarks', 'inbox.token');
const BOOKMARKS_INBOX_URL = 'http://127.0.0.1:7891/api/inbox';

// M6/D5 (LANDED-Bookmarks-Repo, docs/decisions.md 05.09.2026): MSIX
// virtualisiert %LOCALAPPDATA%\LandedBookmarks fuer eine Store-Installation
// vollstaendig - der Pfad oben existiert dort nie, alle Dateien landen
// stattdessen unter %LOCALAPPDATA%\Packages\<PFN>\LocalCache\Local\
// LandedBookmarks\ (empirisch in einer Windows-Sandbox gemessen, W1). PFN
// ("Package Family Name") hat die Form "<Identity-Name>_<Publisher-Hash>" -
// der Name-Teil steht im LANDED-Bookmarks-Manifest fest
// ("workbench.LandedBookmarks"), der Hash-Teil haengt von der erst nach der
// Microsoft-Partner-Center-Registrierung feststehenden Publisher-ID ab und
// ist deshalb NICHT vorab fest verdrahtbar. Ein Praefix-Glob ueber
// %LOCALAPPDATA%\Packages\ umgeht das - der Fix ist damit unabhaengig vom
// tatsaechlichen Einreichungsstatus lauffaehig, nicht erst danach.
const PACKAGES_DIR = path.join(LOCAL_APP_DATA, 'Packages');
const PACKAGE_NAME_PREFIX = 'workbench.LandedBookmarks_';

// Codemouse-Review PR #71: entities.find() (nur der erste Treffer) waere
// falsch gewesen, sobald mehr als ein Ordner mit diesem Praefix existiert
// (Nebeneinander alter/neuer Publisher-Hashes, verwaiste Paketreste nach
// einer Neuinstallation) - genau das ist auf %LOCALAPPDATA%\Packages\ nicht
// ausgeschlossen. Liefert deshalb ALLE Treffer als Kandidatenpfade (leeres
// Array, wenn keiner passt), sortiert nach Ordnername fuer ein
// deterministisches Ergebnis unabhaengig von der readdir()-Reihenfolge des
// Dateisystems - die aufrufende Kandidaten-Schleife (siehe unten) probiert
// sie dann der Reihe nach durch, bis eine tatsaechlich ein lesbares
// inbox.token enthaelt.
async function findPackagedTokenFiles() {
  let entries;
  try {
    entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(PACKAGE_NAME_PREFIX))
    .map((entry) => entry.name)
    .sort()
    .map((name) => path.join(PACKAGES_DIR, name, 'LocalCache', 'Local', 'LandedBookmarks', 'inbox.token'));
}

// Alle moeglichen Installationsformen, in dieser Reihenfolge: zuerst der
// unpaketierte Pfad (Inno-Installer/ZIP - bleibt laut decisions.md der
// Standard- und Fallback-Kanal), dann jeder gefundene MSIX-virtualisierte
// Pfad (Store-Installation). tokenFileCandidates ist injizierbar (ein Array
// statt eines einzelnen Pfads wie bisher) - macht beide aufrufenden
// Funktionen ohne eine echte Installation in beiden Formen testbar (gleiches
// Prinzip wie lib/adb.mjs/lib/cdp.mjs an anderer Stelle in diesem Repo).
async function resolveTokenFileCandidates() {
  return [BOOKMARKS_TOKEN_FILE, ...(await findPackagedTokenFiles())];
}

// Die Existenz EINER der beiden Token-Dateien ist zugleich "ist LANDED
// Bookmarks installiert (in irgendeiner Form) und wurde mindestens einmal
// gestartet" (die jeweilige Datei entsteht beim ersten Serverstart dort,
// siehe LANDED-Bookmarks lib/inbox.mjs ensureInboxToken()).
export async function bookmarksInstalled({ tokenFileCandidates } = {}) {
  const candidates = tokenFileCandidates ?? (await resolveTokenFileCandidates());
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return true;
    } catch {
      // naechster Kandidat
    }
  }
  return false;
}

// Fail-soft: wirft nie. Der Aufrufer (server.mjs closeDecidedHandler) hat das
// Item bereits ins eigene Archiv geschrieben, BEVOR dies aufgerufen wird -
// ein Fehlschlag hier bedeutet "bleibt im Archiv, wurde nicht zusaetzlich
// aufs Board uebertragen", niemals Datenverlust. items = [{url, title}].
//
// ponytail: liest den Token aus dem ERSTEN existierenden Kandidaten, versucht
// bei einem Sendefehler nicht automatisch den naechsten Kandidaten mit
// dessen eigenem Token erneut - der seltene Koexistenz-Fall (beide
// Installationsformen gleichzeitig vorhanden, aber nur eine davon laeuft
// tatsaechlich unter Port 7891) bleibt dann ein Fehlschlag statt eines
// zweiten Versuchs. Durch das ohnehin bestehende Fail-Soft-Verhalten
// (Datensatz bleibt im Archiv) ist das kein Datenverlust, nur ein
// verzoegerter Board-Uebertrag - ein echter Retry-ueber-Kandidaten waere der
// naechste Ausbauschritt, falls sich Koexistenz in der Praxis als haeufiger
// herausstellt als angenommen.
export async function forwardToBookmarks(
  items,
  { tokenFileCandidates, url = BOOKMARKS_INBOX_URL, fetchImpl = fetch } = {}
) {
  if (!items.length) return { ok: true, count: 0 };
  const candidates = tokenFileCandidates ?? (await resolveTokenFileCandidates());
  let token;
  for (const candidate of candidates) {
    try {
      token = (await readFile(candidate, 'utf8')).trim();
      break;
    } catch {
      // naechster Kandidat
    }
  }
  if (token === undefined) return { ok: false, count: 0 }; // nicht installiert oder noch nie gestartet
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Inbox-Token': token },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, count: 0 };
    const data = await res.json();
    return { ok: true, count: data.count ?? items.length };
  } catch {
    return { ok: false, count: 0 }; // Bookmarks nicht erreichbar (nicht gestartet)
  }
}
