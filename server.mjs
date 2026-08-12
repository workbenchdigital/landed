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
import { checkHealth } from './lib/health.mjs';
import { getSettings, completeSetup, updateSettings } from './lib/settings.mjs';
import { openAppWindow, createDesktopShortcut } from './lib/launcher.mjs';
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
async function streamOperation(res, fn, deviceSerial) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
  const write = (obj) => res.write(JSON.stringify(obj) + '\n');
  try {
    await withAdbSession((session) => fn(write, session), deviceSerial);
  } catch (err) {
    console.error(err); // volle technische Details im Log, gekuerzte Fassung an den Client
    write({ phase: 'error', message: friendlyError(err) });
  } finally {
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
    const result = await items.mergeScan(deviceKey, tabs);

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

// Fuer die "zuletzt eingelesen"-Anzeige beim Laden der Seite - ohne das zeigt
// die UI nach einem Reload "noch nicht eingelesen", obwohl bereits ein
// Bestand vorliegt (der Zeitstempel wurde bisher nur direkt nach einem
// frischen Scan angezeigt, nicht aus gespeicherten Daten geladen).
async function scanMetaHandler({ deviceKey }) {
  const meta = await items.getMeta(deviceKey);
  if (!meta.lastScan) return null;
  return { sourceCount: meta.lastScanSourceCount, timestamp: meta.lastScan };
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

async function noteHandler({ body, deviceKey }) {
  if (!body.normalizedUrl) throw badRequest('Keine URL angegeben.');
  const result = await items.setNote(deviceKey, body.normalizedUrl, body.note);
  if (!result.ok) throw badRequest('Unbekanntes Item.');
  return result;
}

async function searchHandler({ url }) {
  const includeDropped = url.searchParams.get('includeDropped') === '1';
  const results = await items.searchArchive(url.searchParams.get('q'), { includeDropped });
  return { results };
}

async function snoozeHandler({ body, deviceKey }) {
  if (!body.normalizedUrl) throw badRequest('Keine URL angegeben.');
  const result = await items.setSnooze(deviceKey, body.normalizedUrl, body.snoozeUntil || null);
  if (!result.ok) throw badRequest('Unbekanntes Item.');
  return result;
}

async function restoreHandler({ res, deviceKey, deviceSerial }) {
  return streamOperation(res, async (write, session) => {
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
      { onProgress: (done, total) => write({ phase: 'progress', done, total }) }
    );
    write({ phase: 'done', total: toOpen.length, results });
  }, deviceSerial);
}

async function closeDecidedHandler({ res, deviceKey, deviceSerial }) {
  return streamOperation(res, async (write, session) => {
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
    });
    const successById = new Map(results.map((r) => [r.id, r.success]));
    const closedNormalizedUrls = closeTargets
      .filter((t) => t.ids.length === 0 || t.ids.every((id) => successById.get(id)))
      .map((t) => t.item.normalizedUrl);
    const { archivedCount } = await items.applyCloseResults(deviceKey, closedNormalizedUrls);
    write({ phase: 'done', total: allIds.length, results, archivedCount });
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
  return getSettings();
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
  'GET /api/scan-meta': scanMetaHandler,
  'GET /api/search': searchHandler,
  'GET /api/bookmark-folders': bookmarkFoldersHandler,
  'POST /api/bookmark-check': bookmarkCheckHandler,
  'POST /api/bookmark-archive': bookmarkArchiveHandler,
  'POST /api/decisions': decisionsHandler,
  'POST /api/pc/done': pcDoneHandler,
  'POST /api/pc/return': pcReturnHandler,
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
      try {
        const [startupItems, meta] = await Promise.all([items.getItems(), items.getMeta()]);
        const line = `${new Date().toISOString()} dataDir=${config.dataDir} items=${startupItems.length} lastScan=${meta.lastScan}\n`;
        await appendFile(dataPath('startup.log'), line, 'utf8');
      } catch { /* Diagnose-Log ist best effort */ }
      // Im Dev-Modus (npm start) kein Fenster aufreissen - nur die gepackte
      // App ist "ein Doppelklick oeffnet ein App-Fenster".
      if (isSea()) await openAppWindow(`http://127.0.0.1:${PORT}`);
    });
  })();
}
