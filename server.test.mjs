import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from './server.mjs';
import { withTempData } from './lib/test-helpers.mjs';
import { mergeScan, appendArchiveRecords, getMeta, setStates, applyCloseResults } from './lib/items.mjs';

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

test('GET /api/scan-meta liefert kein sourceCount/timestamp ohne vorherigen Scan, aber recentDoneCount', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/scan-meta`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sourceCount, undefined);
    assert.equal(body.timestamp, undefined);
    assert.equal(body.recentDoneCount, 0);
  });
});

test('GET /api/scan-meta zaehlt kuerzliche Archiv-Eintraege in recentDoneCount', async () => {
  await withServer(async (base) => {
    await appendArchiveRecords([
      {
        normalizedUrl: 'https://erledigt.example/',
        url: 'https://erledigt.example/',
        title: 'x',
        domain: 'erledigt.example',
        kind: 'done',
        device: 'default',
        at: new Date().toISOString(),
        firstSeen: new Date().toISOString(),
      },
    ]);
    const res = await fetch(`${base}/api/scan-meta`);
    const body = await res.json();
    assert.equal(body.recentDoneCount, 1);
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

// Nur der 400-Pfad (unbekanntes Item, kein Aufruf von forwardToBookmarks) -
// der Erfolgspfad riefe forwardToBookmarks() mit den echten Defaultwerten
// auf (echter Dateipfad unter %LOCALAPPDATA%, echter localhost-Request),
// dasselbe Prinzip wie close-decided oben: kein echtes externes System in
// node:test anfassen. Die Archiv-Seite (kind:'board', url/title im
// Rueckgabewert) ist bereits in lib/items.test.mjs abgedeckt.
test('POST /api/pc/send-to-board fuer unbekanntes Item liefert 400', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/pc/send-to-board`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: 'https://nicht-vorhanden.example/' }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/pc/undo-done ohne normalizedUrl liefert 400', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/pc/undo-done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/pc/undo-done ohne passenden Archiv-Eintrag liefert 400', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/pc/undo-done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: 'https://nie-erledigt.example/' }),
    });
    assert.equal(res.status, 400);
  });
});

// Runde-3-Befund #3/#4: "Erledigt" konnte bisher nicht rueckgaengig gemacht
// werden. Ende-zu-Ende ueber die echten HTTP-Endpunkte: erledigen, dann
// rueckgaengig machen, Item muss wieder in "Am PC" (state 'pc') stehen.
test('POST /api/pc/done gefolgt von /api/pc/undo-done stellt das Item wieder her', async () => {
  await withServer(async (base) => {
    await mergeScan(undefined, [{ id: '1', url: 'https://pc.example/', title: 'PC-Titel' }]);
    await setStates(undefined, [['https://pc.example/', 'pc']]);
    await applyCloseResults(undefined, ['https://pc.example/']);

    const doneRes = await fetch(`${base}/api/pc/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: 'https://pc.example/' }),
    });
    assert.equal(doneRes.status, 200);
    assert.equal((await (await fetch(`${base}/api/items`)).json()).length, 0);

    const undoRes = await fetch(`${base}/api/pc/undo-done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: 'https://pc.example/' }),
    });
    assert.equal(undoRes.status, 200);

    const itemsAfterUndo = await (await fetch(`${base}/api/items`)).json();
    assert.equal(itemsAfterUndo.length, 1);
    assert.equal(itemsAfterUndo[0].state, 'pc');
    assert.equal(itemsAfterUndo[0].title, 'PC-Titel');

    const archiveAfterUndo = await (await fetch(`${base}/api/search?q=pc.example`)).json();
    assert.deepEqual(archiveAfterUndo.results, [], 'kein Phantom-Archiv-Eintrag nach dem Rueckgaengigmachen');
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

test('GET /api/search ohne q liefert leere Ergebnisliste bei leerem Archiv', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/search`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { results: [] });
  });
});

// Vorschlag 4 der Produktanalyse: ohne Suchbegriff blaettern statt []
// zurueckzugeben - vorher war das Archiv nur sichtbar, wenn man den
// richtigen Begriff erriet.
test('GET /api/search ohne q blaettert das Archiv chronologisch (neueste zuerst)', async () => {
  await withServer(async (base) => {
    await appendArchiveRecords([
      { normalizedUrl: 'https://alt.example/', url: 'https://alt.example/', title: 'alt', domain: 'alt.example', kind: 'done', device: 'default', at: '2026-01-01T00:00:00.000Z', firstSeen: '2026-01-01T00:00:00.000Z' },
      { normalizedUrl: 'https://neu.example/', url: 'https://neu.example/', title: 'neu', domain: 'neu.example', kind: 'archived', device: 'default', at: '2026-06-01T00:00:00.000Z', firstSeen: '2026-06-01T00:00:00.000Z' },
    ]);
    const res = await fetch(`${base}/api/search`);
    const { results } = await res.json();
    assert.equal(results.length, 2);
    assert.equal(results[0].normalizedUrl, 'https://neu.example/', 'neueste zuerst');
    assert.equal(results[1].normalizedUrl, 'https://alt.example/');
  });
});

test('GET /api/search ohne q respektiert limit/offset', async () => {
  await withServer(async (base) => {
    const records = [];
    for (let i = 0; i < 5; i++) {
      records.push({
        normalizedUrl: `https://seite${i}.example/`,
        url: `https://seite${i}.example/`,
        title: `s${i}`,
        domain: `seite${i}.example`,
        kind: 'done',
        device: 'default',
        at: `2026-0${i + 1}-01T00:00:00.000Z`,
        firstSeen: `2026-0${i + 1}-01T00:00:00.000Z`,
      });
    }
    await appendArchiveRecords(records);
    const page1 = await (await fetch(`${base}/api/search?limit=2&offset=0`)).json();
    assert.equal(page1.results.length, 2);
    assert.equal(page1.results[0].normalizedUrl, 'https://seite4.example/', 'neueste zuerst');
    const page2 = await (await fetch(`${base}/api/search?limit=2&offset=2`)).json();
    assert.equal(page2.results.length, 2);
    assert.notEqual(page2.results[0].normalizedUrl, page1.results[0].normalizedUrl, 'zweite Seite ueberlappt nicht mit der ersten');
  });
});

// Ein Suchbegriff schraenkt die Trefferliste selbst schon ein - limit/offset
// duerfen dort nicht zusaetzlich kappen, sonst waeren Treffer unauffindbar,
// die durch Zufall hinter der Seitengroesse liegen.
test('GET /api/search mit q ignoriert limit - Trefferliste bleibt vollstaendig', async () => {
  await withServer(async (base) => {
    const records = [];
    for (let i = 0; i < 3; i++) {
      records.push({
        normalizedUrl: `https://treffer${i}.example/`,
        url: `https://treffer${i}.example/`,
        title: `Gesuchter Begriff ${i}`,
        domain: `treffer${i}.example`,
        kind: 'done',
        device: 'default',
        at: new Date().toISOString(),
        firstSeen: new Date().toISOString(),
      });
    }
    await appendArchiveRecords(records);
    const res = await fetch(`${base}/api/search?q=Gesuchter&limit=1`);
    const { results } = await res.json();
    assert.equal(results.length, 3, 'limit darf eine echte Suche nicht kappen');
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

// Aufgabe 6: Archiv nach Domain filtern.
async function seedServerArchive() {
  const rec = (domain, kind, n) => ({
    normalizedUrl: `https://${domain}/${n}`,
    url: `https://${domain}/${n}`,
    title: `Seite ${n}`,
    domain,
    kind,
    device: 'default',
    at: `2026-02-0${n}T00:00:00.000Z`,
    firstSeen: '2026-02-01T00:00:00.000Z',
  });
  await appendArchiveRecords([
    rec('github.com', 'archived', 1),
    rec('github.com', 'done', 2),
    rec('github.com', 'dropped', 3),
    rec('other.example', 'archived', 4),
  ]);
}

test('GET /api/search?domain= liefert nur Eintraege dieser Domain (Blaettern, Suche, includeDropped)', async () => {
  await withServer(async (base) => {
    await seedServerArchive();
    const browse = await (await fetch(`${base}/api/search?domain=github.com`)).json();
    assert.deepEqual(browse.results.map((r) => r.normalizedUrl).sort(), ['https://github.com/1', 'https://github.com/2']);
    const dropped = await (await fetch(`${base}/api/search?domain=github.com&includeDropped=1`)).json();
    assert.equal(dropped.results.length, 3);
    const search = await (await fetch(`${base}/api/search?domain=github.com&q=seite`)).json();
    assert.equal(search.results.length, 2);
    const none = await (await fetch(`${base}/api/search?domain=${encodeURIComponent("x'; DROP TABLE archive;--")}`)).json();
    assert.deepEqual(none.results, []);
    const all = await (await fetch(`${base}/api/search`)).json();
    assert.equal(all.results.length, 3, 'ohne domain bleibt alles sichtbar');
  });
});

test('GET /api/search?domain= mit mehr als 253 Zeichen liefert 400', async () => {
  await withServer(async (base) => {
    const ok = await fetch(`${base}/api/search?domain=${'a'.repeat(253)}`);
    assert.equal(ok.status, 200);
    const tooLong = await fetch(`${base}/api/search?domain=${'a'.repeat(254)}`);
    assert.equal(tooLong.status, 400);
    assert.match((await tooLong.json()).error, /Domain/);
  });
});

test('GET /api/archive/domains liefert [{domain, count}], haeufigste zuerst, respektiert includeDropped', async () => {
  await withServer(async (base) => {
    await seedServerArchive();
    const res = await fetch(`${base}/api/archive/domains`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [
      { domain: 'github.com', count: 2 },
      { domain: 'other.example', count: 1 },
    ]);
    const withDropped = await (await fetch(`${base}/api/archive/domains?includeDropped=1`)).json();
    assert.deepEqual(withDropped[0], { domain: 'github.com', count: 3 });
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

// POST /api/open-external startet fuer jede URL einen Prozess und bekommt die
// URLs aus eingelesenen Tabs, also aus Fremddaten. Die Pruefung davor ist
// damit sicherheitsrelevant und nicht bloss Bequemlichkeit: ohne sie liesse
// sich ueber einen praeparierten Tab-Eintrag ein beliebiger Protokoll-Handler
// starten. Diese Tests decken genau die Ablehnungen ab - der Erfolgsfall
// wuerde einen echten Browser oeffnen und gehoert deshalb nicht hierher.
test('POST /api/open-external lehnt nicht-http(s)-Schemata ab', async () => {
  await withServer(async (base) => {
    const blocked = ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-msdt:/id', 'data:text/html,x'];
    for (const url of blocked) {
      const res = await fetch(`${base}/api/open-external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      assert.equal(res.status, 400, `${url} haette abgelehnt werden muessen`);
      assert.match((await res.json()).error, /http/i);
    }
  });
});

test('POST /api/open-external lehnt fehlende und unparsbare URLs ab', async () => {
  await withServer(async (base) => {
    const post = (body) =>
      fetch(`${base}/api/open-external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    assert.equal((await post({})).status, 400, 'ohne URL muss 400 kommen');
    assert.equal((await post({ urls: [] })).status, 400, 'leere Liste muss 400 kommen');
    assert.equal((await post({ url: 'kein-url' })).status, 400, 'unparsbare URL muss 400 kommen');
  });
});

test('POST /api/open-external deckelt die Anzahl der Links', async () => {
  await withServer(async (base) => {
    const urls = Array.from({ length: 51 }, (_, i) => `https://example.com/${i}`);
    const res = await fetch(`${base}/api/open-external`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /50/);
  });
});

// POST /api/pc/bulk-return validiert VOR jedem ADB-Zugriff (siehe Kommentar
// im Handler) - diese Pfade sind ohne echtes Geraet testbar, der eigentliche
// Erfolgsfall (cdp.openMany) braucht echte Hardware und ist wie scan/restore/
// close-decided bewusst nicht per node:test abgedeckt.
test('POST /api/pc/bulk-return lehnt leere Anfragen ab', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/pc/bulk-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /URLs/);
  });
});

test('POST /api/pc/bulk-return lehnt ab, wenn keine der URLs in der PC-Arbeitsliste steht', async () => {
  await withServer(async (base) => {
    await mergeScan(undefined, [{ id: '1', url: 'https://a.example/', title: 'A' }]);
    // Item bleibt state 'open' - nicht 'pc', also kein gueltiges Ziel.
    const res = await fetch(`${base}/api/pc/bulk-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrls: ['https://a.example/', 'https://unbekannt.example/'] }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /PC-Arbeitsliste/);
  });
});

test('POST /api/pc/bulk-return deckelt die Anzahl der Tabs', async () => {
  await withServer(async (base) => {
    const urls = Array.from({ length: 201 }, (_, i) => `https://example.com/${i}`);
    const res = await fetch(`${base}/api/pc/bulk-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrls: urls }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /200/);
  });
});
