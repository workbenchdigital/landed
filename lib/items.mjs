import { readFileSync, readdirSync, mkdirSync, appendFileSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config, dataPath, devicePath } from './config.mjs';
import { normalizeUrl, safeDomain } from './store.mjs';

const SCHEMA_VERSION = 2;

// Bis Stufe 5 (Geraete-Umschalter im Header) gibt es genau ein unterstuetztes
// Geraet - devicePath() ist seit Stufe 1.1 verdrahtet, aber niemand ruft die
// Funktionen hier mit einer echten Seriennummer auf. 'default' ist bewusst
// keine Notloesung, sondern der im Migrationsplan vorgesehene Fallback-Bucket.
export const DEFAULT_DEVICE = 'default';

// Terminale Uebergaenge: 'archive'/'drop' verlassen den Item-Bestand in
// Richtung Archiv-Tabelle. 'pc' -> 'done' (Nutzeraktion "erledigt") ebenso,
// aber ohne eigenen Tabschluss-Schritt - siehe markDone().
const ARCHIVE_KIND_BY_STATE = { archive: 'archived', drop: 'dropped' };

// ---------------------------------------------------------------------------
// Speicher: eine SQLite-Datei (node:sqlite, Node-Builtin) statt handgemachter
// JSON-Dateien mit .tmp+rename und eigener writeQueue. Zwei Gruende: echte
// Transaktionen (Item-Aenderung UND der zugehoerige Archiv-Eintrag committen
// gemeinsam oder gar nicht) und kein selbstgebauter Nebenlaeufigkeitsschutz
// mehr - DatabaseSync ist synchron, eine Lese-Aendern-Schreiben-Runde laeuft
// in Node also ununterbrechbar durch (siehe mutate()).
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  device            TEXT NOT NULL,
  normalized_url    TEXT NOT NULL,
  pos               INTEGER NOT NULL,
  url               TEXT NOT NULL,
  title             TEXT,
  domain            TEXT,
  state             TEXT NOT NULL,
  first_seen        TEXT,
  last_seen         TEXT,
  state_changed_at  TEXT,
  snooze_until      TEXT,
  missing_since     TEXT,
  missed_scans      INTEGER,
  closed_at         TEXT,
  note              TEXT,
  duplicate_count   INTEGER,
  duplicate_ids     TEXT NOT NULL DEFAULT '[]',
  seen_before       INTEGER,
  PRIMARY KEY (device, normalized_url)
);
CREATE TABLE IF NOT EXISTS meta (
  device TEXT PRIMARY KEY,
  json   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS archive (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_url TEXT NOT NULL,
  url            TEXT NOT NULL,
  title          TEXT,
  domain         TEXT,
  kind           TEXT,
  device         TEXT,
  at             TEXT,
  first_seen     TEXT,
  note           TEXT,
  search_blob    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS archive_normalized_url ON archive(normalized_url);
`;

// meta bleibt bewusst ein JSON-Feld statt eigener Spalten: genau eine Zeile
// pro Geraet, nie gefiltert oder sortiert, aber offen fuer Zusatzfelder
// (tools/migrate-v2.mjs schreibt z.B. migratedAt). Eigene Spalten waeren hier
// nur Schema-Pflege ohne Gegenwert.

// Pfad mitfuehren, nicht nur das Handle: config.dataDir kann sich zur Laufzeit
// aendern (Tests via withTempData, theoretisch LANDED_DATA_DIR) - sonst
// schriebe der zweite Aufruf noch in die Datei des ersten Verzeichnisses.
let handle = null; // { file, db }

function getDb() {
  const file = dataPath('landed.db');
  if (handle && handle.file === file) return handle.db;
  if (handle) handle.db.close();
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  handle = { file, db };
  // Scheitert die Uebernahme, das Handle wieder wegwerfen: sonst laege beim
  // naechsten Aufruf eine offene, leere Datenbank im Cache und der zweite
  // Versuch waere still erfolgreich - mit leerem Bestand.
  try {
    migrateJsonStore(db);
  } catch (e) {
    closeStore();
    throw e;
  }
  return db;
}

// Nur fuer Tests/Aufraeumen: solange das Handle offen ist, laesst sich das
// Datenverzeichnis unter Windows nicht loeschen (siehe lib/test-helpers.mjs).
export function closeStore() {
  if (!handle) return;
  handle.db.close();
  handle = null;
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function defaultMeta(deviceKey) {
  return {
    serial: deviceKey === DEFAULT_DEVICE ? null : deviceKey,
    label: null,
    lastScan: null,
    lastScanSourceCount: null,
    schema: SCHEMA_VERSION,
  };
}

function rowToItem(row) {
  return {
    url: row.url,
    title: row.title,
    domain: row.domain,
    state: row.state,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    stateChangedAt: row.state_changed_at,
    snoozeUntil: row.snooze_until,
    missingSince: row.missing_since,
    missedScans: row.missed_scans,
    closedAt: row.closed_at,
    note: row.note,
    duplicateCount: row.duplicate_count,
    duplicateIds: JSON.parse(row.duplicate_ids),
    seenBefore: !!row.seen_before,
  };
}

// pos haelt die Einfuegereihenfolge fest, die das frueher gespeicherte
// JSON-Objekt implizit hatte - getItems() liefert dadurch weiter dieselbe
// Reihenfolge wie vor der Umstellung.
function readAll(db, deviceKey) {
  // Object.create(null) statt {}: normalizedUrl kommt bei setNote/setSnooze/
  // setStates/markDone direkt aus dem Request-Body. Auf einem normalen Objekt
  // liefert items['__proto__'] Object.prototype zurueck - der folgende
  // item.note = ... wuerde dann Object.prototype verseuchen, statt sauber
  // "unbekanntes Item" zu melden. Ohne Prototyp gibt es diesen Schluessel
  // schlicht nicht. (Bestand schon vor der SQLite-Umstellung, gleiche Stelle.)
  const items = Object.create(null);
  for (const row of db.prepare('SELECT * FROM items WHERE device = ? ORDER BY pos').all(deviceKey)) {
    items[row.normalized_url] = rowToItem(row);
  }
  const metaRow = db.prepare('SELECT json FROM meta WHERE device = ?').get(deviceKey);
  return { items, meta: metaRow ? JSON.parse(metaRow.json) : defaultMeta(deviceKey) };
}

// Nutzer-Fund (dreimal beobachtet, zuletzt 16.08.2026 nach einem PC-Neustart):
// readAll() lieferte 0 Items, obwohl die Datei auf der Platte den vollen
// Bestand hatte. Ein Neustart des Prozesses zeigte sofort wieder alles.
//
// Was dabei NICHT passiert, entgegen der frueheren Annahme in diesem
// Kommentar: ein Datenverlust. writeAll() loescht per
// "DELETE ... WHERE device = ?" ueber dieselbe Verbindung, die den Snapshot
// gelesen hat. Eine SQLite-Verbindung kann nicht gleichzeitig 0 Zeilen sehen
// und N>0 Zeilen loeschen - sieht die Lesung nichts, trifft das DELETE auch
// nichts. Der Fehler ist also eine falsch leere Anzeige, kein Datenverlust.
// (Empirisch nachgestellt am 16.08.2026; der Bestand ueberlebte unversehrt.)
//
// Die Ursache der leeren Lesung ist bis heute UNBEWIESEN. Ausgeschlossen sind
// inzwischen: ein falsches Datenverzeichnis (es existiert nirgends auf der
// Maschine eine zweite, leere landed.db), WAL-Staleness (kein -wal/-shm, die
// Datenbank laeuft im Default-Journal-Modus) und ein veraendertes File (die
// mtime der DB war ueber den gesamten Fehlerzeitraum unveraendert).
//
// Deshalb hier bewusst KEINE Reparaturautomatik gegen eine geratene Ursache -
// zwei frueher auf Verdacht gebaute Fixes (meta.lastScan als Verdachtssignal,
// dann der blosse Retry) haben den Fehler nicht verhindert. Stattdessen: der
// Retry bleibt (billig, hilft bei einer echten stale Verbindung), und jede
// leere Lesung, hinter der noch Daten stehen, wird vollstaendig protokolliert
// UND nach oben gemeldet - damit das naechste Auftreten die Frage selbst
// beantwortet, statt wieder nur ein Symptombericht zu sein.
function readAllSafe(db, deviceKey) {
  const snapshot = readAll(db, deviceKey);
  if (Object.keys(snapshot.items).length > 0) {
    lastAnomaly = null;
    return { db, items: snapshot.items, meta: snapshot.meta };
  }

  closeStore();
  const freshDb = getDb();
  const retry = readAll(freshDb, deviceKey);
  if (Object.keys(retry.items).length > 0) {
    recordAnomaly(
      `Leere Lesung fuer device="${deviceKey}", nach Neuoeffnen der Verbindung ` +
        `${Object.keys(retry.items).length} Items gefunden. Verbindung war stale.`
    );
    return { db: freshDb, items: retry.items, meta: retry.meta };
  }

  // Auch der zweite Versuch leer. Bevor das als "wirklich leer" durchgeht:
  // nachsehen, ob ueberhaupt noch Zeilen in der Tabelle stehen. Ein leerer
  // Bestand ist ein voellig normaler Zustand (frische Installation, alles
  // archiviert) - verdaechtig ist er nur, wenn daneben Daten liegen.
  const buckets = freshDb.prepare('SELECT device, COUNT(*) n FROM items GROUP BY device').all();
  const total = buckets.reduce((sum, b) => sum + b.n, 0);
  if (total === 0) {
    lastAnomaly = null;
    return { db: freshDb, items: retry.items, meta: retry.meta };
  }

  recordAnomaly(
    `Leere Lesung fuer device="${deviceKey}", die Datenbank enthaelt aber ${total} Items ` +
      `(${buckets.map((b) => `${b.device}=${b.n}`).join(', ')}). Datei: ${dataPath('landed.db')}.`
  );
  return { db: freshDb, items: retry.items, meta: retry.meta };
}

// Letzte erkannte Auffaelligkeit beim Lesen, fuer die Anzeige in der
// Oberflaeche. Bewusst nur im Prozessspeicher: die Meldung beschreibt den
// aktuellen Zustand, nicht die Historie - die steht in anomalies.log.
let lastAnomaly = null;

// Beim Start erkannter Datenbank-Wechsel. Getrennt von lastAnomaly und
// bewusst KLEBEND: ein leerer Bestand setzt lastAnomaly zurueck (das ist ja
// ein legitimer Zustand), wuerde damit aber genau die Warnung loeschen, um
// die es hier geht. Sie bleibt, bis wieder die gewohnte Datenbank darunter
// liegt.
let storeIdentityWarning = null;

export function getLastAnomaly() {
  if (storeIdentityWarning) return { kind: 'identity', detail: storeIdentityWarning };
  if (lastAnomaly) return { kind: 'read', detail: lastAnomaly };
  return null;
}

// Nur fuer Tests: die Warnungen sind bewusst prozessweit und klebend, damit
// sie im Betrieb nicht aus Versehen verschwinden. Zwischen zwei Testfaellen
// muessen sie aber zurueckgesetzt werden, sonst faerbt ein Fall auf den
// naechsten ab (siehe lib/test-helpers.mjs).
export function resetStoreDiagnostics() {
  lastAnomaly = null;
  storeIdentityWarning = null;
}

// ---------------------------------------------------------------------------
// Erkennung eines Datenbank-Wechsels (Nutzer-Fund 17.08.2026, vier Vorfaelle)
//
// Beobachtet: die App startete mit einer frisch angelegten, leeren
// landed.db (32 KB, nur Schema), waehrend die gewohnte Datenbank mit dem
// vollen Bestand woanders lag. Die Oberflaeche zeigte daraufhin eine voellig
// normal aussehende leere Ablage - nicht von "alles archiviert" zu
// unterscheiden. Im konkreten Fall lag es an einer Dateiumleitung (die App
// wurde einmal aus einer Sandbox heraus gestartet), aber der Fehlermodus ist
// allgemeiner: ein anderes Benutzerprofil, ein umgebogenes LANDED_DATA_DIR
// oder ein verschobenes Verzeichnis fuehren zum selben Bild.
//
// Deshalb hier keine Pfad-Pruefung (der Pfad war im beobachteten Fall
// IDENTISCH, nur die Datei dahinter war eine andere), sondern die Identitaet
// der Datei selbst: ihr Erstellungszeitpunkt. Der Merker liegt im
// Programmverzeichnis, nicht im Datenverzeichnis - sonst wanderte er mit
// und koennte den Wechsel gar nicht bemerken.
const STORE_MARKER = 'last-store.json';
const markerPath = () => path.join(config.appDir, STORE_MARKER);

function currentStoreIdentity() {
  // getDb() zuerst, damit die Datei sicher existiert. Ohne das haengt das
  // Ergebnis davon ab, ob vorher schon jemand gelesen hat - genau daran ist
  // die erste Fassung gescheitert: der Server prueft VOR dem ersten Lesen,
  // die Datei war noch nicht angelegt, die Pruefung stieg wirkungslos aus
  // und der Merker wurde anschliessend mit 0 ueberschrieben.
  try {
    getDb();
    return {
      dataDir: config.dataDir,
      dbCreatedAt: statSync(dataPath('landed.db')).birthtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function readMarker() {
  try {
    return JSON.parse(readFileSync(markerPath(), 'utf8'));
  } catch {
    return null; // erster Start oder Merker nicht lesbar
  }
}

// Beim Start aufrufen, BEVOR die Oberflaeche etwas anzeigt. Liefert die
// Warnung (oder null) und haelt sie fuer /api/store-status fest.
export function checkStoreIdentity() {
  const current = currentStoreIdentity();
  const previous = readMarker();
  if (!current || !previous || !previous.dbCreatedAt) return null;
  if (previous.dbCreatedAt === current.dbCreatedAt) return null;
  // Ein Wechsel ist nur dann ein Problem, wenn beim letzten Mal ueberhaupt
  // etwas drin war - sonst ist es schlicht die erste echte Nutzung.
  if (!previous.lastItems) return null;

  storeIdentityWarning =
    `Andere Datenbank als beim letzten Start. Zuletzt: ${previous.lastItems} Items in ` +
    `${previous.dataDir} (angelegt ${previous.dbCreatedAt}). Jetzt: ${current.dataDir} ` +
    `(angelegt ${current.dbCreatedAt}).`;
  recordAnomaly(storeIdentityWarning);
  return storeIdentityWarning;
}

// Nach einem gesunden Start festhalten, womit gearbeitet wurde. Bei
// erkanntem Wechsel bewusst NICHT ueberschreiben: sonst waere die Warnung
// nach einem einzigen Neustart verschwunden, obwohl das Problem bleibt, und
// der Beleg fuer die gewohnte Datenbank waere futsch.
export function rememberStore(itemCount) {
  if (storeIdentityWarning) return;
  const current = currentStoreIdentity();
  if (!current) return;
  // Zweite Sicherung, unabhaengig von der Reihenfolge der Aufrufe: einen
  // belegten Bestand niemals durch eine 0 aus einer ANDEREN Datenbank
  // ersetzen. Sonst loescht genau der erste Fehlstart den Beleg, an dem der
  // naechste Start den Wechsel erkennen wuerde (real passiert beim Testen).
  const previous = readMarker();
  if (previous?.lastItems > 0 && previous.dbCreatedAt !== current.dbCreatedAt && !itemCount) return;
  try {
    writeFileSync(markerPath(), JSON.stringify({ ...current, lastItems: itemCount, at: new Date().toISOString() }, null, 2));
  } catch {
    // Programmverzeichnis nicht beschreibbar - dann eben ohne Erkennung,
    // das darf den Start nicht verhindern.
  }
}

// Doppelt festhalten: im Terminal (Dev) und in einer Datei neben der
// Datenbank (paketierte App hat kein sichtbares Terminal). Das Schreiben
// darf nie den eigentlichen Aufruf scheitern lassen.
function recordAnomaly(message) {
  lastAnomaly = message;
  const line = `${new Date().toISOString()} ${message}\n`;
  console.error(line.trim());
  try {
    appendFileSync(dataPath('anomalies.log'), line, 'utf8');
  } catch {
    // Diagnose-Log ist best effort
  }
}

const INSERT_ITEM = `INSERT INTO items
  (device, normalized_url, pos, url, title, domain, state, first_seen, last_seen,
   state_changed_at, snooze_until, missing_since, missed_scans, closed_at, note,
   duplicate_count, duplicate_ids, seen_before)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

// Kompletter Austausch des Geraetebestands statt Einzel-Updates: die Mutatoren
// arbeiten weiter auf einem einfachen JS-Objekt (unveraenderte Aufrufer,
// unveraenderte Tests), und ein DELETE+INSERT in einer Transaktion ist bei
// dieser Groessenordnung (einige hundert Items) nicht messbar teurer.
// ponytail: erst auf gezielte UPDATEs umbauen, wenn das mal wirklich klemmt.
function writeAll(db, deviceKey, items, meta) {
  db.prepare('DELETE FROM items WHERE device = ?').run(deviceKey);
  const insert = db.prepare(INSERT_ITEM);
  let pos = 0;
  for (const [normalizedUrl, item] of Object.entries(items)) {
    insert.run(
      deviceKey,
      normalizedUrl,
      pos++,
      item.url ?? normalizedUrl,
      item.title ?? null,
      item.domain ?? null,
      item.state ?? 'open',
      item.firstSeen ?? null,
      item.lastSeen ?? null,
      item.stateChangedAt ?? null,
      item.snoozeUntil ?? null,
      item.missingSince ?? null,
      item.missedScans ?? 0,
      item.closedAt ?? null,
      item.note ?? null,
      item.duplicateCount ?? 0,
      JSON.stringify(item.duplicateIds ?? []),
      item.seenBefore ? 1 : 0
    );
  }
  db.prepare('INSERT INTO meta (device, json) VALUES (?, ?) ON CONFLICT(device) DO UPDATE SET json = excluded.json').run(
    deviceKey,
    JSON.stringify(meta)
  );
}

// Einzige Schreib-Primitive fuer Items/Meta. Komplett synchron und komplett in
// EINER Transaktion: Lesen, Mutieren und Schreiben koennen nicht mehr durch
// einen anderen Aufruf unterbrochen werden, deshalb faellt die frueher noetige
// writeQueue/serialized()-Sperre ersatzlos weg. Archiv-Eintraege, die ein
// Mutator nebenbei erzeugt (applyCloseResults, markDone), liegen in derselben
// Transaktion - entweder committen Item-Aenderung und Archiv-Eintrag zusammen
// oder keins von beidem.
function mutate(deviceKey, fn) {
  // readAllSafe() ausserhalb der Transaktion: ein Neuoeffnen der Verbindung
  // (siehe dort) waere innerhalb eines laufenden BEGIN IMMEDIATE ungueltig.
  // db kann sich dadurch gegenueber getDb() oben aendern - die Transaktion
  // unten laeuft bewusst auf dem zurueckgegebenen (ggf. neu geoeffneten) db.
  const { db, items, meta } = readAllSafe(getDb(), deviceKey);
  return tx(db, () => {
    const result = fn(items, meta);
    writeAll(db, deviceKey, items, meta);
    return result;
  });
}

// Exportiert nur noch fuer tools/migrate-v2.mjs, das einen ASYNCHRONEN Mutator
// uebergibt. Der Schnappschuss wird vor dem await gelesen, geschrieben wird
// danach - zwei gleichzeitige Aufrufe wuerden sich also gegenseitig
// ueberschreiben. ponytail: bewusste Decke, der einzige Aufrufer ist ein
// einmaliges CLI ohne Nebenlaeufigkeit; serverseitig laeuft alles ueber
// mutate().
export async function updateItems(deviceKey = DEFAULT_DEVICE, mutator) {
  const db = getDb();
  const { items, meta } = readAll(db, deviceKey);
  const result = await mutator(items, meta);
  tx(db, () => writeAll(db, deviceKey, items, meta));
  return result;
}

export async function getItems(deviceKey = DEFAULT_DEVICE) {
  const { items } = readAllSafe(getDb(), deviceKey);
  return Object.entries(items).map(([normalizedUrl, item]) => ({ normalizedUrl, ...item }));
}

export async function getMeta(deviceKey = DEFAULT_DEVICE) {
  const db = getDb();
  const row = db.prepare('SELECT json FROM meta WHERE device = ?').get(deviceKey);
  return row ? JSON.parse(row.json) : defaultMeta(deviceKey);
}

export async function setDeviceLabel(deviceKey = DEFAULT_DEVICE, label) {
  return mutate(deviceKey, (_items, meta) => {
    meta.label = label || null;
    return { ok: true };
  });
}

// Einmalige Uebernahme: bevor ein Geraet je explizit im Umschalter gewaehlt
// wurde, laufen alle Daten unter DEFAULT_DEVICE (siehe oben). Waehlt der
// Nutzer zum ersten Mal ein echtes Geraet, waere ein leerer Neuanfang unter
// dessen Seriennummer verwirrend - der bestehende Bestand "verschwindet"
// scheinbar. Frueher ein Verzeichnis-Rename, jetzt ein UPDATE der
// device-Spalte in einer Transaktion. Greift nur, wenn das Ziel noch leer ist -
// spaetere Geraete (und ein zweiter Aufruf fuer dasselbe) sind ein No-Op.
export async function adoptDefaultBucket(serial) {
  if (!serial || serial === DEFAULT_DEVICE) return;
  const db = getDb();
  if (!hasDevice(db, DEFAULT_DEVICE)) return;
  if (hasDevice(db, serial)) return;
  tx(db, () => {
    db.prepare('UPDATE items SET device = ? WHERE device = ?').run(serial, DEFAULT_DEVICE);
    db.prepare('UPDATE meta SET device = ? WHERE device = ?').run(serial, DEFAULT_DEVICE);
  });
}

function hasDevice(db, device) {
  return !!db
    .prepare('SELECT 1 AS x FROM items WHERE device = ? UNION ALL SELECT 1 AS x FROM meta WHERE device = ? LIMIT 1')
    .get(device, device);
}

// search_blob wird beim Einfuegen in JS erzeugt und kleingeschrieben: SQLites
// LIKE/lower() sind nur fuer ASCII case-insensitiv, JS' toLowerCase() kann
// Unicode (Umlaute). So bleibt die Suche exakt so treffsicher wie mit dem
// frueheren linearen JSON-Durchlauf, ohne dass jede Suche wieder jede Zeile
// parsen muss.
function archiveBlob(record) {
  return `${record.title ?? ''}\n${record.url ?? ''}\n${record.note ?? ''}`.toLowerCase();
}

const INSERT_ARCHIVE = `INSERT INTO archive
  (normalized_url, url, title, domain, kind, device, at, first_seen, note, search_blob)
  VALUES (?,?,?,?,?,?,?,?,?,?)`;

// Roh, ohne eigene Transaktion - entweder direkt ueber appendArchiveRecords()
// aufgerufen (die eine oeffnet) oder aus einem mutate()-Mutator heraus (der
// schon in einer steckt).
function appendArchiveRaw(db, records) {
  if (!records.length) return;
  const insert = db.prepare(INSERT_ARCHIVE);
  for (const r of records) {
    insert.run(
      r.normalizedUrl,
      r.url,
      r.title ?? null,
      r.domain ?? null,
      r.kind ?? null,
      r.device ?? null,
      r.at ?? null,
      r.firstSeen ?? null,
      r.note ?? null,
      archiveBlob(r)
    );
  }
}

// Fuer Aufrufer ausserhalb einer mutate()-Operation (z.B. Bookmark-
// Archivierung, die keine Items beruehrt).
export async function appendArchiveRecords(records) {
  if (!records.length) return null;
  const db = getDb();
  tx(db, () => appendArchiveRaw(db, records));
  return dataPath('landed.db');
}

// Fuer den seenBefore-Badge: "das hattest du schon mal archiviert/verworfen".
export async function readArchiveIndex() {
  const db = getDb();
  return new Set(db.prepare('SELECT DISTINCT normalized_url AS u FROM archive').all().map((r) => r.u));
}

// LIKE-Sonderzeichen im Suchbegriff maskieren: ohne das wuerde die Suche nach
// "50%" oder "a_b" zu Platzhaltern und mehr treffen als der frueher benutzte
// String.includes(). Der Wert selbst geht immer als Parameter in die Anfrage,
// nie in den SQL-Text.
function likePattern(q) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// includeDropped: Verworfenes ist per Default ausgeblendet - Archiv soll
// sich wie ein Nachschlagewerk anfuehlen, nicht wie ein Papierkorb mit
// Suchfunktion. Die Datensaetze bleiben trotzdem gespeichert (siehe
// applyCloseResults) und sind ueber den Schalter erreichbar, z.B. um zu
// pruefen, ob ein Link schon einmal verworfen wurde.
//
// Sortierung "at DESC, id ASC" bildet das frueher benutzte stabile
// Array.sort() exakt nach: neueste zuerst, bei gleichem Zeitstempel in
// Einfuegereihenfolge.
export async function searchArchive(query, { includeDropped = false } = {}) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT normalized_url, url, title, domain, kind, device, at, first_seen, note
         FROM archive
        WHERE search_blob LIKE ? ESCAPE '\\'
          ${includeDropped ? '' : "AND (kind IS NULL OR kind <> 'dropped')"}
        ORDER BY at DESC, id ASC`
    )
    .all(likePattern(q));
  return rows.map((r) => ({
    normalizedUrl: r.normalized_url,
    url: r.url,
    title: r.title,
    domain: r.domain,
    kind: r.kind,
    device: r.device,
    at: r.at,
    firstSeen: r.first_seen,
    note: r.note,
  }));
}

function newItem(tab, duplicateIds, now, seenBefore) {
  return {
    url: tab.url,
    title: tab.title || '(kein Titel)',
    domain: safeDomain(tab.url),
    state: 'open',
    firstSeen: now,
    lastSeen: now,
    stateChangedAt: now,
    snoozeUntil: null,
    missingSince: null,
    missedScans: 0,
    closedAt: null,
    note: null,
    duplicateCount: duplicateIds.length,
    duplicateIds,
    seenBefore,
  };
}

// Merge statt Replace: ein am Telefon geschlossener Tab ist per Definition
// ueber CDP nicht mehr auffindbar, darf also nicht als "existiert nicht mehr"
// missverstanden werden. Durchgang 1 aktualisiert nur Anwesenheit (nie
// state - das ist Nutzerabsicht, keine Messgroesse). Durchgang 2 markiert
// Abwesenheit NUR bei unentschiedenen Items (state 'open'), ausser bei einem
// verdaechtigen Scan (typisches Symptom eines zwischenzeitlichen Chrome-
// Neustarts, der nicht gerenderte Tabs weglaesst).
//
// Nutzerfrage nach echtem Einsatz: ein Tab, der schon entschieden ist
// (behalten/nur PC/archiviert/verworfen/vorgemerkt), soll nicht "aus
// Versehen verschwinden" koennen, nur weil er unabhaengig am Handy
// geschlossen wurde - sein Schicksal steht ja schon fest, egal ob der Tab
// dort noch lebt. Die eigentliche Synchronisation passiert bewusst ueber
// zwei explizite Aktionen: Scan (holt Neues rein) und "Auf Handy uebertragen"
// (vollzieht die Entscheidung nach - server.mjs closeDecidedHandler
// behandelt "Tab schon weg" bereits als Erfolg, nicht als Fehler). Nur
// unentschiedene ('open') Items profitieren wirklich vom "verschwunden"-
// Signal, weil dort noch keine Entscheidung getroffen wurde, die geschuetzt
// werden muesste.
export async function mergeScan(deviceKey = DEFAULT_DEVICE, tabs) {
  if (!tabs.length) {
    // adb/Chrome-Aussetzer statt "alles weg" - Bestand unangetastet lassen.
    const current = await getItems(deviceKey);
    return { count: current.length, sourceCount: 0, previousSourceCount: null, suspicious: false, aborted: true };
  }

  const archiveIndex = await readArchiveIndex();

  return mutate(deviceKey, (items, meta) => {
    const previousSourceCount = meta.lastScanSourceCount ?? null;
    const suspicious =
      previousSourceCount != null && previousSourceCount >= 20 && tabs.length < previousSourceCount * 0.85;

    const now = new Date().toISOString();
    const seenKeys = new Set();
    const byNormalized = new Map();
    for (const tab of tabs) {
      const key = normalizeUrl(tab.url);
      seenKeys.add(key);
      if (byNormalized.has(key)) byNormalized.get(key).push(tab.id);
      else byNormalized.set(key, [tab.id]);
    }

    for (const [key, duplicateIds] of byNormalized) {
      const tab = tabs.find((t) => normalizeUrl(t.url) === key);
      const existing = items[key];
      if (existing) {
        existing.title = tab.title || existing.title;
        existing.lastSeen = now;
        existing.duplicateCount = duplicateIds.length;
        existing.duplicateIds = duplicateIds;
        existing.missingSince = null;
        existing.missedScans = 0;
        // Tab wieder da: das closedAt-Signal ("keine lebende Kopie mehr")
        // stimmt nicht mehr, sonst wuerde ein spaeteres Schliessen den
        // schon wieder vorhandenen Tab uebersehen.
        if (existing.state === 'pc' && existing.closedAt) existing.closedAt = null;
      } else {
        items[key] = newItem(tab, duplicateIds, now, archiveIndex.has(key));
      }
    }

    if (!suspicious) {
      for (const [key, item] of Object.entries(items)) {
        if (seenKeys.has(key)) continue;
        if (item.state !== 'open') {
          // Entschieden -> geschuetzt. Raeumt zugleich alte missingSince-
          // Eintraege auf, die unter der frueheren (zustandsunabhaengigen)
          // Regel gesetzt wurden, bevor Entscheidungen geschuetzt waren.
          item.missingSince = null;
          item.missedScans = 0;
          continue;
        }
        if (!item.missingSince) item.missingSince = now;
        item.missedScans = (item.missedScans || 0) + 1;
      }
    }

    meta.lastScan = now;
    meta.lastScanSourceCount = suspicious ? previousSourceCount : tabs.length;
    meta.schema = SCHEMA_VERSION;

    return {
      count: Object.keys(items).length,
      sourceCount: tabs.length,
      previousSourceCount,
      suspicious,
    };
  });
}

// Batch-Zustandsaenderung, Analogon zum alten setDecisionsMany. state=null
// (Knopf erneut geklickt -> Umschalten aufgehoben) setzt auf 'open' zurueck,
// den Ausgangszustand nach einem Scan.
export async function setStates(deviceKey = DEFAULT_DEVICE, entries) {
  return mutate(deviceKey, (items) => {
    const now = new Date().toISOString();
    for (const [normalizedUrl, state] of entries) {
      const item = items[normalizedUrl];
      if (!item) continue;
      item.state = state || 'open';
      item.stateChangedAt = now;
    }
    return { ok: true };
  });
}

export async function setNote(deviceKey = DEFAULT_DEVICE, normalizedUrl, note) {
  return mutate(deviceKey, (items) => {
    const item = items[normalizedUrl];
    if (!item) return { ok: false };
    item.note = note || null;
    return { ok: true };
  });
}

// snoozeUntil ist ein Datums-String (YYYY-MM-DD, direkt aus <input type=date>)
// statt eines vollen ISO-Zeitstempels - reicht als Praefix-Vergleich gegen
// new Date().toISOString() lexikographisch korrekt aus (siehe app.js
// isSnoozed()), kein Date-Parsing auf dem Server noetig.
export async function setSnooze(deviceKey = DEFAULT_DEVICE, normalizedUrl, snoozeUntil) {
  return mutate(deviceKey, (items) => {
    const item = items[normalizedUrl];
    if (!item) return { ok: false };
    item.snoozeUntil = snoozeUntil || null;
    return { ok: true };
  });
}

// Nach dem tatsaechlichen Schliessen am Telefon aufgerufen (CDP hat die Tabs
// schon zu, hier nur noch der Item-Store-Uebergang). Nur Items, deren IDs
// ALLE erfolgreich geschlossen wurden, wechseln den Zustand - closedIds kommt
// vom Aufrufer entsprechend gefiltert. Ein Fehlschlag laesst das Item
// vorgemerkt stehen, der naechste Scan sieht den Tab wieder (selbstheilend).
export async function applyCloseResults(deviceKey = DEFAULT_DEVICE, closedNormalizedUrls) {
  const closedSet = new Set(closedNormalizedUrls);
  const db = getDb();
  return mutate(deviceKey, (items, meta) => {
    const now = new Date().toISOString();
    const archiveRecords = [];
    for (const key of closedSet) {
      const item = items[key];
      if (!item) continue;
      if (item.state === 'pc') {
        // Bleibt im Item-Bestand - Arbeitsliste, kein Archiv. Leere
        // duplicateIds signalisieren "keine lebende Kopie, nicht nochmal
        // schliessen versuchen".
        item.closedAt = now;
        item.duplicateIds = [];
        item.duplicateCount = 0;
        continue;
      }
      const kind = ARCHIVE_KIND_BY_STATE[item.state];
      if (!kind) continue; // 'keep'/'open' sollten hier nie ankommen
      archiveRecords.push({
        normalizedUrl: key,
        url: item.url,
        title: item.title,
        domain: item.domain,
        kind,
        device: meta.serial || deviceKey,
        at: now,
        firstSeen: item.firstSeen,
        note: item.note || null,
      });
      delete items[key];
    }
    appendArchiveRaw(db, archiveRecords);
    return { archivedCount: archiveRecords.length };
  });
}

// Nutzeraktion "erledigt" in der PC-Arbeitsliste - kein Tabschluss noetig,
// der Tab ist schon lange zu (closedAt gesetzt).
export async function markDone(deviceKey = DEFAULT_DEVICE, normalizedUrl) {
  const db = getDb();
  return mutate(deviceKey, (items, meta) => {
    const item = items[normalizedUrl];
    if (!item || item.state !== 'pc') return { ok: false };
    const now = new Date().toISOString();
    appendArchiveRaw(db, [
      {
        normalizedUrl,
        url: item.url,
        title: item.title,
        domain: item.domain,
        kind: 'done',
        device: meta.serial || deviceKey,
        at: now,
        firstSeen: item.firstSeen,
        note: item.note || null,
      },
    ]);
    delete items[normalizedUrl];
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Einmalige Uebernahme des alten JSON-Bestands (devices/<serial>/items.json +
// meta.json, archive.jsonl) in die SQLite-Datei. Gleiches Muster wie
// migrateLegacyDataDir() in lib/config.mjs: laeuft nur, wenn das neue Format
// noch komplett leer ist, liest die Altdateien ausschliesslich und loescht
// nichts. Ein zweiter Aufruf ist damit ein No-Op, ein Rollback bedeutet
// schlicht: Code zurueck, landed.db loeschen.
// TODO(2027-02): nach einem Release wieder entfernen, wenn niemand mehr die
// JSON-Struktur hat.
// ---------------------------------------------------------------------------
// Nur "Datei fehlt" ist harmlos. Ein Parse-Fehler oder ein Lesefehler MUSS
// laut werden: eine beschaedigte items.json stillschweigend als "nichts zu
// uebernehmen" zu behandeln wuerde den kompletten Bestand verwerfen und die
// Uebernahme danach als erledigt markieren - genau der Datenverlust, den
// dieser Pfad verhindern soll.
function readJsonFileOrNull(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  return JSON.parse(raw);
}

function migrateJsonStore(db) {
  const { n } = db
    .prepare('SELECT (SELECT COUNT(*) FROM items) + (SELECT COUNT(*) FROM meta) + (SELECT COUNT(*) FROM archive) AS n')
    .get();
  if (n > 0) return; // schon migriert bzw. bereits in Benutzung

  // codemouseai-Review auf PR #26: beide Bloecke fingen vorher JEDEN Fehler ab,
  // nicht nur "Datei/Ordner fehlt" (ENOENT) - ein EACCES/IO-Fehler haette die
  // Uebernahme mit partiellem Bestand durchlaufen lassen, und der naechste
  // Start haette sie wegen n>0 als erledigt uebersprungen. Endgueltiger
  // Verlust des uebersprungenen Teils. Gleiches Prinzip wie readJsonFileOrNull
  // oben: nur ENOENT ist harmlos, alles andere muss laut werden.
  let deviceDirs = [];
  try {
    deviceDirs = readdirSync(dataPath('devices'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // kein devices/-Verzeichnis - frische Installation
  }

  let archiveRaw = null;
  try {
    archiveRaw = readFileSync(dataPath('archive.jsonl'), 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // keine archive.jsonl
  }

  if (!deviceDirs.length && archiveRaw === null) return;

  const archiveRecords = [];
  for (const line of (archiveRaw || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      archiveRecords.push(JSON.parse(line));
    } catch {
      // korrupte/abgeschnittene Zeile (z.B. Absturz mitten im appendFile) - ueberspringen
    }
  }

  let migratedDevices = 0;
  let migratedItems = 0;
  tx(db, () => {
    for (const device of deviceDirs) {
      const items = readJsonFileOrNull(devicePath(device, 'items.json'));
      const meta = readJsonFileOrNull(devicePath(device, 'meta.json'));
      if (!items && !meta) continue;
      writeAll(db, device, items || {}, meta || defaultMeta(device));
      migratedDevices++;
      migratedItems += Object.keys(items || {}).length;
    }
    appendArchiveRaw(db, archiveRecords);
  });

  console.log(
    `Bestand aus JSON nach ${dataPath('landed.db')} uebernommen: ` +
      `${migratedItems} Items aus ${migratedDevices} Geraet(en), ${archiveRecords.length} Archiv-Eintraege. ` +
      `Die Altdateien bleiben unveraendert liegen.`
  );
}
