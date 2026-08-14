import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeScan,
  setStates,
  setNote,
  applyCloseResults,
  markDone,
  getItems,
  getMeta,
  appendArchiveRecords,
  searchArchive,
  setDeviceLabel,
  adoptDefaultBucket,
  readArchiveIndex,
  closeStore,
  DEFAULT_DEVICE,
} from './items.mjs';
import { withTempData } from './test-helpers.mjs';

function tab(id, url, title = 'Titel') {
  return { id, url, title };
}

test('mergeScan legt neue Tabs als state "open" an', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://a.example/')]);
    const items = await getItems();
    assert.equal(items.length, 1);
    assert.equal(items[0].state, 'open');
    assert.equal(items[0].normalizedUrl, 'https://a.example/');
  });
});

test('mergeScan aendert bei erneuter Anwesenheit nie den state (Zustand ist Absicht, nicht Messwert)', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://a.example/')]);
    await setStates(undefined, [['https://a.example/', 'keep']]);
    await mergeScan(undefined, [tab('1', 'https://a.example/', 'Neuer Titel')]);
    const [item] = await getItems();
    assert.equal(item.state, 'keep', 'state wurde faelschlich vom Scan ueberschrieben');
    assert.equal(item.title, 'Neuer Titel', 'Titel haette trotzdem aktualisiert werden muessen');
  });
});

test('mergeScan markiert abwesende Tabs als missingSince bei normalem Rueckgang', async () => {
  await withTempData(async () => {
    const many = Array.from({ length: 20 }, (_, i) => tab(String(i), `https://viele-${i}.example/`));
    await mergeScan(undefined, many);

    // Normaler Rueckgang (< 15%): ein Tab fehlt, Rest bleibt anwesend.
    await mergeScan(undefined, many.slice(1));
    const afterNormal = await getItems();
    const missing = afterNormal.find((i) => i.normalizedUrl === 'https://viele-0.example/');
    assert.ok(missing.missingSince, 'fehlender Tab haette missingSince bekommen muessen');
    assert.equal(missing.missedScans, 1);
  });
});

// Nutzerfrage nach echtem Einsatz: ein bereits entschiedener Tab (behalten/
// nur PC/archiviert/verworfen/vorgemerkt) soll nicht "aus Versehen
// verschwinden" koennen, nur weil er unabhaengig am Handy geschlossen wurde.
test('mergeScan markiert bereits entschiedene Items NICHT als missingSince', async () => {
  await withTempData(async () => {
    const many = Array.from({ length: 20 }, (_, i) => tab(String(i), `https://d-${i}.example/`));
    await mergeScan(undefined, many);
    await setStates(undefined, [['https://d-0.example/', 'keep'], ['https://d-1.example/', 'archive']]);

    // Beide Items fehlen jetzt im naechsten Scan - unabhaengig am Handy geschlossen.
    await mergeScan(undefined, many.slice(2));
    const after = await getItems();
    const keep = after.find((i) => i.normalizedUrl === 'https://d-0.example/');
    const archived = after.find((i) => i.normalizedUrl === 'https://d-1.example/');
    assert.equal(keep.missingSince, null, 'entschiedenes "keep"-Item darf nicht als vermisst markiert werden');
    assert.equal(archived.missingSince, null, 'entschiedenes "archive"-Item darf nicht als vermisst markiert werden');
  });
});

// Migrations-Fall: Items, die unter der alten (zustandsunabhaengigen) Regel
// bereits missingSince gesetzt bekamen, bevor eine Entscheidung getroffen
// wurde, sollen beim naechsten Scan aufgeraeumt werden, sobald sie entschieden sind.
test('mergeScan raeumt altes missingSince auf, sobald ein zuvor vermisstes Item entschieden wird', async () => {
  await withTempData(async () => {
    const many = Array.from({ length: 20 }, (_, i) => tab(String(i), `https://o-${i}.example/`));
    await mergeScan(undefined, many);
    await mergeScan(undefined, many.slice(1)); // o-0 fehlt, wird als vermisst markiert (noch unentschieden)
    const beforeDecision = (await getItems()).find((i) => i.normalizedUrl === 'https://o-0.example/');
    assert.ok(beforeDecision.missingSince, 'Vorbedingung: Item sollte als vermisst markiert sein');

    await setStates(undefined, [['https://o-0.example/', 'drop']]);
    await mergeScan(undefined, many.slice(1)); // weiterhin abwesend, aber jetzt entschieden
    const afterDecision = (await getItems()).find((i) => i.normalizedUrl === 'https://o-0.example/');
    assert.equal(afterDecision.missingSince, null, 'entschiedenes Item haette bereinigt werden muessen');
    assert.equal(afterDecision.missedScans, 0);
  });
});

test('mergeScan laesst Durchgang 2 bei verdaechtigem Einbruch komplett aus', async () => {
  await withTempData(async () => {
    // Baseline bewusst > 20, damit sie nach dem Einbruch fuer die
    // >=20-Schwelle noch relevant ist (die alte Schwelle bezieht sich auf
    // die Baseline VOR dem Einbruch, nicht auf die neue, kleine Tabzahl).
    const many = Array.from({ length: 25 }, (_, i) => tab(String(i), `https://v-${i}.example/`));
    await mergeScan(undefined, many);

    // 25 -> 3 ist ein Einbruch von 88%, deutlich ueber der 15%-Schwelle.
    await mergeScan(undefined, many.slice(0, 3));
    const afterSuspicious = await getItems();
    const notPunished = afterSuspicious.find((i) => i.normalizedUrl === 'https://v-10.example/');
    assert.equal(notPunished.missedScans, 0, 'verdaechtiger Scan haette Durchgang 2 nicht ausfuehren duerfen');
    assert.equal(notPunished.missingSince, null);
  });
});

test('mergeScan mit leerem Tab-Array bricht ab, ohne den Bestand zu veraendern', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://a.example/')]);
    const result = await mergeScan(undefined, []);
    assert.equal(result.aborted, true);
    const items = await getItems();
    assert.equal(items.length, 1, 'Bestand haette bei leerem Scan unangetastet bleiben muessen');
  });
});

test('mergeScan setzt seenBefore anhand von archive.jsonl', async () => {
  await withTempData(async () => {
    await appendArchiveRecords([
      {
        normalizedUrl: 'https://schon-archiviert.example/',
        url: 'https://schon-archiviert.example/',
        title: 'x',
        domain: 'schon-archiviert.example',
        kind: 'archived',
        device: 'default',
        at: new Date().toISOString(),
        firstSeen: new Date().toISOString(),
      },
    ]);
    await mergeScan(undefined, [tab('1', 'https://schon-archiviert.example/')]);
    const [item] = await getItems();
    assert.equal(item.seenBefore, true);
  });
});

test('mergeScan setzt closedAt eines pc-Items zurueck, wenn der Tab wieder auftaucht', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://a.example/')]);
    await setStates(undefined, [['https://a.example/', 'pc']]);
    await applyCloseResults(undefined, ['https://a.example/']);
    let [item] = await getItems();
    assert.ok(item.closedAt, 'closedAt haette nach applyCloseResults gesetzt sein muessen');

    await mergeScan(undefined, [tab('99', 'https://a.example/')]);
    [item] = await getItems();
    assert.equal(item.closedAt, null, 'closedAt haette bei erneuter Anwesenheit zurueckgesetzt werden muessen');
    assert.equal(item.state, 'pc', 'state bleibt trotzdem pc - Merge aendert nie den state');
  });
});

test('setStates: null setzt state zurueck auf open', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://a.example/')]);
    await setStates(undefined, [['https://a.example/', 'archive']]);
    await setStates(undefined, [['https://a.example/', null]]);
    const [item] = await getItems();
    assert.equal(item.state, 'open');
  });
});

test('applyCloseResults: archive/drop verlassen items.json und landen in archive.jsonl mit passendem kind', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://arch.example/'), tab('2', 'https://drop.example/')]);
    await setStates(undefined, [
      ['https://arch.example/', 'archive'],
      ['https://drop.example/', 'drop'],
    ]);
    const result = await applyCloseResults(undefined, ['https://arch.example/', 'https://drop.example/']);
    assert.equal(result.archivedCount, 2);

    const items = await getItems();
    assert.equal(items.length, 0, 'archivierte/verworfene Items muessen den Item-Bestand verlassen');

    const archived = await searchArchive('example', { includeDropped: true });
    assert.equal(archived.find((l) => l.normalizedUrl === 'https://arch.example/').kind, 'archived');
    assert.equal(archived.find((l) => l.normalizedUrl === 'https://drop.example/').kind, 'dropped');
  });
});

test('applyCloseResults: pc-Items bleiben in items.json mit closedAt und leeren duplicateIds', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://pc.example/')]);
    await setStates(undefined, [['https://pc.example/', 'pc']]);
    await applyCloseResults(undefined, ['https://pc.example/']);

    const items = await getItems();
    assert.equal(items.length, 1, 'pc-Item darf items.json nicht verlassen');
    assert.ok(items[0].closedAt);
    assert.deepEqual(items[0].duplicateIds, []);
  });
});

// Stufe D (Plan "Optimierung nach Nutzungs-Audit"): Notiz ging beim
// Archivieren bisher ersatzlos verloren - archiveRecords uebernahmen sie
// nicht. Deckt sowohl den Archivieren/Verwerfen-Pfad (applyCloseResults)
// als auch "erledigt" (markDone) ab, da beide unabhaengig den Record bauen.
test('applyCloseResults/markDone: Notiz reist mit ins archive.jsonl', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://arch.example/'), tab('2', 'https://pc.example/')]);
    await setStates(undefined, [
      ['https://arch.example/', 'archive'],
      ['https://pc.example/', 'pc'],
    ]);
    await setNote(undefined, 'https://arch.example/', 'Fuer spaeter aufheben');
    await setNote(undefined, 'https://pc.example/', 'Noch pruefen');

    await applyCloseResults(undefined, ['https://arch.example/', 'https://pc.example/']);
    await markDone(undefined, 'https://pc.example/');

    const archived = await searchArchive('example', { includeDropped: true });
    assert.equal(archived.find((l) => l.normalizedUrl === 'https://arch.example/').note, 'Fuer spaeter aufheben');
    assert.equal(archived.find((l) => l.kind === 'done').note, 'Noch pruefen');
  });
});

test('markDone: pc-Item wechselt nach archive.jsonl mit kind "done"', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://pc.example/')]);
    await setStates(undefined, [['https://pc.example/', 'pc']]);
    await applyCloseResults(undefined, ['https://pc.example/']);

    const result = await markDone(undefined, 'https://pc.example/');
    assert.equal(result.ok, true);
    assert.equal((await getItems()).length, 0);

    const archived = await searchArchive('pc.example');
    assert.equal(archived.length, 1);
    assert.equal(archived[0].kind, 'done');
  });
});

test('meta.json: lastScanSourceCount bleibt bei verdaechtigem Scan auf der alten Baseline', async () => {
  await withTempData(async () => {
    const many = Array.from({ length: 20 }, (_, i) => tab(String(i), `https://v-${i}.example/`));
    await mergeScan(undefined, many);
    await mergeScan(undefined, many.slice(0, 3)); // verdaechtiger Einbruch
    const meta = await getMeta();
    assert.equal(meta.lastScanSourceCount, 20, 'Baseline haette bei einem erkannten Einbruch nicht ueberschrieben werden duerfen');
  });
});

test('searchArchive: leere Anfrage liefert leeres Array ohne Dateizugriff', async () => {
  await withTempData(async () => {
    assert.deepEqual(await searchArchive(''), []);
    assert.deepEqual(await searchArchive('   '), []);
  });
});

test('searchArchive: ohne archive.jsonl liefert leeres Array statt ENOENT zu werfen', async () => {
  await withTempData(async () => {
    assert.deepEqual(await searchArchive('irgendwas'), []);
  });
});

test('searchArchive: findet Treffer per Titel, URL oder Notiz, unabhaengig von Gross-/Kleinschreibung, neueste zuerst', async () => {
  await withTempData(async () => {
    await appendArchiveRecords([
      { normalizedUrl: 'https://a.example/x', url: 'https://a.example/x', title: 'Rezept Kuchen', domain: 'a.example', kind: 'archived', device: null, at: '2026-01-01T00:00:00.000Z', firstSeen: '2026-01-01T00:00:00.000Z' },
    ]);
    await appendArchiveRecords([
      { normalizedUrl: 'https://b.example/', url: 'https://b.example/', title: 'Ohne Treffer im Titel', domain: 'b.example', kind: 'archived', device: null, at: '2026-01-02T00:00:00.000Z', firstSeen: '2026-01-02T00:00:00.000Z', note: 'Kuchen fuer Sonntag' },
    ]);
    await appendArchiveRecords([
      { normalizedUrl: 'https://c.example/', url: 'https://c.example/', title: 'Kein Treffer', domain: 'c.example', kind: 'archived', device: null, at: '2026-01-03T00:00:00.000Z', firstSeen: '2026-01-03T00:00:00.000Z' },
    ]);

    const results = await searchArchive('KUCHEN');
    assert.equal(results.length, 2);
    assert.equal(results[0].normalizedUrl, 'https://b.example/', 'neuester Treffer zuerst, hier per Notiz');
    assert.equal(results[1].normalizedUrl, 'https://a.example/x');
  });
});

// Stufe D (Plan "Optimierung nach Nutzungs-Audit"): Verworfenes bleibt
// gespeichert (Wiedererkennung), soll aber nicht wie ein gleichwertiger
// Archiv-Treffer erscheinen, solange niemand ausdruecklich danach sucht.
test('searchArchive: blendet kind "dropped" per Default aus, includeDropped zeigt es', async () => {
  await withTempData(async () => {
    await appendArchiveRecords([
      { normalizedUrl: 'https://a.example/kuchen', url: 'https://a.example/kuchen', title: 'Kuchen-Rezept', domain: 'a.example', kind: 'dropped', device: null, at: '2026-01-01T00:00:00.000Z', firstSeen: '2026-01-01T00:00:00.000Z' },
    ]);

    assert.deepEqual(await searchArchive('kuchen'), []);
    const withDropped = await searchArchive('kuchen', { includeDropped: true });
    assert.equal(withDropped.length, 1);
    assert.equal(withDropped[0].kind, 'dropped');
  });
});

test('searchArchive: gecachtes Ergebnis wird nach einer weiteren Archivierung invalidiert (mtimeMs aendert sich)', async () => {
  await withTempData(async () => {
    await appendArchiveRecords([
      { normalizedUrl: 'https://a.example/', url: 'https://a.example/', title: 'Einzigartig-1', domain: 'a.example', kind: 'archived', device: null, at: '2026-01-01T00:00:00.000Z', firstSeen: '2026-01-01T00:00:00.000Z' },
    ]);
    assert.equal((await searchArchive('einzigartig')).length, 1);

    await appendArchiveRecords([
      { normalizedUrl: 'https://b.example/', url: 'https://b.example/', title: 'Einzigartig-2', domain: 'b.example', kind: 'archived', device: null, at: '2026-01-02T00:00:00.000Z', firstSeen: '2026-01-02T00:00:00.000Z' },
    ]);
    assert.equal((await searchArchive('einzigartig')).length, 2);
  });
});

test('setDeviceLabel setzt das Label, ohne die Items zu veraendern', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://a.example/')]);
    await setDeviceLabel(DEFAULT_DEVICE, 'Mein Pixel');
    const meta = await getMeta();
    assert.equal(meta.label, 'Mein Pixel');
    assert.equal((await getItems()).length, 1);
  });
});

test('adoptDefaultBucket: leeres/fremdes Geraet bleibt No-Op', async () => {
  await withTempData(async () => {
    await adoptDefaultBucket(); // kein serial
    await adoptDefaultBucket(DEFAULT_DEVICE); // serial == DEFAULT_DEVICE
    assert.equal((await getItems()).length, 0);
    assert.equal((await getItems('ABC123')).length, 0);
  });
});

test('adoptDefaultBucket: erste Geraeteauswahl uebernimmt den bestehenden DEFAULT_DEVICE-Bestand', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://a.example/'), tab('2', 'https://b.example/')]);
    await adoptDefaultBucket('ABC123');

    assert.equal((await getItems()).length, 0, 'DEFAULT_DEVICE-Bucket sollte jetzt leer sein (umbenannt)');
    const migrated = await getItems('ABC123');
    assert.equal(migrated.length, 2);
  });
});

test('adoptDefaultBucket: zweites Geraet bekommt keinen fremden Bestand mehr (Ziel-Check greift nach der ersten Uebernahme)', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://a.example/')]);
    await adoptDefaultBucket('ABC123');
    await adoptDefaultBucket('XYZ789'); // DEFAULT_DEVICE existiert nicht mehr -> No-Op
    assert.equal((await getItems('XYZ789')).length, 0);
    assert.equal((await getItems('ABC123')).length, 1, 'Bestand des ersten Geraets bleibt unangetastet');
  });
});

// ---------------------------------------------------------------------------
// Uebernahme des alten JSON-Bestands in die SQLite-Datei. Vertragsgrundlage
// ist das komplette Item-Schema (siehe newItem() in items.mjs) - jedes Feld
// muss den Weg ueberstehen, nicht nur die offensichtlichen.
// ---------------------------------------------------------------------------
const LEGACY_ITEM = {
  url: 'https://alt.example/seite?x=1',
  title: 'Alter Titel',
  domain: 'alt.example',
  state: 'pc',
  firstSeen: '2026-01-01T10:00:00.000Z',
  lastSeen: '2026-02-02T11:00:00.000Z',
  stateChangedAt: '2026-02-03T12:00:00.000Z',
  snoozeUntil: '2026-09-01',
  missingSince: '2026-02-04T13:00:00.000Z',
  missedScans: 3,
  closedAt: '2026-02-05T14:00:00.000Z',
  note: 'Notiz mit Umlaut: Grosse Uebung',
  duplicateCount: 2,
  duplicateIds: ['A1', 'B2'],
  seenBefore: true,
};

async function writeLegacyJson(dir) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = (await import('node:path')).default;
  await mkdir(path.join(dir, 'devices', DEFAULT_DEVICE), { recursive: true });
  await writeFile(
    path.join(dir, 'devices', DEFAULT_DEVICE, 'items.json'),
    JSON.stringify({
      'https://alt.example/seite?x=1': LEGACY_ITEM,
      'https://zweitens.example/': { ...LEGACY_ITEM, url: 'https://zweitens.example/', state: 'open', duplicateIds: [], seenBefore: false },
    })
  );
  await writeFile(
    path.join(dir, 'devices', DEFAULT_DEVICE, 'meta.json'),
    JSON.stringify({ serial: 'SERIAL42', label: 'Altes Pixel', lastScan: '2026-02-02T11:00:00.000Z', lastScanSourceCount: 42, schema: 2, migratedAt: '2026-01-01T00:00:00.000Z' })
  );
  await writeFile(
    path.join(dir, 'archive.jsonl'),
    [
      JSON.stringify({ normalizedUrl: 'https://arch.example/', url: 'https://arch.example/', title: 'Archiviert', domain: 'arch.example', kind: 'archived', device: 'SERIAL42', at: '2026-01-05T00:00:00.000Z', firstSeen: '2026-01-04T00:00:00.000Z', note: 'Alte Notiz' }),
      JSON.stringify({ normalizedUrl: 'https://weg.example/', url: 'https://weg.example/', title: 'Verworfen', domain: 'weg.example', kind: 'dropped', device: 'SERIAL42', at: '2026-01-06T00:00:00.000Z', firstSeen: '2026-01-04T00:00:00.000Z' }),
      '{ kaputte zeile', // abgeschnittener Absturz-Rest - darf die Uebernahme nicht kippen
      '',
    ].join('\n')
  );
}

test('Uebernahme aus JSON: jedes Item-Feld ueberlebt den Weg nach SQLite', async () => {
  await withTempData(async (dir) => {
    await writeLegacyJson(dir);

    const items = await getItems();
    assert.equal(items.length, 2);
    const [first] = items;
    assert.equal(first.normalizedUrl, 'https://alt.example/seite?x=1', 'Reihenfolge aus items.json muss erhalten bleiben');
    for (const [key, value] of Object.entries(LEGACY_ITEM)) {
      assert.deepEqual(first[key], value, `Feld ${key} kam nicht unveraendert an`);
    }
    assert.equal(items[1].seenBefore, false, 'seenBefore muss ein Boolean bleiben, nicht 0/1');
    assert.deepEqual(items[1].duplicateIds, []);
  });
});

test('Uebernahme aus JSON: meta.json inklusive Zusatzfeldern und archive.jsonl kommen mit', async () => {
  await withTempData(async (dir) => {
    await writeLegacyJson(dir);

    const meta = await getMeta();
    assert.equal(meta.serial, 'SERIAL42');
    assert.equal(meta.label, 'Altes Pixel');
    assert.equal(meta.lastScanSourceCount, 42);
    assert.equal(meta.migratedAt, '2026-01-01T00:00:00.000Z', 'unbekannte Zusatzfelder duerfen nicht verloren gehen');

    const index = await readArchiveIndex();
    assert.equal(index.size, 2, 'die korrupte Zeile muss uebersprungen, die beiden gueltigen uebernommen werden');
    assert.ok(index.has('https://arch.example/'));

    assert.deepEqual((await searchArchive('verworfen')).length, 0, 'dropped bleibt per Default ausgeblendet');
    const dropped = await searchArchive('verworfen', { includeDropped: true });
    assert.equal(dropped[0].kind, 'dropped');
    const archived = await searchArchive('alte notiz');
    assert.equal(archived[0].normalizedUrl, 'https://arch.example/', 'Notiz-Treffer muss den Weg mitgemacht haben');
  });
});

test('Uebernahme aus JSON ist idempotent: zweiter Start uebernimmt nichts erneut', async () => {
  await withTempData(async (dir) => {
    await writeLegacyJson(dir);
    await setStates(undefined, [['https://alt.example/seite?x=1', 'keep']]);

    // Zweiter Programmstart auf demselben Datenverzeichnis: die JSON-Dateien
    // liegen noch da, die SQLite-Datei ist aber nicht mehr leer.
    closeStore();

    const items = await getItems();
    assert.equal(items.length, 2, 'kein doppelter Bestand nach erneutem Start');
    assert.equal(items[0].state, 'keep', 'die zwischenzeitliche Entscheidung darf nicht ueberschrieben werden');
    assert.equal((await readArchiveIndex()).size, 2, 'keine doppelten Archiv-Eintraege');
  });
});

// Eine beschaedigte items.json darf nicht als "nichts zu uebernehmen"
// durchgehen - der Bestand waere sonst weg und die Uebernahme als erledigt
// markiert. Lieber laut scheitern.
test('Uebernahme aus JSON: kaputte items.json bricht laut ab statt still zu leeren', async () => {
  await withTempData(async (dir) => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const path = (await import('node:path')).default;
    await mkdir(path.join(dir, 'devices', DEFAULT_DEVICE), { recursive: true });
    await writeFile(path.join(dir, 'devices', DEFAULT_DEVICE, 'items.json'), '{ "abgeschnitten": ');

    await assert.rejects(() => getItems(), /JSON/);
    await assert.rejects(() => getItems(), /JSON/, 'zweiter Versuch darf nicht still mit leerem Bestand durchgehen');
  });
});

// codemouseai-Review auf PR #26: readdirSync(dataPath('devices')) fing vorher
// JEDEN Fehler ab, nicht nur ENOENT - ein "devices" ist hier eine Datei statt
// eines Ordners (ENOTDIR), simuliert z.B. einen EACCES/IO-Fehler. Muss laut
// scheitern statt die Uebernahme mit leerem deviceDirs durchlaufen zu lassen
// und archive.jsonl (die es hier durchaus gibt) trotzdem zu uebernehmen -
// genau das partielle-Uebernahme-plus-spaeter-uebersprungen-Muster, das den
// Rest des Bestands endgueltig verloren haette.
test('Uebernahme aus JSON: devices/ nicht lesbar (kein ENOENT) bricht laut ab statt teilweise zu uebernehmen', async () => {
  await withTempData(async (dir) => {
    const { writeFile } = await import('node:fs/promises');
    const path = (await import('node:path')).default;
    await writeFile(path.join(dir, 'devices'), 'blockiert das Verzeichnis');
    await writeFile(path.join(dir, 'archive.jsonl'), JSON.stringify({ normalizedUrl: 'https://x.example/', url: 'https://x.example/', title: 'x', domain: 'x.example', kind: 'archived', device: null, at: '2026-01-01T00:00:00.000Z', firstSeen: '2026-01-01T00:00:00.000Z' }) + '\n');

    await assert.rejects(() => getItems(), /ENOTDIR/);
    // Zweiter Versuch (anderer Aufrufer) darf nicht still mit leerem Archiv
    // durchgehen - dieselbe "loud failure persists"-Eigenschaft wie beim
    // kaputte-items.json-Test oben, hier nur ueber einen anderen Einstieg.
    await assert.rejects(() => readArchiveIndex(), /ENOTDIR/, 'archive.jsonl darf nicht teilweise uebernommen werden, wenn devices/ scheitert');
  });
});

// normalizedUrl kommt bei setNote/setSnooze/setStates direkt aus dem
// Request-Body. Auf einem Objekt mit normalem Prototyp waere items['__proto__']
// truthy und die folgende Zuweisung landete auf Object.prototype.
test('unbekanntes Item "__proto__" verseucht den Prototyp nicht', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://a.example/')]);
    assert.deepEqual(await setNote(undefined, '__proto__', 'boese'), { ok: false });
    assert.equal({}.note, undefined, 'Object.prototype wurde verseucht');
    assert.equal((await getItems()).length, 1);
  });
});

test('Uebernahme aus JSON: ohne Altdaten passiert nichts', async () => {
  await withTempData(async () => {
    assert.equal((await getItems()).length, 0);
    assert.equal((await readArchiveIndex()).size, 0);
    assert.equal((await getMeta()).serial, null);
  });
});

// Nebenlaeufigkeits-Garantie wie bei store.mjs (setDecisionsMany) - hier auf
// mutate() als der einzigen Schreib-Primitive des Item-Stores.
test('setStates serialisiert parallele Schreibvorgaenge verlustfrei', async () => {
  await withTempData(async () => {
    const tabs = Array.from({ length: 20 }, (_, i) => tab(String(i), `https://parallel-${i}.example/`));
    await mergeScan(undefined, tabs);

    const writes = tabs.map((t, i) => setStates(undefined, [[`https://parallel-${i}.example/`, 'keep']]));
    await Promise.all(writes);

    const items = await getItems();
    assert.equal(items.length, 20);
    for (const item of items) {
      assert.equal(item.state, 'keep', `${item.normalizedUrl} hat den parallelen state-Wechsel verloren`);
    }
  });
});

// readAllSafe() (Reaktion auf zweimal beobachteten Nutzer-Fund: 0 Items
// trotz gesetztem lastScan nach sehr langer Prozesslaufzeit) darf einen
// echten, legitimen leeren Bestand (alles archiviert/verworfen) NICHT als
// "verdaechtig" behandeln - genau dieser Fall hat lastScan gesetzt UND 0
// Items zugleich, ganz ohne Fehler. Die eigentliche stale-Verbindung selbst
// laesst sich in einem schnellen Unit-Test nicht seriös nachstellen (das ist
// ein OS-/natives-Binding-Verhalten, kein Zustand, den man in JS herstellen
// kann) - hier wird nur die Guard-Bedingung gegen einen Fehlalarm geprueft.
test('getItems/mutate: alles archiviert bleibt leer, kein Fehlalarm trotz lastScan gesetzt', async () => {
  await withTempData(async () => {
    await mergeScan(undefined, [tab('1', 'https://a.example/')]);
    assert.ok((await getMeta()).lastScan, 'Testvoraussetzung: lastScan muss gesetzt sein');
    await setStates(undefined, [['https://a.example/', 'archive']]);
    await applyCloseResults(undefined, ['https://a.example/']);
    assert.equal((await getItems()).length, 0, 'echt leer nach Archivieren - kein Fehlalarm, keine Endlosschleife');
    // Eine weitere mutate()-Operation (z.B. erneuter Scan) muss auf dem
    // leeren Bestand normal weiterarbeiten, nicht auf einen alten Snapshot
    // zurueckfallen.
    await mergeScan(undefined, [tab('2', 'https://b.example/')]);
    assert.equal((await getItems()).length, 1);
  });
});
