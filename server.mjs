import http from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSea } from 'node:sea';
import * as adb from './lib/adb.mjs';
import * as cdp from './lib/cdp.mjs';
import * as store from './lib/store.mjs';
import * as items from './lib/items.mjs';
import * as bookmarks from './lib/bookmarks.mjs';
import { bookmarksInstalled, forwardToBookmarks } from './lib/bookmarksHandover.mjs';
import { checkHealth } from './lib/health.mjs';
import { getSettings, completeSetup, updateSettings } from './lib/settings.mjs';
import { openAppWindow, createDesktopShortcut, openInDefaultBrowser } from './lib/launcher.mjs';
import { startTrayIcon } from './lib/tray.mjs';
import { friendlyError, HttpError, badRequest } from './lib/errors.mjs';
import { config, dataPath, migrateLegacyDataDir } from './lib/config.mjs';
import { BY_ID as DECISION_BY_ID } from './public/shared/decisions.mjs';

// Ueber PORT env var umschaltbar, damit eine Testinstanz (z.B. waehrend der
// Entwicklung) nie denselben Port wie die echte, taeglich genutzte Instanz
// belegt - ein Neustart der Testinstanz kann dann die reale Session nicht
// mehr durch einen toten Port unterbrechen. Default 7890, eigener Port fuer
// die Triage-UI, unabhaengig vom CDP-Port 9222.
const PORT = config.port;

const ORIGIN = `http://${config.host}:${PORT}`;
const PUBLIC_DIR = config.publicDir;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

// Schutz gegen CSRF: eine boesartige Webseite koennte sonst per einfachem
// Formular-POST (kein fetch/CORS noetig) echte Tab-Operationen ausloesen,
// solange der Server laeuft. Origin/Referer pruefen reicht, da Browser diese
// Header bei cross-origin POSTs zuverlaessig mitschicken (auch bei simplen
// Formularen, nicht nur fetch) und ein Angreifer sie nicht faelschen kann.
function hasSafeOrigin(req) {
  const origin = req.headers.origin;
  if (origin) return origin === ORIGIN;
  const referer = req.headers.referer;
  if (referer) return referer.startsWith(ORIGIN + '/') || referer === ORIGIN;
  // Weder Origin noch Referer gesetzt - kein Browser-Request (z.B. curl fuer
  // eigene Tests). Fuer ein rein lokales Werkzeug ohne Login akzeptabel.
  return true;
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    // Bislang unbegrenzt gepuffert - eine sehr grosse Anfrage konnte den
    // Speicher des Prozesses fuellen, bevor ueberhaupt geparst wurde.
    if (size > config.maxBodyBytes) throw badRequest('Anfrage zu groß.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks));
  } catch {
    throw badRequest('Ungültiger Request-Body (kein gültiges JSON).');
  }
}

// Diagnosezeile wegschreiben, mit Ausweichort. Schlaegt das Datenverzeichnis
// fehl (Sperre, Rechte, Verzeichnis nicht da), landet die Zeile neben der
// .exe - sonst steht man wie am 16.08.2026 ohne jede Spur da. Nie werfen: ein
// fehlgeschlagenes Protokoll darf den Start nicht verhindern.
async function writeDiagLine(name, line) {
  for (const target of [dataPath(name), path.join(path.dirname(process.execPath), name)]) {
    try {
      await appendFile(target, line, 'utf8');
      return;
    } catch {
      // naechsten Ort versuchen
    }
  }
  console.error(`Diagnosezeile konnte nirgends geschrieben werden: ${line.trim()}`);
}

async function serveStatic(pathname, res) {
  const reqPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// Aktives Geraet fuer den Umschalter im Header (Stufe 5.3). null = wie vor
// Stufe 5: automatische Ein-Geraet-Erkennung, DEFAULT_DEVICE-Bucket - exakt
// das bisherige Verhalten, unveraendert fuer jede Installation, die den
// Umschalter nie anfasst. Bewusst nur im Prozessspeicher (kein settings.json-
// Eintrag): "eine Session zur Zeit" heisst hier auch, dass ein Neustart
// wieder mit der automatischen Erkennung beginnt statt stillschweigend an
// einem laengst nicht mehr angeschlossenen Geraet festzuhalten.
let activeDeviceSerial = null;

// codemouseai-Review auf PR #13: currentDeviceKey() als Live-Lesung des
// veraenderlichen activeDeviceSerial waere innerhalb eines einzelnen Handlers
// mehrfach ausgewertet worden - schaltet der Nutzer waehrend einer laufenden
// Operation (z.B. close-decided ueber viele Tabs mit Pause dazwischen) das
// Geraet um, koennten Lesen und Schreiben auf unterschiedlichen Geraeten
// landen. Root-Cause-Fix statt Einzelfall-Patch: der Dispatcher schnappt
// deviceKey/deviceSerial EINMAL pro Request und reicht sie jedem Handler
// durch - jeder Handler sieht fuer die gesamte Laufzeit denselben Stand,
// unabhaengig davon, wie oft er sie benutzt oder wie lange er laeuft.
function snapshotDevice() {
  const deviceSerial = activeDeviceSerial;
  return { deviceSerial, deviceKey: deviceSerial || items.DEFAULT_DEVICE };
}

async function withAdbSession(fn, deviceSerial) {
  const session = await adb.openSession(deviceSerial);
  try {
    return await fn(session);
  } finally {
    await adb.closeSession();
  }
}

// Streamt Fortschritt als NDJSON (eine JSON-Zeile pro Ereignis), damit die UI
// bei Operationen ueber viele Tabs (mit Rate-Limiting-Pause pro Tab) nicht
// minutenlang ohne Rueckmeldung haengt.
//
// Runde-3-Befund #5: req.on('close') feuert bei JEDER Verbindungs-Beendigung,
// auch bei einem ganz normal durchgelaufenen Request - res.writableEnded
// unterscheidet die beiden Faelle. Nur wenn die Antwort beim Verbindungsende
// noch NICHT fertig geschrieben ist, war es ein echter (Client-seitiger)
// Abbruch, kein regulaeres Fertigwerden. fn() bekommt das AbortSignal
// durchgereicht und laeuft trotzdem bis zum Ende weiter (nicht abgebrochen!)
// - genau das laesst cdp.openMany/closeMany selbst entscheiden, VOR welchem
// Tab sie aufhoeren, und die anschliessenden DB-Schreibvorgaenge (z.B.
// applyCloseResults) sichern, was bis dahin tatsaechlich geklappt hat.
async function streamOperation(req, res, fn, deviceSerial) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
  const write = (obj) => {
    try {
      res.write(JSON.stringify(obj) + '\n');
    } catch {
      // Verbindung ist bereits weg (Client hat abgebrochen) - nichts mehr zu tun
    }
  };
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.on('close', onClose);
  try {
    await withAdbSession((session) => fn(write, session, controller.signal), deviceSerial);
  } catch (err) {
    console.error(err); // volle technische Details im Log, gekuerzte Fassung an den Client
    write({ phase: 'error', message: friendlyError(err) });
  } finally {
    req.off('close', onClose);
    res.end();
  }
}

// ---- Route-Handler ----
// Vertrag: bekommen { req, res, url, body, deviceKey, deviceSerial } - die
// beiden Geraete-Felder sind pro Request einmalig geschnappt (siehe
// snapshotDevice() oben). Geben sie einen Wert zurueck, schickt der
// Dispatcher ihn als 200-JSON. Werfen sie einen HttpError, nimmt der
// Dispatcher dessen status; jeder andere Fehler wird zu 500 + friendlyError.
// Schreiben sie selbst auf res (NDJSON-Streaming, Shutdown), erkennt der
// Dispatcher das an res.headersSent und laesst sie in Ruhe.

async function scanHandler({ deviceKey, deviceSerial }) {
  return withAdbSession(async (session) => {
    const tabs = await cdp.listTabs(session);
    let result = await items.mergeScan(deviceKey, tabs);

    // Nutzer-Feedback nach der v0.3.20-Auslieferung: nach einem USB-
    // Neuanstecken meldete praktisch jeder erste Scan "verdaechtig" - Chrome
    // auf dem Handy braucht nach dem Reconnect oft einen Moment, um wieder
    // alle Tabs ueber CDP zu melden, obwohl sich das Sekunden spaeter von
    // selbst loest. Ein einzelner automatischer Retry (gleiches 1,5s-
    // Wartemuster wie cdp.listTabs() beim ersten Chrome-Start) deckt den
    // Normalfall lautlos ab, bevor der Nutzer ueberhaupt eine Warnung sieht.
    // mergeScan() aendert die Baseline bei einem verdaechtigen Scan bewusst
    // NICHT (siehe dort) - der Retry vergleicht also weiterhin gegen
    // denselben, korrekten Ausgangswert, nicht gegen den kleinen Zwischenstand.
    if (result.suspicious) {
      await cdp.sleep(1500);
      const retryTabs = await cdp.listTabs(session);
      result = await items.mergeScan(deviceKey, retryTabs);
    }

    if (result.aborted) {
      return {
        count: result.count,
        sourceCount: 0,
        previousSourceCount: null,
        warning:
          'Scan lieferte 0 Tabs - vermutlich ein kurzer ADB-/Chrome-Aussetzer. Bestand unverändert gelassen. ' +
          'Am Telefon kurz den Tab-Umschalter öffnen und erneut versuchen.',
      };
    }

    return {
      count: result.count,
      sourceCount: result.sourceCount,
      previousSourceCount: result.previousSourceCount,
      newCount: result.newCount,
      // Warnschwelle: >15% weniger als beim letzten Scan, bei mindestens 20
      // Tabs zuvor - typisches Symptom eines zwischenzeitlichen Chrome-
      // Neustarts, bei dem CDP nicht gerenderte Tabs schlicht weglaesst.
      // Baseline bleibt in diesem Fall unveraendert (siehe mergeScan) -
      // sonst wuerde die Warnung nach genau einem Mal verstummen.
      warning: result.suspicious
        ? `Nur ${result.sourceCount} Tabs gefunden, beim letzten Scan waren es ${result.previousSourceCount}. ` +
          'Vermutlich wurde Chrome zwischenzeitlich neu gestartet und zeigt noch nicht alle Tabs an. ' +
          'Empfehlung: am Telefon kurz den Tab-Umschalter öffnen (zwingt Chrome, alle Tabs zu rendern) und danach erneut einlesen.'
        : null,
    };
  }, deviceSerial);
}

async function itemsHandler({ deviceKey }) {
  return items.getItems(deviceKey);
}

// Meldet, ob die letzte Lesung auffaellig war (0 Items, obwohl die Datenbank
// noch Zeilen enthaelt - siehe readAllSafe in lib/items.mjs). Ohne das sieht
// so ein Fehlerfall in der Oberflaeche exakt aus wie ein leerer Bestand, und
// genau diese Verwechslung hat den Nutzer dreimal glauben lassen, seine Tabs
// seien geloescht worden.
async function storeStatusHandler() {
  return { anomaly: items.getLastAnomaly() };
}

// Das App-Fenster laeuft in einem eigenen Browserprofil (siehe
// lib/launcher.mjs) - ein Klick auf einen Link wuerde dort in einer Chrome-
// Instanz ohne die Anmeldungen des Nutzers landen. Die Oberflaeche schickt
// Links deshalb hierher, und der Server oeffnet sie im Alltagsbrowser.
//
// Die URLs stammen aus eingelesenen Tabs, sind also Fremddaten: strikt auf
// http/https begrenzt, damit ein praeparierter Eintrag nicht ueber file:,
// javascript: oder einen registrierten Protokoll-Handler etwas anderes
// startet als eine Webseite. Die Anzahl ist gedeckelt, weil jeder Eintrag
// einen Prozess startet.
const MAX_OPEN_URLS = 50;

async function openExternalHandler({ body }) {
  const raw = Array.isArray(body.urls) ? body.urls : body.url ? [body.url] : [];
  if (!raw.length) throw badRequest('Keine URL angegeben.');
  if (raw.length > MAX_OPEN_URLS) throw badRequest(`Zu viele Links auf einmal (höchstens ${MAX_OPEN_URLS}).`);

  const safe = raw.map((candidate) => {
    let parsed;
    try {
      parsed = new URL(String(candidate));
    } catch {
      throw badRequest(`Keine gültige URL: ${candidate}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw badRequest(`Nur http/https wird geöffnet, nicht ${parsed.protocol}`);
    }
    return parsed.href;
  });

  for (const url of safe) await openInDefaultBrowser(url);
  return { opened: safe.length };
}

// Fuer die "zuletzt eingelesen"-Anzeige beim Laden der Seite - ohne das zeigt
// die UI nach einem Reload "noch nicht eingelesen", obwohl bereits ein
// Bestand vorliegt (der Zeitstempel wurde bisher nur direkt nach einem
// frischen Scan angezeigt, nicht aus gespeicherten Daten geladen).
async function scanMetaHandler({ deviceKey }) {
  const meta = await items.getMeta(deviceKey);
  const recentDoneCount = await items.getRecentArchiveCount(7);
  if (!meta.lastScan) return { recentDoneCount };
  return { sourceCount: meta.lastScanSourceCount, timestamp: meta.lastScan, recentDoneCount };
}

async function bookmarkFoldersHandler() {
  return bookmarks.listBookmarkFolders();
}

async function bookmarkCheckHandler({ body, deviceKey }) {
  if (!body.folderId) throw badRequest('Kein Ordner ausgewählt.');

  const [bookmarkTabs, inventory] = await Promise.all([
    bookmarks.getFolderUrls(body.folderId),
    items.getItems(deviceKey),
  ]);
  const knownUrls = new Set(inventory.map((item) => item.normalizedUrl));
  const onlyInBookmarks = bookmarkTabs
    .map((t) => ({ ...t, normalizedUrl: store.normalizeUrl(t.url) }))
    .filter((t) => !knownUrls.has(t.normalizedUrl));

  return {
    bookmarkCount: bookmarkTabs.length,
    onlyInBookmarksCount: onlyInBookmarks.length,
    onlyInBookmarks,
  };
}

async function bookmarkArchiveHandler({ body }) {
  // Unabhaengig vom Item-Store: Bookmark-Tabs muessen nicht gescannt worden
  // sein, um archiviert werden zu koennen. firstSeen = at, da unbekannt.
  //
  // wb-audit-Folgefund: title kam bisher ungeprueft vom Client. Fehlt es,
  // landet title: undefined in archive.jsonl - searchArchive ruft
  // r.title.toLowerCase() OHNE Null-Check auf, das waere dann ein
  // TypeError bei JEDER folgenden Archivsuche (Endpunkt bisher vom Frontend
  // nicht aufgerufen, daher bislang nur latent). Gleicher Fallback wie
  // newItem() in lib/items.mjs.
  const now = new Date().toISOString();
  const records = (body.items || []).map((t) => ({
    normalizedUrl: store.normalizeUrl(t.url),
    url: t.url,
    title: t.title || '(kein Titel)',
    domain: store.safeDomain(t.url),
    kind: 'archived',
    device: null,
    at: now,
    firstSeen: now,
  }));
  const archiveFile = await items.appendArchiveRecords(records);
  return { archivedCount: records.length, archiveFile };
}

// Trust-Boundary: entries kommt direkt vom Client. Ohne Pruefung koennte ein
// Tippfehler oder ein kuenftiger UI-Bug einen unbekannten state persistieren,
// der dann in keinem der Filter (DECISION_BY_ID[state]?.closesTab etc.)
// auftaucht - das Item waere weder schliessbar noch wiederherstellbar,
// bliebe aber unsichtbar in items.json stecken.
function assertValidEntries(entries) {
  if (!Array.isArray(entries)) throw badRequest('entries muss ein Array sein.');
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw badRequest('Jeder Eintrag muss [normalizedUrl, state] sein.');
    }
    const [normalizedUrl, state] = entry;
    if (typeof normalizedUrl !== 'string' || !normalizedUrl) {
      throw badRequest('Ungültige normalizedUrl.');
    }
    if (state !== null && !DECISION_BY_ID[state]) {
      throw badRequest(`Unbekannter Zustand: ${state}`);
    }
  }
}

async function decisionsHandler({ body, deviceKey }) {
  const entries = body.entries || [];
  assertValidEntries(entries);
  await items.setStates(deviceKey, entries);
  return { ok: true };
}

async function pcDoneHandler({ body, deviceKey }) {
  if (!body.normalizedUrl) throw badRequest('Keine URL angegeben.');
  const result = await items.markDone(deviceKey, body.normalizedUrl);
  if (!result.ok) throw badRequest('Item nicht in der PC-Arbeitsliste gefunden.');
  return result;
}

// Uebergabe an LANDED Bookmarks direkt aus "Am PC" heraus - Nutzer-Korrektur
// zur urspruenglichen Board-Entscheidung (die nur beim erstmaligen Sichten
// verfuegbar war): auch ein bereits einsortierter "Am PC"-Tab soll sich noch
// umentscheiden lassen. Gleicher Archiv-Uebergang wie pcDoneHandler
// (kind:'board' statt 'done'), gleiches Fail-soft-Verhalten wie
// closeDecidedHandler - schlaegt forwardToBookmarks fehl, bleibt der Tab
// trotzdem im Archiv stehen, kein Datenverlust.
async function pcSendToBoardHandler({ body, deviceKey }) {
  if (!body.normalizedUrl) throw badRequest('Keine URL angegeben.');
  const result = await items.markDone(deviceKey, body.normalizedUrl, 'board');
  if (!result.ok) throw badRequest('Item nicht in der PC-Arbeitsliste gefunden.');
  const boardForward = await forwardToBookmarks([{ url: result.url, title: result.title }]);
  return { ok: true, boardForward };
}

// Runde-3-Befund #3/#4: Gegenstueck zu pcDoneHandler - macht "Erledigt"
// rueckgaengig, solange kein neuerer Scan dieselbe URL schon wieder angelegt
// hat. Kein separates Item-Vorhandensein-Check hier: items.undoMarkDone()
// gibt ok:false in genau diesem Fall zurueck.
async function pcUndoDoneHandler({ body, deviceKey }) {
  if (!body.normalizedUrl) throw badRequest('Keine URL angegeben.');
  const result = await items.undoMarkDone(deviceKey, body.normalizedUrl);
  if (!result.ok) throw badRequest('Konnte nicht rückgängig gemacht werden - möglicherweise inzwischen neu eingescannt.');
  return result;
}

// "Zurueck aufs Telefon": oeffnet den Tab wieder live UND wechselt den
// Zustand auf 'keep' - sonst wuerde der naechste "Schliessen"-Durchlauf
// (state 'pc' hat closesTab:true) ihn sofort wieder zumachen. Item-Pruefung
// VOR withAdbSession: sonst wuerde schon eine ADB-Session fuer ein
// unbekanntes oder falsch-zustaendiges Item geoeffnet, bevor der eigentliche
// Fehler ueberhaupt erkannt wird - unnoetiger Hardware-Zugriff fuer einen
// Request, der ohnehin mit 400 endet.
async function pcReturnHandler({ body, deviceKey, deviceSerial }) {
  if (!body.normalizedUrl) throw badRequest('Keine URL angegeben.');
  const inventory = await items.getItems(deviceKey);
  const item = inventory.find((i) => i.normalizedUrl === body.normalizedUrl);
  if (!item) throw badRequest('Unbekanntes Item.');
  if (item.state !== 'pc') throw badRequest('Item ist nicht in der PC-Arbeitsliste.');
  return withAdbSession(async (session) => {
    await cdp.openMany(session, [item.url]);
    await items.setStates(deviceKey, [[body.normalizedUrl, 'keep']]);
    return { ok: true };
  }, deviceSerial);
}

// Sammel-Fassung von pcReturnHandler fuer die Mehrfachauswahl in "Am PC":
// EINE ADB-Session fuer die ganze Auswahl statt einer pro Item - adb.mjs
// haelt ohnehin nur eine Session gleichzeitig, N Einzelaufrufe wuerden sich
// nur nacheinander abarbeiten lassen, aber mit N mal Session-Auf-/Abbau statt
// einmal. Gleiches Muster wie restoreHandler: results-Array im selben Format
// wie cdp.openMany liefert, damit runStep() im Frontend unveraendert bleibt.
//
// Items, die nicht (mehr) in der PC-Arbeitsliste stehen, werden gefiltert
// statt die ganze Anfrage abzulehnen - anders als beim Einzelitem (das dort
// sofort ein 400 verdient) waere ein einzelner Ausreisser in einer 60er-
// Auswahl kein Grund, gar nichts zu tun.
// Hoeher als MAX_OPEN_URLS (50) oben: cdp.openMany drosselt ohnehin selbst
// (config.tabDelayMs zwischen jedem Tab), eine Rafter-Reviewfrage war deshalb
// nicht Missbrauchsschutz, sondern eine schlicht fehlende Grenze. 50 waere
// hier aber zu niedrig gewesen - die groesste Domain-Gruppe im echten Bestand
// (github.com) hat 67 Eintraege, und genau "eine ganze Gruppe zurueckholen"
// ist der Anwendungsfall, fuer den dieser Endpunkt gebaut wurde.
const MAX_BULK_RETURN = 200;

async function pcBulkReturnHandler({ req, body, res, deviceKey, deviceSerial }) {
  const urls = Array.isArray(body.normalizedUrls) ? body.normalizedUrls : [];
  if (!urls.length) throw badRequest('Keine URLs angegeben.');
  if (urls.length > MAX_BULK_RETURN) throw badRequest(`Zu viele Tabs auf einmal (höchstens ${MAX_BULK_RETURN}).`);
  const inventory = await items.getItems(deviceKey);
  const byUrl = new Map(inventory.map((i) => [i.normalizedUrl, i]));
  const targets = urls.map((u) => byUrl.get(u)).filter((item) => item?.state === 'pc');
  if (!targets.length) throw badRequest('Keine passenden Items in der PC-Arbeitsliste gefunden.');

  return streamOperation(req, res, async (write, session, signal) => {
    write({ phase: 'start', total: targets.length });
    const results = await cdp.openMany(
      session,
      targets.map((t) => t.url),
      { onProgress: (done, total) => write({ phase: 'progress', done, total }), signal }
    );
    const successUrls = targets.filter((_, i) => results[i]?.success).map((t) => t.normalizedUrl);
    if (successUrls.length) {
      await items.setStates(deviceKey, successUrls.map((u) => [u, 'keep']));
    }
    write({ phase: 'done', total: targets.length, results });
  }, deviceSerial);
}

async function noteHandler({ body, deviceKey }) {
  if (!body.normalizedUrl) throw badRequest('Keine URL angegeben.');
  const result = await items.setNote(deviceKey, body.normalizedUrl, body.note);
  if (!result.ok) throw badRequest('Unbekanntes Item.');
  return result;
}

async function searchHandler({ url }) {
  const includeDropped = url.searchParams.get('includeDropped') === '1';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  const results = await items.searchArchive(url.searchParams.get('q'), { includeDropped, limit, offset });
  return { results };
}

async function snoozeHandler({ body, deviceKey }) {
  if (!body.normalizedUrl) throw badRequest('Keine URL angegeben.');
  const result = await items.setSnooze(deviceKey, body.normalizedUrl, body.snoozeUntil || null);
  if (!result.ok) throw badRequest('Unbekanntes Item.');
  return result;
}

async function restoreHandler({ req, res, deviceKey, deviceSerial }) {
  return streamOperation(req, res, async (write, session, signal) => {
    const keepers = (await items.getItems(deviceKey)).filter((item) => item.state === 'keep');
    const before = await cdp.listTabs(session);
    const backupFile = await store.saveBackup(`pre_restore_${Date.now()}`, before);
    // Gleiches Muster wie closeDecidedHandler unten: die frische Tab-Liste
    // (ohnehin schon fuers Backup geholt) sagt, welche Keeper am Handy
    // bereits offen sind - die werden uebersprungen. Ohne das erzeugte jeder
    // Aufruf von "Auf Handy uebertragen" einen zweiten Tab fuer jeden Link,
    // der ohnehin schon offen war (openMany erstellt bedingungslos ein neues
    // Target pro URL).
    const liveUrls = new Set(before.map((t) => store.normalizeUrl(t.url)));
    const toOpen = keepers.filter((k) => !liveUrls.has(k.normalizedUrl));
    write({ phase: 'start', total: toOpen.length, backupFile });
    const results = await cdp.openMany(
      session,
      toOpen.map((k) => k.url),
      { onProgress: (done, total) => write({ phase: 'progress', done, total }), signal }
    );
    write({ phase: 'done', total: toOpen.length, results });
  }, deviceSerial);
}

async function closeDecidedHandler({ req, res, deviceKey, deviceSerial }) {
  return streamOperation(req, res, async (write, session, signal) => {
    const inventory = await items.getItems(deviceKey);
    // Ueber BY_ID.closesTab statt fest verdrahteter Strings - ein weiterer
    // Zustand mit closesTab:true landet automatisch hier, ohne diese Datei
    // anzufassen. duplicateIds.length>0 filtert bereits geschlossene
    // pc-Items raus (leere duplicateIds = kein lebender Tab, nichts zu tun).
    const toClose = inventory.filter(
      (item) => DECISION_BY_ID[item.state]?.closesTab && item.duplicateIds.length > 0
    );
    const before = await cdp.listTabs(session);
    const backupFile = await store.saveBackup(`pre_close_${Date.now()}`, before);
    // Veraltete CDP-IDs: die in items.json gespeicherten duplicateIds stammen
    // vom letzten Scan und werden ungueltig, sobald Chrome am Handy
    // zwischenzeitlich neu gestartet wurde (z.B. nach "offline" entscheiden,
    // Handy einstecken, uebertragen). before ist ohnehin schon fuer das
    // Backup geholt - hier zusaetzlich genutzt, um die Ziel-IDs frisch ueber
    // normalizeUrl aufzuloesen statt den gespeicherten IDs zu vertrauen.
    // Kein lebender Tab mehr fuer eine URL (ids.length === 0) zaehlt als
    // Erfolg: am Handy ist ohnehin nichts mehr offen, dasselbe Ergebnis wie
    // ein erfolgreiches Schliessen.
    const liveIdsByUrl = new Map();
    for (const tab of before) {
      const key = store.normalizeUrl(tab.url);
      if (liveIdsByUrl.has(key)) liveIdsByUrl.get(key).push(tab.id);
      else liveIdsByUrl.set(key, [tab.id]);
    }
    const closeTargets = toClose.map((item) => ({ item, ids: liveIdsByUrl.get(item.normalizedUrl) || [] }));
    const allIds = closeTargets.flatMap((t) => t.ids);
    write({ phase: 'start', total: allIds.length, backupFile });
    const results = await cdp.closeMany(session, allIds, {
      onProgress: (done, total) => write({ phase: 'progress', done, total }),
      signal,
    });
    const successById = new Map(results.map((r) => [r.id, r.success]));
    const closedNormalizedUrls = closeTargets
      .filter((t) => t.ids.length === 0 || t.ids.every((id) => successById.get(id)))
      .map((t) => t.item.normalizedUrl);
    const { archivedCount } = await items.applyCloseResults(deviceKey, closedNormalizedUrls);
    // Uebergabe an LANDED Bookmarks: unabhaengig vom CDP-Schliessergebnis am
    // Handy (der Nutzer hat "Board" entschieden - der Link soll dort landen,
    // auch wenn der Tab dort zufaellig schon weg war). applyCloseResults hat
    // das Item oben bereits archiviert (kind:'board') - ein Fehlschlag hier
    // aendert daran nichts, siehe forwardToBookmarks()-Doku.
    const boardItems = toClose.filter((item) => item.state === 'board');
    const boardForward = await forwardToBookmarks(
      boardItems.map((item) => ({ url: item.url, title: item.title }))
    );
    write({ phase: 'done', total: allIds.length, results, archivedCount, boardForward: { ...boardForward, attempted: boardItems.length } });
  }, deviceSerial);
}

// Erlaubte Transportarten fuer die Geraeteauswahl - dieselbe Policy wie in
// lib/adb.mjs pickDevice(): standardmaessig nur USB, drahtlos ausschliesslich
// bei ausdruecklich aktiviertem Opt-in.
async function wirelessAllowed() {
  return (await getSettings()).wirelessAdbEnabled === true;
}

function isSelectable(device, allowWireless) {
  return device.state === 'device' && (allowWireless || device.transport === 'usb');
}

// Bewusst POST statt GET, aus demselben Grund wie /api/health direkt darunter:
// "adb devices -l" startet bei Bedarf selbst den adb-Daemon - eine echte
// Nebenwirkung, die nicht hinter einer GET-Sonde ausserhalb des CSRF-Gates
// stehen darf.
async function devicesHandler() {
  const [all, allowWireless] = await Promise.all([adb.listDevices(), wirelessAllowed()]);
  const ready = all.filter((d) => isSelectable(d, allowWireless));
  const devices = await Promise.all(
    ready.map(async (d) => ({
      serial: d.serial,
      model: d.model,
      transport: d.transport,
      label: (await items.getMeta(d.serial)).label,
    }))
  );
  return { devices, active: activeDeviceSerial };
}

// Nur bereits verbundene Geraete waehlbar - verhindert, dass eine erfundene
// Seriennummer stillschweigend eine leere devices/<serial>/-Struktur anlegt
// (adoptDefaultBucket wuerde sonst sogar den Altbestand dorthin verschieben,
// obwohl das Geraet nie existiert hat).
async function selectDeviceHandler({ body }) {
  if (!body.serial) throw badRequest('Keine Seriennummer angegeben.');
  const [all, allowWireless] = await Promise.all([adb.listDevices(), wirelessAllowed()]);
  const match = all.find((d) => d.serial === body.serial && isSelectable(d, allowWireless));
  if (!match) throw badRequest(allowWireless ? 'Gerät nicht verbunden.' : 'Gerät nicht per USB verbunden.');
  await items.adoptDefaultBucket(body.serial);
  activeDeviceSerial = body.serial;
  return { ok: true, active: activeDeviceSerial };
}

// ---- Drahtlose Verbindung (Opt-in) ----
// Reihenfolge wie am Telefon: einmalig koppeln (Pairing-Port + 6-stelliger
// Code aus dem Dialog "Gerät mit Kopplungscode koppeln"), danach jedes Mal
// verbinden (Verbindungsport aus der Wireless-Debugging-Uebersicht).
// Beides nur mit gesetztem Flag - ohne Opt-in gibt es keinen Weg, ueber
// Landed eine drahtlose Verbindung aufzubauen.
async function assertWirelessEnabled() {
  if (!(await wirelessAllowed())) {
    throw badRequest('Drahtlose Verbindung ist ausgeschaltet. Erst in der Einrichtung aktivieren.');
  }
}

// Fehleingabe (IP/Port/Code) ist ein 400 mit klarem Text; ein Fehlschlag von
// adb selbst bleibt ein 500 mit friendlyError, wie bei jeder anderen
// Hardware-Operation auch.
function validTargetOr400(ip, port, code) {
  try {
    return adb.wirelessTarget(ip, port, code);
  } catch (e) {
    throw badRequest(e.message);
  }
}

async function wirelessPairHandler({ body }) {
  await assertWirelessEnabled();
  validTargetOr400(body.ip, body.port, body.code);
  // Der Code wird nur durchgereicht, nie gespeichert - auch der Pairing-Port
  // nicht, den zeigt das Telefon je Kopplung neu an.
  const message = await adb.pairWireless(body.ip, body.port, body.code);
  return { ok: true, message };
}

async function wirelessConnectHandler({ body }) {
  await assertWirelessEnabled();
  validTargetOr400(body.ip, body.port);
  const { target, message } = await adb.connectWireless(body.ip, body.port);
  await updateSettings({ lastWirelessTarget: target });
  return { ok: true, target, message };
}

async function wirelessSettingHandler({ body }) {
  if (typeof body.enabled !== 'boolean') throw badRequest('enabled muss true oder false sein.');
  return updateSettings({ wirelessAdbEnabled: body.enabled });
}

async function deviceLabelHandler({ body }) {
  if (!body.serial) throw badRequest('Keine Seriennummer angegeben.');
  await items.setDeviceLabel(body.serial, body.label || null);
  return { ok: true };
}

// Bewusst POST statt GET: /api/* laeuft durch das CSRF-Gate (hasSafeOrigin),
// eine GET-Sonde stuende ausserhalb davon, haette aber echte Nebenwirkungen
// (adb-Daemon starten, tcp:9222 oeffnen) - von jeder beliebigen Webseite aus
// auf einen einfachen <img src>/fetch hin auslösbar. Liefert immer 200, der
// Zustand steht im Body (siehe lib/health.mjs).
async function healthHandler() {
  return checkHealth();
}

async function settingsHandler() {
  const settings = await getSettings();
  // 'auto' wird bei jedem Abruf frisch aufgeloest (Existenz der Bookmarks-
  // Token-Datei) statt einmalig gespeichert - installiert der Nutzer
  // Bookmarks spaeter, taucht die fuenfte Entscheidung ohne Neustart oder
  // Einstellungsaenderung beim naechsten Laden von selbst auf.
  const showBoardDecision = settings.showBoardDecision === 'auto' ? await bookmarksInstalled() : !!settings.showBoardDecision;
  return { ...settings, showBoardDecision };
}

async function settingsCompleteHandler({ body }) {
  const via = body.completedVia === 'skip' ? 'skip' : 'wizard';
  return completeSetup(via);
}

async function createShortcutHandler() {
  try {
    const shortcutPath = await createDesktopShortcut();
    return { ok: true, shortcutPath };
  } catch (e) {
    throw badRequest(e.message);
  }
}

async function shutdownHandler({ res }) {
  json(res, 200, { ok: true });
  // Windows kann einen ohne Konsolenfenster gestarteten Node-Prozess nicht
  // per taskkill graceful signalisieren (kein Empfaenger fuer WM_CLOSE) -
  // deshalb hier ueber den eigenen HTTP-Server statt ueber ein OS-Signal.
  setImmediate(() => {
    // forceClose() statt closeSession(): raeumt sofort auf, unabhaengig vom
    // Refcount - relevant, falls der Shutdown mitten in einer verschachtelten
    // Operation ankommt.
    adb.forceClose().catch(() => {}).finally(() => process.exit(0));
  });
}

const routes = {
  'POST /api/scan': scanHandler,
  'GET /api/items': itemsHandler,
  'GET /api/store-status': storeStatusHandler,
  'POST /api/open-external': openExternalHandler,
  'GET /api/scan-meta': scanMetaHandler,
  'GET /api/search': searchHandler,
  'GET /api/bookmark-folders': bookmarkFoldersHandler,
  'POST /api/bookmark-check': bookmarkCheckHandler,
  'POST /api/bookmark-archive': bookmarkArchiveHandler,
  'POST /api/decisions': decisionsHandler,
  'POST /api/pc/done': pcDoneHandler,
  'POST /api/pc/send-to-board': pcSendToBoardHandler,
  'POST /api/pc/undo-done': pcUndoDoneHandler,
  'POST /api/pc/return': pcReturnHandler,
  'POST /api/pc/bulk-return': pcBulkReturnHandler,
  'POST /api/note': noteHandler,
  'POST /api/snooze': snoozeHandler,
  'POST /api/restore': restoreHandler,
  'POST /api/close-decided': closeDecidedHandler,
  'POST /api/health': healthHandler,
  'POST /api/devices': devicesHandler,
  'POST /api/devices/select': selectDeviceHandler,
  'POST /api/devices/label': deviceLabelHandler,
  'POST /api/wireless/pair': wirelessPairHandler,
  'POST /api/wireless/connect': wirelessConnectHandler,
  'GET /api/settings': settingsHandler,
  'POST /api/settings/complete': settingsCompleteHandler,
  'POST /api/settings/wireless': wirelessSettingHandler,
  'POST /api/create-shortcut': createShortcutHandler,
  'POST /api/shutdown': shutdownHandler,
};

const requestHandler = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // CSRF-Gate auf jede veraendernde Methode statt nur POST - heute nutzt
  // die App ausschliesslich GET/POST, aber ein Wort jetzt verhindert eine
  // Luecke, sobald mal eine PUT/DELETE-Route dazukommt.
  const isMutating = req.method !== 'GET' && req.method !== 'HEAD';

  if (isMutating && url.pathname.startsWith('/api/') && !hasSafeOrigin(req)) {
    return json(res, 403, { error: 'Anfrage von unbekanntem Ursprung abgelehnt.' });
  }

  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) {
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
    const allowed = ['GET', 'POST'].filter((m) => routes[`${m} ${url.pathname}`]);
    if (allowed.length) {
      res.writeHead(405, { Allow: allowed.join(', '), 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Methode nicht erlaubt.' }));
      return;
    }
    return json(res, 404, { error: 'Unbekannter Endpunkt' });
  }

  try {
    const body = isMutating ? await readBody(req) : {};
    const result = await handler({ req, res, url, body, ...snapshotDevice() });
    if (!res.headersSent && result !== undefined) json(res, 200, result);
  } catch (err) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    console.error(err); // volle technische Details im Log, gekuerzte Fassung an den Client
    json(res, 500, { error: friendlyError(err) });
  }
};

export function createServer() {
  return http.createServer(requestHandler);
}

// Nebenwirkungsfreier Check "laeuft hier schon ein echtes Landed" - fuer die
// Einzelinstanz-Erkennung unten UND fuer "--stop". /api/scan-meta antwortet
// immer 200, beruehrt keine Hardware, ist also risikolos als reiner Existenz-Test.
async function probeExistingInstance() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/scan-meta`);
    return res.ok;
  } catch {
    return false;
  }
}

// Nur beim direkten Start (node server.mjs) tatsaechlich lauschen - Tests
// importieren createServer() und binden selbst auf einen freien Port (0),
// ohne Cleanup-Handler oder Altdaten-Migration auszuloesen.
// isSea() zuerst und per Kurzschlussauswertung: im gepackten Zustand ist
// import.meta.url durch das esbuild-CJS-Bundle undefined (empirisch
// geprueft), fileURLToPath(undefined) wuerde sonst hier abstuerzen, noch
// bevor der Server ueberhaupt lauscht. Als SEA gibt es ohnehin kein
// "importiert statt direkt gestartet"-Szenario - immer durchstarten.
// IIFE statt Top-Level-await: esbuilds CJS-Ausgabe (Stufe 4, fuer die SEA)
// unterstuetzt kein Top-Level-await, CJS kennt kein asynchrones Modul-
// Laden. Verhalten bleibt identisch, nur die Syntaxform aendert sich.
if (isSea() || process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    // Ersetzt stop-app.bat: kein PID-File/taskkill mehr noetig, der laufende
    // Prozess raeumt sich ueber seinen eigenen /api/shutdown-Endpunkt auf.
    if (process.argv.includes('--stop')) {
      const wasRunning = await probeExistingInstance();
      if (wasRunning) await fetch(`http://127.0.0.1:${PORT}/api/shutdown`, { method: 'POST' }).catch(() => {});
      console.log(wasRunning ? 'Landed wurde beendet.' : 'Keine laufende Instanz gefunden.');
      process.exit(0);
    }

    adb.registerCleanupHandlers();

    // Einmalige Uebernahme der Altdaten aus <install>/data, falls noch vorhanden -
    // muss vor dem ersten Zugriff auf config.dataDir passieren (z.B. vor einem Scan).
    // Siehe lib/config.mjs fuer Details und Bedingungen.
    await migrateLegacyDataDir();

    const server = createServer();

    server.on('error', async (err) => {
      // Einzelinstanz ueber EADDRINUSE statt PID-Datei: Port schon belegt UND
      // eine echte Landed-Antwort dahinter -> kein Fehler, nur das Fenster
      // eines zweiten Doppelklicks auf die Verknuepfung oeffnen und beenden.
      // Nur im gepackten Zustand - im Dev-Modus soll ein belegter Port
      // weiterhin sichtbar fehlschlagen.
      if (isSea() && err.code === 'EADDRINUSE' && (await probeExistingInstance())) {
        await openAppWindow(`http://127.0.0.1:${PORT}`);
        process.exit(0);
      }
      console.error('Serverstart fehlgeschlagen:', err.message);
      process.exit(1);
    });

    server.listen(PORT, config.host, async () => {
      console.log(`Landed laeuft auf http://127.0.0.1:${PORT}`);
      // Nutzer-Fund: nach "Beenden" + Neustart zeigte die UI zweimal einen
      // leeren Bestand, obwohl items.json nachweislich unveraendert und
      // vollstaendig war (per Hand nachgeprueft). console.log landet bei der
      // gepackten GUI-App aber nirgends sichtbar (kein Konsolenfenster, siehe
      // tools/build.mjs PE-Subsystem-Patch) - Root Cause bislang nicht
      // gefunden. Eine Zeile pro Start in eine kleine Datei macht den
      // naechsten Vorfall in Sekunden statt mit Live-Debugging klaerbar:
      // welches dataDir wurde tatsaechlich verwendet, wie viele Items und
      // welcher letzte Scan standen beim Start bereit. Fehler beim Schreiben
      // duerfen den eigentlichen Start nie verhindern.
      //
      // Nachtrag 16.08.2026: genau dieser Block hat beim dritten Vorfall
      // NICHTS geschrieben - keine Zeile, obwohl der Server lief. Damit war
      // der einzige Anhaltspunkt weg, und die Ursache liess sich nachtraeglich
      // nicht mehr rekonstruieren. Ein einzelnes try/catch um Lesen UND
      // Schreiben verschluckt beides ununterscheidbar. Jetzt getrennt: der
      // gelesene Stand wird auch dann festgehalten, wenn das Schreiben an der
      // ueblichen Stelle scheitert (Sperre, Rechte), und ein Fehler beim Lesen
      // wird als solcher protokolliert statt spurlos zu verschwinden.
      let line;
      try {
        // Zuerst pruefen, ob ueberhaupt noch dieselbe Datenbank darunter
        // liegt wie beim letzten Start - danach erst lesen und merken.
        const switched = items.checkStoreIdentity();
        const [startupItems, meta] = await Promise.all([items.getItems(), items.getMeta()]);
        items.rememberStore(startupItems.length);
        line =
          `${new Date().toISOString()} dataDir=${config.dataDir} items=${startupItems.length} ` +
          `lastScan=${meta.lastScan}${switched ? ` DATENBANKWECHSEL: ${switched}` : ''}\n`;
      } catch (e) {
        line = `${new Date().toISOString()} dataDir=${config.dataDir} STARTFEHLER beim Lesen: ${e?.message}\n`;
      }
      await writeDiagLine('startup.log', line);
      // Im Dev-Modus (npm start) kein Fenster aufreissen - nur die gepackte
      // App ist "ein Doppelklick oeffnet ein App-Fenster".
      if (isSea()) {
        await openAppWindow(`http://127.0.0.1:${PORT}`);
        // Nutzerwunsch 22.08.2026 (abgeschaut bei LANDED Bookmarks): eigenes
        // Icon im Systray, solange der Server laeuft - unabhaengig davon, ob
        // gerade ein Fenster offen ist. Siehe lib/tray.mjs fuer den
        // Lebenszyklus/Totmann-Schalter.
        startTrayIcon({ exePath: process.execPath, port: PORT });
      }
    });
  })();
}
