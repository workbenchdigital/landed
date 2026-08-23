import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.mjs';
import { getSettings } from './settings.mjs';

const execFileAsync = promisify(execFile);

// Nutzer-Fund: bei jeder Operation (Scan, Uebertragen, ...) blitzten
// mehrfach kurz Konsolenfenster auf, ohne lesbar zu sein. Ursache: adb.exe
// ist eine Konsolen(CUI)-Anwendung; startet man sie aus einem GUI-Prozess
// ohne windowsHide (Landed.exe selbst hat seit dem PE-Subsystem-Patch in
// tools/build.mjs keine eigene Konsole mehr), legt Windows fuer jeden
// einzelnen Aufruf ein neues, sichtbares Konsolenfenster an - bei einem
// einzelnen "Auf Handy uebertragen"-Klick bis zu sechs Stueck (zwei
// Sitzungen a drei adb-Aufrufe). windowsHide:true unterdrueckt das.
// Runde-3-Befund #6: keiner dieser Aufrufe hatte ein Timeout - ein
// haengender USB-/ADB-Zustand (z.B. eine nie beantwortete "USB-Debugging
// erlauben?"-Abfrage am Handy) liess "Bestand einlesen" dann unbegrenzt
// lange ohne jede Rueckmeldung haengen. execFile()s eigene timeout-Option
// killt den Kindprozess und wirft, statt selbst einen Wrapper zu bauen.
const HIDDEN = { windowsHide: true, timeout: config.adbTimeoutMs };

// Als Funktion statt Modulkonstante gelesen, damit Tests config.adbPath
// vor dem Aufruf umbiegen koennen (siehe lib/test-helpers.mjs).
const adbPath = () => config.adbPath || 'adb';
const REMOTE_SOCKET = 'localabstract:chrome_devtools_remote';

// Drahtlos verbundene Geraete haben als Seriennummer entweder eine IP:Port-
// Adresse (klassisches `adb connect`) oder eine mDNS-Pairing-ID
// (`adb-XXXXXX-XXXXXX._adb-tls-connect._tcp`). USB-Geraete haben stattdessen
// eine herstellerspezifische alphanumerische Kennung ohne diese Muster.
// ponytail: Heuristik ueber die Serial-Form, kein `adb shell getprop` je
// Geraet - falls das je ein Geraet falsch einordnet, dort nachschaerfen.
function isWireless(serial) {
  return /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(serial) || serial.includes('_adb-tls-');
}

// Strukturierte Sicht auf `adb devices -l`. Bislang (vor dieser Aenderung)
// gab es nur rohe, ungeparste Zeilen - device/unauthorized/offline und
// USB/drahtlos waren im Rueckgabewert nicht unterscheidbar. Exportiert und
// von nichts als Ausfuehrung abhaengig, daher direkt mit Text-Fixtures testbar.
export function parseDevices(stdout) {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('List of devices') && !l.startsWith('*'))
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      const props = {};
      for (const part of rest) {
        const i = part.indexOf(':');
        if (i > 0) props[part.slice(0, i)] = part.slice(i + 1);
      }
      return {
        serial,
        state, // 'device' | 'unauthorized' | 'offline' | ...
        transport: isWireless(serial) ? 'wireless' : 'usb',
        model: props.model || null,
        transportId: props.transport_id || null,
      };
    });
}

// Nutzer-Fund 23.08.2026: ein per Wireless-Debugging gekoppeltes Handy wird
// von adb selbst ZUSAETZLICH per mDNS im Netzwerk entdeckt (Serial-Form
// "adb-XXX..._adb-tls-connect._tcp") - unabhaengig vom expliziten
// `adb connect <ip:port>`, den Landed selbst ausloest. Beide Eintraege
// zeigen danach dasselbe physische Handy als zwei "bereit"-Geraete;
// classifyDeviceError()/pickDevice() lehnten das faelschlich als "mehrere
// Geraete verbunden" ab - der Einrichtungsassistent blieb dadurch scheinbar
// bei "Warte auf Chrome…" haengen, obwohl Chrome laengst lief und die
// eigentliche Ursache eine Geraete-Ambiguitaet war, nicht Chrome.
// Kollabiert wireless-Eintraege mit demselben model auf die ip:port-Form
// (das von Landed selbst explizit verbundene Geraet, isWireless()-Regex #1
// weiter oben) - NUR bei gleichem model, damit ein zweites, tatsaechlich
// anderes Handy weiterhin korrekt als "mehrere Geraete" erkannt wird. Reine
// Filterfunktion ohne Seiteneffekt, direkt mit Fixtures testbar (gleiches
// Prinzip wie parseDevices/classifyDeviceError).
//
// Codemouse-Review PR #69: die erste Fassung kollabierte JEDE Gruppe mit
// gleichem model auf die erste gefundene ip:port-Form, sobald mehr als ein
// Eintrag vorlag - das haette auch zwei ECHTE, verschiedene Handys mit
// zufaellig gleichem Modellnamen (z.B. zwei identische Firmengeraete, beide
// per eigenem `adb connect` verbunden) faelschlich auf eines zusammengefasst
// und eine echte Mehrgeraete-Ambiguitaet verschleiert. Kollabiert jetzt nur
// noch die eine Form, die den beobachteten Fall tatsaechlich ausmacht: genau
// zwei Eintraege, davon genau einer in mDNS-Form und genau einer in
// ip:port-Form. Jede andere Konstellation (auch zwei ip:port-Eintraege, auch
// drei oder mehr) bleibt unangetastet.
const isMdnsForm = (serial) => /^adb-.*_adb-tls-connect\._tcp$/.test(serial);
const isIpPortForm = (serial) => /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(serial);

export function dedupeWirelessTwins(devices) {
  const groups = new Map(); // model -> passende wireless-"device"-Eintraege
  const passthrough = [];
  for (const d of devices) {
    if (d.transport !== 'wireless' || d.state !== 'device' || !d.model) {
      passthrough.push(d);
      continue;
    }
    if (!groups.has(d.model)) groups.set(d.model, []);
    groups.get(d.model).push(d);
  }
  const deduped = [...passthrough];
  for (const group of groups.values()) {
    const mdns = group.filter((d) => isMdnsForm(d.serial));
    const ipPort = group.filter((d) => isIpPortForm(d.serial));
    if (group.length === 2 && mdns.length === 1 && ipPort.length === 1) {
      deduped.push(ipPort[0]);
    } else {
      deduped.push(...group);
    }
  }
  return deduped;
}

export async function listDevices() {
  const { stdout } = await execFileAsync(adbPath(), ['devices', '-l'], HIDDEN);
  return dedupeWirelessTwins(parseDevices(stdout));
}

// ---- Drahtlose Verbindung (Opt-in, siehe settings.wirelessAdbEnabled) ----
//
// AUSSCHLIESSLICH der moderne Android-11+-Flow: `adb pair <ip:port> <code>`
// (TLS-authentifiziert, einmaliger Code vom Telefon) und danach
// `adb connect <ip:port>` fuer die Sitzung. Der alte `adb tcpip <port>`-Weg
// wird bewusst NICHT angeboten und darf hier auch nicht nachgeruestet werden:
// er schaltet das Telefon in einen Modus, in dem es nach dem Trennen
// unauthentifiziert von jedem Geraet im selben WLAN erreichbar bleibt - eine
// eigene, aeltere Risikoklasse. CVE-2026-0073 selbst liegt in der
// TLS-Zertifikatspruefung von adbd (adbd_tls_verify_cert) und betrifft damit
// gerade den modernen Pairing-Flow, den wir hier nutzen - nur der Patchstand
// des Geraets schuetzt davor, siehe README "Sicherheit".
//
// Eingabevalidierung vor jedem execFile-Aufruf: execFile uebergibt Argumente
// ohne Shell, eine Injection ist damit ohnehin ausgeschlossen - eine klare
// Fehlermeldung ist trotzdem besser, als adb rohen Unsinn zu uebergeben.
// Gibt die normalisierte 'ip:port'-Zeichenkette zurueck (Form wie isWireless()
// oben erwartet); wirft bei ungueltiger Eingabe.
export function wirelessTarget(ip, port, code) {
  const octets = String(ip ?? '').trim().split('.');
  const validIp = octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255);
  if (!validIp) {
    throw new Error('Ungültige IP-Adresse (erwartet vier Zahlen 0-255, z.B. 192.168.1.42).');
  }
  const portNumber = Number(String(port ?? '').trim());
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    throw new Error('Ungültiger Port (erwartet eine Zahl zwischen 1 und 65535).');
  }
  // Nur pruefen, wenn ein Code erwartet wird (Pairing) - connect braucht keinen.
  if (code !== undefined && !/^\d{6}$/.test(String(code ?? '').trim())) {
    throw new Error('Ungültiger Pairing-Code (erwartet die 6 Ziffern, die das Telefon anzeigt).');
  }
  return `${octets.map(Number).join('.')}:${portNumber}`;
}

// adb meldet Fehlschlaege bei pair/connect auf stdout und beendet sich
// trotzdem mit Exit-Code 0 ("failed to connect to ...", "Failed: ...") - ohne
// diese Pruefung waere jeder Fehlversuch fuer den Aufrufer ein Erfolg.
// Zeilenweise geprueft, nicht nur der Anfang: adb stellt der eigentlichen
// Ausgabe bei Bedarf noch "* daemon not running; starting now"-Zeilen voran.
function assertAdbOk(stdout) {
  const out = stdout.trim();
  const failure = out.split('\n').find((l) => /^(failed|unable|cannot|error)/i.test(l.trim()));
  if (failure) throw new Error(failure.trim());
  return out;
}

// Einmaliges Koppeln. Der Code wird nur an adb durchgereicht und nirgends
// gespeichert - den ausgetauschten Schluessel verwaltet adb selbst
// (~/.android/adbkey), das ist ausserhalb von Landeds Verantwortung.
export async function pairWireless(ip, port, code) {
  const target = wirelessTarget(ip, port, code);
  try {
    const { stdout } = await execFileAsync(adbPath(), ['pair', target, String(code).trim()], HIDDEN);
    return assertAdbOk(stdout);
  } catch (e) {
    // Rafter-Review: Node haengt bei einem execFile-Fehler die komplette
    // Kommandozeile an die Fehlermeldung - inklusive Pairing-Code. Die
    // Meldung landet in console.error und ueber friendlyError() in der UI.
    // Deshalb hier eine eigene Meldung statt e.message durchzureichen: der
    // Code darf nirgendwo hin ausser zu adb.
    if (/Command failed/i.test(e.message)) {
      throw new Error(`Koppeln mit ${target} fehlgeschlagen. Code und Port am Telefon prüfen (beide gelten nur für diesen Kopplungsdialog).`);
    }
    throw e;
  }
}

// Verbindungsaufbau zur eigentlichen Sitzung. Anderer Port als beim Pairing:
// das Telefon zeigt den Pairing-Port nur waehrend des Kopplungsdialogs an,
// der Verbindungsport steht dauerhaft unter Wireless-Debugging.
export async function connectWireless(ip, port) {
  const target = wirelessTarget(ip, port);
  const { stdout } = await execFileAsync(adbPath(), ['connect', target], HIDDEN);
  return { target, message: assertAdbOk(stdout) };
}

// Reine Auswahlentscheidung, ohne Seiteneffekt und damit direkt mit Fixtures
// testbar (gleiches Prinzip wie parseDevices/checkSessionConflict).
// Erzwingt die im README dokumentierte USB-only-Policy zentral (bislang nur
// Doku, nicht durchgesetzt - ein drahtloses Geraet waere frueher
// stillschweigend verwendet worden, wenn es das einzige verbundene war).
// allowWireless=false ist der Standardfall und verhaelt sich exakt wie vor
// dem Wireless-Opt-in; ist das Flag an, faellt nur die Transport-Pruefung weg
// - es gibt bewusst keinen zweiten Auswahlpfad fuer drahtlose Geraete.
export function pickDevice(devices, wanted, allowWireless = false) {
  const ready = devices.filter((d) => d.state === 'device');
  const usable = allowWireless ? ready : ready.filter((d) => d.transport === 'usb');

  if (wanted) {
    const match = usable.find((d) => d.serial === wanted);
    if (!match) {
      throw new Error(
        allowWireless ? `Gerät '${wanted}' nicht verbunden.` : `Gerät '${wanted}' nicht per USB verbunden.`
      );
    }
    return match;
  }
  if (!usable.length) {
    if (!allowWireless && ready.some((d) => d.transport === 'wireless')) {
      throw new Error(
        'Nur drahtlos verbundene Geräte gefunden - dieses Werkzeug nutzt ausschließlich USB.'
      );
    }
    // Deckt sich bewusst mit dem Wortlaut, den lib/errors.mjs erkennt
    // (kein Geraet, unautorisiert, offline) - kein neues Fehlermuster noetig.
    throw new Error('no devices/emulators found');
  }
  if (usable.length > 1) {
    throw new Error(
      allowWireless
        ? 'Mehrere Geräte verbunden. Bitte nur eines verbunden lassen.'
        : 'Mehrere Geräte per USB verbunden. Bitte nur eines anschließen.'
    );
  }
  return usable[0];
}

// Waehlt das Geraet fuer die naechste Session aus.
// preferredSerial (Stufe 5.3, vom Geraete-Umschalter im Header) hat Vorrang
// vor der LANDED_DEVICE-Umgebungsvariable und erlaubt - anders als der
// bisherige Alleingang-Fall - explizit eines von mehreren verbundenen
// Geraeten auszuwaehlen, statt bei mehr als einem sofort abzubrechen.
export async function selectDevice(preferredSerial) {
  const [devices, settings] = await Promise.all([listDevices(), getSettings()]);
  return pickDevice(devices, preferredSerial || config.deviceSerial, settings.wirelessAdbEnabled === true);
}

async function forward(serial) {
  await execFileAsync(adbPath(), ['-s', serial, 'forward', `tcp:${config.cdpPort}`, REMOTE_SOCKET], HIDDEN);
  return { serial, port: config.cdpPort, baseUrl: `http://${config.host}:${config.cdpPort}` };
}

async function unforward(serial) {
  try {
    await execFileAsync(adbPath(), ['-s', serial, 'forward', '--remove', `tcp:${config.cdpPort}`], HIDDEN);
  } catch {
    // war schon entfernt oder nie gesetzt - kein Fehlerfall
  }
  const { stdout } = await execFileAsync(adbPath(), ['forward', '--list'], HIDDEN);
  const remaining = stdout
    .split('\n')
    .filter((l) => l.includes(`tcp:${config.cdpPort} `) || l.trim().endsWith(`tcp:${config.cdpPort}`));
  if (remaining.length) {
    console.warn(`WARNUNG: Port-Forwarding tcp:${config.cdpPort} noch aktiv:`, remaining);
  }
}

// Refcounting: ohne das wuerde eine verschachtelte Session (zwei bestehende
// Operationen in einem neuen Endpunkt kombiniert) das Port-Forwarding zu
// frueh abbauen, sobald die innere Operation fertig ist. Noch nutzt niemand
// Verschachtelung, aber jeder neue zusammengesetzte Endpunkt tappt sonst rein.
let refs = 0;
let session = null;
let opening = null;
// codemouseai-Review auf PR #13: sessionSerial ist die Seriennummer, an die
// die aktuell offene/oeffnende Sitzung gebunden ist. Ohne diesen Check wuerde
// eine zweite, waehrend refs>0 eintreffende Anfrage fuer ein ANDERES Geraet
// (Stufe 5.3 Multi-Device: zwei parallele Requests, z.B. eine lange
// close-decided-Operation fuer Geraet A + ein Scan fuer Geraet B) die
// Sitzung von A stillschweigend mitbenutzen - Scan-Ergebnisse von A wuerden
// dann unter Bs items.json landen. Nur geprueft, wenn BEIDE Seiten eine
// echte Seriennummer haben - der Single-Device-Automodus (preferredSerial
// bzw. sessionSerial === null) bleibt unveraendert erlaubt, dort gibt es per
// Definition kein zweites Geraet, mit dem man kollidieren koennte.
let sessionSerial = null;

// Reine Entscheidungsfunktion ohne Seiteneffekt - anders als openSession()
// selbst (das echte Hardware ueber selectDevice() anfasst) direkt mit
// Text-Fixtures testbar, gleiches Prinzip wie parseDevices() oben.
export function checkSessionConflict(currentRefs, currentSessionSerial, preferredSerial) {
  if (currentRefs > 0 && preferredSerial && currentSessionSerial && preferredSerial !== currentSessionSerial) {
    throw new Error(
      `Eine ADB-Sitzung für Gerät '${currentSessionSerial}' läuft bereits - '${preferredSerial}' kann nicht gleichzeitig verwendet werden.`
    );
  }
}

export async function openSession(preferredSerial) {
  checkSessionConflict(refs, sessionSerial, preferredSerial);
  if (refs === 0) {
    sessionSerial = preferredSerial || null;
    opening = selectDevice(preferredSerial).then((device) => forward(device.serial));
  }
  refs++;
  try {
    session = await opening;
    return session;
  } catch (e) {
    refs--;
    if (refs === 0) {
      session = null;
      sessionSerial = null;
    }
    throw e;
  }
}

export async function closeSession() {
  if (refs === 0) return; // unpaarig aufgerufen (z.B. openSession() ist fehlgeschlagen) - idempotent
  refs--;
  if (refs > 0) return;
  const serial = session?.serial;
  session = null;
  sessionSerial = null;
  if (serial) await unforward(serial);
}

// Fuer Cleanup-Handler und /api/shutdown - NICHT closeSession(), sonst bleibt
// nach einem Absturz mitten in einer verschachtelten Operation (refs > 0)
// das Port-Forwarding stehen, weil closeSession() den Zaehler erst auf 0
// herunterzaehlen wuerde statt sofort aufzuraeumen.
export async function forceClose() {
  const serial = session?.serial;
  refs = 0;
  session = null;
  sessionSerial = null;
  if (serial) await unforward(serial).catch(() => {});
}

// CDPs Debug-Socket (localabstract:chrome_devtools_remote) existiert nur,
// waehrend Chromes Prozess auf dem Telefon laeuft - das ist der haeufigste
// Grund, warum ein Scan fehlschlaegt (siehe README "Bekannte Grenzen").
// cdp.mjs listTabs() ruft das bei einem fehlgeschlagenen ersten Versuch auf,
// statt den Nutzer jedes Mal von Hand zu Chrome zu schicken. monkey mit der
// LAUNCHER-Kategorie statt eines fest verdrahteten Aktivitaetsnamens
// (com.google.android.apps.chrome.Main) - robuster gegen Aenderungen an der
// Aktivitaetsklasse zwischen Chrome-Versionen/-Kanaelen, und der etablierte
// Weg, eine App allein ueber ihren Package-Namen zu starten.
const CHROME_PACKAGE = 'com.android.chrome';

export async function launchChrome(serial) {
  const args = serial ? ['-s', serial] : [];
  await execFileAsync(
    adbPath(),
    [...args, 'shell', 'monkey', '-p', CHROME_PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1'],
    HIDDEN
  );
}

export async function getSecurityPatch(serial) {
  const args = serial ? ['-s', serial] : [];
  const { stdout } = await execFileAsync(
    adbPath(),
    [...args, 'shell', 'getprop', 'ro.build.version.security_patch'],
    HIDDEN
  );
  return stdout.trim();
}

let cleanupRegistered = false;

export function registerCleanupHandlers() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const cleanup = () => {
    forceClose().finally(() => process.exit());
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', (err) => {
    console.error('Unerwarteter Fehler, raeume ADB-Session auf:', err);
    cleanup();
  });
}
