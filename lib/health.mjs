import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as adb from './adb.mjs';
import { config } from './config.mjs';
import { getSettings } from './settings.mjs';
import { friendlyError } from './errors.mjs';

const execFileAsync = promisify(execFile);
const adbPath = () => config.adbPath || 'adb';
// Gleicher Fund wie lib/adb.mjs/lib/launcher.mjs - hier besonders spuerbar,
// da der Einrichtungsassistent diese Sonde alle 1,5s abfragt.
const HIDDEN = { windowsHide: true };

// Sondenreihenfolge = die echte Fehlerkette (adb da? -> Geraet da? -> Chrome
// erreichbar?), Abbruch beim ersten Fehler. hint ist der stabile Maschinen-
// schluessel, den der Assistent zum Weiterschalten abfragt; message kommt
// ueber friendlyError() aus demselben Vokabular wie jeder andere Fehler-Toast
// - eine Quelle fuer die Texte statt einer zweiten, separat gepflegten Liste.
// allowWireless spiegelt settings.wirelessAdbEnabled (Opt-in, Default aus).
// Ist es aus, bleibt die Sonde Wort fuer Wort bei der bisherigen USB-Policy;
// ist es an, zaehlt ein drahtloses Geraet als ganz normales Zielgeraet, statt
// den Nutzer mit "nutzt ausschliesslich USB" gegen eine Wand laufen zu lassen.
function classifyDeviceError(devices, allowWireless = false) {
  const usb = devices.filter((d) => d.transport === 'usb');
  const wirelessReady = devices.filter((d) => d.transport === 'wireless' && d.state === 'device');
  const usbReady = usb.filter((d) => d.state === 'device');
  const ready = allowWireless ? [...usbReady, ...wirelessReady] : usbReady;

  if (ready.length > 1) {
    return { hint: 'multiple', error: new Error('Mehrere Geräte per USB verbunden.') };
  }
  if (ready.length === 1) return null; // kein Fehler - Geraet gefunden
  if (usb.some((d) => d.state === 'unauthorized')) {
    return { hint: 'unauthorized', error: new Error('device unauthorized') };
  }
  if (usb.some((d) => d.state === 'offline')) {
    return { hint: 'offline', error: new Error('device offline') };
  }
  if (!allowWireless && wirelessReady.length) {
    return { hint: 'wireless-only', error: new Error('nutzt ausschließlich USB') };
  }
  return { hint: 'none', error: new Error('no devices/emulators found') };
}

function fail(step, hint, err, extra = {}) {
  return {
    ok: false,
    step,
    hint,
    message: friendlyError(err),
    adb: false,
    devices: [],
    device: null,
    chrome: null,
    securityPatch: null,
    ...extra,
  };
}

async function runProbe() {
  try {
    await execFileAsync(adbPath(), ['version'], HIDDEN);
  } catch (e) {
    return fail('adb', 'missing', e);
  }

  let devices;
  try {
    devices = await adb.listDevices();
  } catch (e) {
    return fail('adb', 'missing', e);
  }

  const allowWireless = (await getSettings()).wirelessAdbEnabled === true;
  const deviceError = classifyDeviceError(devices, allowWireless);
  if (deviceError) return fail('device', deviceError.hint, deviceError.error, { adb: true, devices });

  const device = devices.find((d) => d.state === 'device' && (allowWireless || d.transport === 'usb'));

  // Ueber die refcountete Session statt eines eigenen forward/unforward:
  // haelt eine echte Operation die Session schon, haengt sich die Sonde per
  // Refcount nur an (kein erneutes Forwarding), statt eigenmaechtig eines zu
  // oeffnen oder - schlimmer - das einer laufenden Operation zu schliessen.
  let session;
  try {
    session = await adb.openSession();
  } catch (e) {
    return fail('forward', 'forward-failed', e, { adb: true, devices, device });
  }

  try {
    const res = await fetch(`${session.baseUrl}/json/list`, {
      signal: AbortSignal.timeout(config.cdpTimeoutMs),
    });
    if (!res.ok) throw new Error(`fetch failed: CDP antwortet mit ${res.status}`);
    const tabs = await res.json();
    const pageTabs = tabs.filter((t) => t.type === 'page');
    const securityPatch = await adb.getSecurityPatch(device.serial).catch(() => null);

    if (!pageTabs.length) {
      return {
        ok: false,
        step: 'chrome',
        hint: 'no-tabs',
        message: 'Chrome läuft, zeigt aber keine offenen Tabs. Am Telefon mindestens einen Tab öffnen.',
        adb: true,
        devices,
        device,
        chrome: { ok: true, tabCount: 0 },
        securityPatch,
      };
    }

    return {
      ok: true,
      step: null,
      hint: null,
      message: null,
      adb: true,
      devices,
      device,
      chrome: { ok: true, tabCount: pageTabs.length },
      securityPatch,
    };
  } catch (e) {
    return fail('chrome', 'not-running', e, { adb: true, devices, device, chrome: { ok: false } });
  } finally {
    // Ein Fehler HIER wuerde sonst das bereits berechnete Sondenergebnis
    // ueberschreiben (ein throw in finally ersetzt einen return/throw aus
    // dem try) - /api/health soll aber immer 200 mit dem Zustand im Body
    // liefern, nie 500 wegen eines Teardown-Hakelns beim Aufraeumen.
    await adb.closeSession().catch(() => {});
  }
}

// In-Flight-Dedupe + kurzer Ergebnis-Cache: der Assistent pollt alle 1500ms,
// zusaetzlich kann der "Einrichtung pruefen"-Knopf aus einem Fehler-Toast
// jederzeit dazwischenkommen - ohne das wuerden zwei fast gleichzeitige
// Sonden unnoetig doppelt adb aufrufen.
const CACHE_MS = 800;
let cached = null;
let inFlight = null;

export async function checkHealth() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;
  if (inFlight) return inFlight;
  inFlight = runProbe().finally(() => {
    inFlight = null;
  });
  const result = await inFlight;
  cached = { at: Date.now(), result };
  return result;
}

export const __testables = { classifyDeviceError };
