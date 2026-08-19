import { config } from './config.mjs';
import * as adb from './adb.mjs';

// PUT /json/new schlaegt auf manchen Android-Geraeten fehl (empirisch getestet,
// Chrome 150 / Android 16) - Target.createTarget ueber den Browser-WebSocket
// funktioniert zuverlaessig. Deshalb laeuft Schreiben komplett ueber den Browser-WS.
//
// Alle Funktionen nehmen die von adb.openSession() gelieferte Session als
// erstes Argument (session.baseUrl, z.B. http://127.0.0.1:9222) statt einen
// eigenen, unabhaengig konfigurierten Host zu verwenden - vorher hiess der
// hier hart 'localhost', der Server dagegen '127.0.0.1', was auf einem
// Dual-Stack-Rechner (localhost -> ::1) das Forwarding verfehlen konnte, da
// adb forward nur auf IPv4 lauscht.

// Runde-3-Befund #6: dieser fetch() hatte kein Timeout, im Unterschied zur
// Health-Sonde in lib/health.mjs, die dasselbe AbortSignal.timeout-Muster
// schon verwendet - ein haengender CDP-Endpunkt liess den Scan unbegrenzt
// lange ohne Rueckmeldung warten.
async function fetchTabs(session) {
  const res = await fetch(`${session.baseUrl}/json/list`, { signal: AbortSignal.timeout(config.cdpTimeoutMs) });
  const data = await res.json();
  return data
    .filter((t) => t.type === 'page' && t.url && t.url !== 'chrome://newtab/')
    .map((t) => ({ id: t.id, title: t.title || '', url: t.url }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nutzer-Feedback: "Chrome antwortet nicht" war bislang der haeufigste
// Abbruchgrund beim Einlesen, weil der CDP-Socket nur existiert, waehrend
// Chromes Prozess laeuft. Landed versucht deshalb bei einem fehlgeschlagenen
// ersten Zugriff automatisch, Chrome per ADB zu oeffnen, und wiederholt
// einmal - das ersetzt "Chrome von Hand oeffnen" durch "kurz automatisch
// aufpoppen", nicht durch "gar nicht mehr noetig" (das gibt CDP technisch
// nicht her, siehe DESIGN.md). Schlaegt auch der zweite Versuch fehl, laeuft
// der URSPRUENGLICHE Fehler unveraendert durch, nicht der des Wiederholungs-
// versuchs - friendlyError() liefert dann weiterhin den bekannten Hinweis,
// Chrome von Hand in den Vordergrund zu holen (lib/errors.mjs).
export async function listTabs(session) {
  try {
    return await fetchTabs(session);
  } catch (firstError) {
    await adb.launchChrome(session.serial).catch(() => {}); // eigener Fehlschlag soll den echten Fehler nicht verdecken
    await sleep(1500);
    try {
      return await fetchTabs(session);
    } catch {
      throw firstError;
    }
  }
}

async function browserWsUrl(session) {
  const res = await fetch(`${session.baseUrl}/json/version`, { signal: AbortSignal.timeout(config.cdpTimeoutMs) });
  const data = await res.json();
  return data.webSocketDebuggerUrl;
}

function sendCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error(`CDP-Timeout bei ${method}`));
    }, config.cdpTimeoutMs);
    function onMessage(event) {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeEventListener('message', onMessage);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    }
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function withBrowser(session, fn) {
  const wsUrl = await browserWsUrl(session);
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (e) => reject(new Error('WebSocket-Fehler: ' + e.message)), {
      once: true,
    });
  });
  try {
    return await fn(ws);
  } finally {
    ws.close();
  }
}

// Runde-3-Befund #5: bisher gab es keine Abbruchmoeglichkeit fuer lange
// Operationen (300 Tabs ≈ 90s pro Phase). signal wird VOR jedem Tab geprueft,
// nicht erst nach dem sleep - ein Abbruch soll den naechsten Tab gar nicht
// erst anfassen, nicht nur die Wartezeit davor abkuerzen. Ein frueher Abbruch
// liefert ein kuerzeres results-Array zurueck statt eines mit Fehlschlaegen
// aufgefuellten - die Aufrufer (restoreHandler/closeDecidedHandler) werten
// nur tatsaechlich versuchte Tabs aus, der Rest bleibt unangetastet in
// seinem vorherigen Zustand (kein Datenverlust, einfach nichts getan).
export async function openMany(session, urls, { delayMs = config.tabDelayMs, onProgress, signal } = {}) {
  return withBrowser(session, async (ws) => {
    const results = [];
    for (const url of urls) {
      if (signal?.aborted) break;
      try {
        const r = await sendCommand(ws, 'Target.createTarget', { url });
        results.push({ url, targetId: r.targetId, success: true });
      } catch (e) {
        results.push({ url, success: false, error: e.message });
      }
      onProgress?.(results.length, urls.length);
      await sleep(delayMs);
    }
    return results;
  });
}

export async function closeMany(session, targetIds, { delayMs = config.tabDelayMs, onProgress, signal } = {}) {
  return withBrowser(session, async (ws) => {
    const results = [];
    for (const id of targetIds) {
      if (signal?.aborted) break;
      try {
        const r = await sendCommand(ws, 'Target.closeTarget', { targetId: id });
        results.push({ id, success: r.success });
      } catch (e) {
        results.push({ id, success: false, error: e.message });
      }
      onProgress?.(results.length, targetIds.length);
      await sleep(delayMs);
    }
    return results;
  });
}
