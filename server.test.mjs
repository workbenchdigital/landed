import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from './server.mjs';
import { withTempData } from './lib/test-helpers.mjs';
import { mergeScan, appendArchiveRecords, getMeta } from './lib/items.mjs';

// Startet eine Testinstanz auf Port 0 (frei vom OS vergeben) und liefert die
// Basis-URL. Kein einziger dieser Tests beruehrt echte Hardware (ADB/CDP) -
// die Routen, die das taeten (scan/restore/close-decided), werden hier nicht
// aufgerufen; sie brauchen ein echtes Geraet und sind live in den vorherigen
// Stufen-Commits verifiziert worden, nicht per node:test.
async function withServer(fn) {
  return withTempData(async () => {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    try {
      await fn(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
    }
  });
}

test('unbekannte /api/-Route liefert 404', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/does-not-exist`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.match(body.error, /Unbekannter Endpunkt/);
  });
});

test('falsche Methode auf existierende Route liefert 405 mit Allow-Header', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/scan`); // GET statt POST
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
  });
});

test('CSRF-Gate: POST mit fremdem Origin wird abgelehnt', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/decisions`, {
      method: 'POST',
      headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [] }),
    });
    assert.equal(res.status, 403);
  });
});

test('CSRF-Gate: POST ohne Origin/Referer (z.B. curl) wird akzeptiert', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [] }),
    });
    assert.equal(res.status, 200);
  });
});

test('GET /api/items liefert leeres Array ohne vorherigen Scan', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/items`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });
});

test('GET /api/scan-meta liefert null ohne vorherigen Scan', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/scan-meta`);
    assert.equal(res.status, 200);
    assert.equal(await res.json(), null);
  });
});

test('kaputtes JSON im Body liefert 400 statt 500', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{das ist kein json',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Ungültiger Request-Body/);
  });
});

test('zu grosser Body liefert 400 statt unbegrenzt zu puffern', async () => {
  await withServer(async (base) => {
    const oversized = 'x'.repeat(2 * 1024 * 1024); // deutlich ueber maxBodyBytes (1 MiB)
    const res = await fetch(`${base}/api/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [], padding: oversized }),
    });
    assert.equal(res.status, 400);
  });
});

test('statische Datei wird mit korrektem MIME-Type ausgeliefert', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/style.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/css/);
  });
});

test('Query-String auf statischer Datei bricht das Ausliefern nicht mehr (vorher: 404)', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/style.css?v=2`);
    assert.equal(res.status, 200);
  });
});

test('Wurzelpfad liefert index.html', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });
});

test('POST /api/bookmark-check ohne folderId liefert 400 (nicht 500)', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/bookmark-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

// wb-audit-Folgefund (Stufe F): title kam vom Client ungeprueft durch -
// fehlte es, waere jede spaetere Archivsuche an r.title.toLowerCase() ohne
// Null-Check zerbrochen. Deckt beides ab: der Import selbst darf nicht
// scheitern, UND eine Suche danach darf nicht mit 500 enden.
test('POST /api/bookmark-archive ohne title bricht weder den Import noch eine spaetere Suche', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/bookmark-archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ url: 'https://ohne-titel.example/' }] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.archivedCount, 1);

    const search = await fetch(`${base}/api/search?q=ohne-titel`);
    assert.equal(search.status, 200);
    assert.equal((await search.json()).results.length, 1);
  });
});

// pc/return brauchte ein echtes ADB/CDP-Geraet, ABER nur wenn normalizedUrl
// gesetzt ist - der badRequest-Check laeuft davor, ist also ohne Hardware testbar.
test('POST /api/pc/return ohne normalizedUrl liefert 400 (nicht 500, keine ADB-Session noetig)', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/pc/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/pc/done fuer unbekanntes Item liefert 400', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/pc/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: 'https://nicht-vorhanden.example/' }),
    });
    assert.equal(res.status, 400);
  });
});

// codemouseai-Review auf PR #9: entries kam ungeprueft vom Client direkt bei
// items.setStates() an - ein unbekannter state waere in items.json
// hangengeblieben, ohne von closeDecidedHandler/restoreHandler je wieder
// gefunden zu werden.
test('POST /api/decisions mit unbekanntem state liefert 400 (nicht persistiert)', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [['https://a.example/', 'banana']] }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/decisions mit state:null (Zuruecksetzen) bleibt weiterhin erlaubt', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [['https://a.example/', null]] }),
    });
    assert.equal(res.status, 200);
  });
});

// codemouseai-Review auf PR #9: pcReturnHandler wechselte jedes bekannte
// Item bedingungslos auf 'keep' und oeffnete den Tab - auch fuer Items, die
// gar nicht in der PC-Arbeitsliste standen.
test('POST /api/pc/return fuer ein Item, das nicht state "pc" hat, liefert 400 (keine ADB-Session noetig)', async () => {
  await withServer(async (base) => {
    await mergeScan(undefined, [{ id: '1', url: 'https://a.example/', title: 'A' }]); // landet als state 'open'
    const res = await fetch(`${base}/api/pc/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: 'https://a.example/' }),
    });
    assert.equal(res.status, 400);
  });
});

// /api/health selbst beruehrt echte Hardware (adb version/devices) - nicht
// hier getestet, siehe lib/health.test.mjs fuer die reine Klassifizierungs-
// logik. Nur das CSRF-Gate ist hardwareunabhaengig pruefbar.
test('POST /api/health mit fremdem Origin wird abgelehnt (CSRF-Gate greift auch hier)', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/health`, {
      method: 'POST',
      headers: { Origin: 'http://evil.example' },
    });
    assert.equal(res.status, 403);
  });
});

test('GET /api/settings ohne vorherigen Abschluss liefert setupCompletedAt: null', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/settings`);
    assert.equal(res.status, 200);
    const settings = await res.json();
    assert.equal(settings.setupCompletedAt, null);
  });
});

test('POST /api/settings/complete markiert die Einrichtung als abgeschlossen', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/settings/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completedVia: 'skip' }),
    });
    const res = await fetch(`${base}/api/settings`);
    const settings = await res.json();
    assert.ok(settings.setupCompletedAt);
    assert.equal(settings.completedVia, 'skip');
  });
});

// ---- Drahtlose Verbindung (Opt-in) ----
// Alle Faelle hier enden VOR dem ersten adb-Aufruf (Flag aus bzw. ungueltige
// Eingabe) und sind damit wie der Rest dieser Datei hardwareunabhaengig.

const postJson = (base, path, payload) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

test('GET /api/settings liefert wirelessAdbEnabled: false ohne Zutun', async () => {
  await withServer(async (base) => {
    const settings = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(settings.wirelessAdbEnabled, false);
    assert.equal(settings.lastWirelessTarget, null);
  });
});

test('POST /api/settings/wireless ohne boolean liefert 400', async () => {
  await withServer(async (base) => {
    for (const enabled of ['ja', 1, undefined]) {
      const res = await postJson(base, '/api/settings/wireless', { enabled });
      assert.equal(res.status, 400, `enabled: ${enabled}`);
    }
    const settings = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(settings.wirelessAdbEnabled, false, 'nichts davon darf das Flag setzen');
  });
});

test('POST /api/settings/wireless schaltet das Flag um und wieder zurueck', async () => {
  await withServer(async (base) => {
    await postJson(base, '/api/settings/wireless', { enabled: true });
    assert.equal((await (await fetch(`${base}/api/settings`)).json()).wirelessAdbEnabled, true);
    await postJson(base, '/api/settings/wireless', { enabled: false });
    assert.equal((await (await fetch(`${base}/api/settings`)).json()).wirelessAdbEnabled, false);
  });
});

test('POST /api/wireless/pair und /connect sind ohne Opt-in gesperrt (400, kein adb-Aufruf)', async () => {
  await withServer(async (base) => {
    const pair = await postJson(base, '/api/wireless/pair', {
      ip: '192.168.1.42',
      port: '37123',
      code: '123456',
    });
    assert.equal(pair.status, 400);
    assert.match((await pair.json()).error, /ausgeschaltet/);

    const connect = await postJson(base, '/api/wireless/connect', { ip: '192.168.1.42', port: '5555' });
    assert.equal(connect.status, 400);
    assert.match((await connect.json()).error, /ausgeschaltet/);
  });
});

test('POST /api/wireless/pair mit Opt-in, aber ungueltiger Eingabe liefert 400 vor dem adb-Aufruf', async () => {
  await withServer(async (base) => {
    await postJson(base, '/api/settings/wireless', { enabled: true });

    const badIp = await postJson(base, '/api/wireless/pair', { ip: 'localhost', port: '37123', code: '123456' });
    assert.equal(badIp.status, 400);
    assert.match((await badIp.json()).error, /IP-Adresse/);

    const badCode = await postJson(base, '/api/wireless/pair', { ip: '192.168.1.42', port: '37123', code: '12' });
    assert.equal(badCode.status, 400);
    assert.match((await badCode.json()).error, /Pairing-Code/);

    const badPort = await postJson(base, '/api/wireless/connect', { ip: '192.168.1.42', port: '0' });
    assert.equal(badPort.status, 400);
    assert.match((await badPort.json()).error, /Port/);

    // Fehlversuche duerfen nichts merken - erst eine erfolgreiche Verbindung
    // schreibt lastWirelessTarget (und auch dann nie den Code).
    const settings = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(settings.lastWirelessTarget, null);
  });
});

// createDesktopShortcut() wirft sofort fuer !isSea(), bevor PowerShell
// ueberhaupt aufgerufen wird - im node:test-Prozess nie SEA, also
// hardwareunabhaengig testbar.
test('POST /api/create-shortcut im Entwicklungsmodus liefert 400 (nur in der gepackten App verfuegbar)', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/create-shortcut`, { method: 'POST' });
    assert.equal(res.status, 400);
  });
});

test('POST /api/note fuer unbekanntes Item liefert 400', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: 'https://nicht-vorhanden.example/', note: 'x' }),
    });
    assert.equal(res.status, 400);
  });
});

test('GET /api/search ohne q liefert leere Ergebnisliste', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/search`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { results: [] });
  });
});

test('GET /api/search findet archivierte Treffer per Titel', async () => {
  await withServer(async (base) => {
    await appendArchiveRecords([
      { normalizedUrl: 'https://a.example/', url: 'https://a.example/', title: 'Findbarer Titel', domain: 'a.example', kind: 'archived', device: null, at: '2026-01-01T00:00:00.000Z', firstSeen: '2026-01-01T00:00:00.000Z' },
    ]);
    const res = await fetch(`${base}/api/search?q=findbarer`);
    assert.equal(res.status, 200);
    const { results } = await res.json();
    assert.equal(results.length, 1);
    assert.equal(results[0].normalizedUrl, 'https://a.example/');
  });
});

// devicesHandler ruft immer adb.listDevices() auf - nicht ohne echte
// Hardware testbar, siehe Kommentar am Dateianfang. selectDeviceHandler
// prueft body.serial aber VOR jedem adb-Zugriff, ist also fuer den
// badRequest-Pfad hardwareunabhaengig testbar (gleiches Muster wie bei
// pc/return oben).
test('POST /api/devices/select ohne serial liefert 400 (keine ADB-Session noetig)', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/devices/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

// setDeviceLabel() beruehrt nur items.json/meta.json, keine Hardware - anders
// als devicesHandler/selectDeviceHandler vollstaendig end-to-end testbar.
test('POST /api/devices/label ohne serial liefert 400', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/devices/label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Pixel' }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/devices/label setzt das Label im meta.json des angegebenen Geraets', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/devices/label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial: 'ABC123', label: 'Mein Pixel' }),
    });
    assert.equal(res.status, 200);
    const meta = await getMeta('ABC123');
    assert.equal(meta.label, 'Mein Pixel');
  });
});

test('POST /api/snooze fuer unbekanntes Item liefert 400', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: 'https://nicht-vorhanden.example/', snoozeUntil: '2026-09-01' }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/snooze setzt snoozeUntil, leerer Wert setzt wieder zurueck', async () => {
  await withServer(async (base) => {
    await mergeScan(undefined, [{ id: '1', url: 'https://a.example/', title: 'A' }]);
    const set = await fetch(`${base}/api/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: 'https://a.example/', snoozeUntil: '2026-09-01' }),
    });
    assert.equal(set.status, 200);
    let items = await (await fetch(`${base}/api/items`)).json();
    assert.equal(items.find((i) => i.normalizedUrl === 'https://a.example/').snoozeUntil, '2026-09-01');

    const clear = await fetch(`${base}/api/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: 'https://a.example/', snoozeUntil: null }),
    });
    assert.equal(clear.status, 200);
    items = await (await fetch(`${base}/api/items`)).json();
    assert.equal(items.find((i) => i.normalizedUrl === 'https://a.example/').snoozeUntil, null);
  });
});
