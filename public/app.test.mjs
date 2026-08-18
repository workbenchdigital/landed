import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// public/app.js laeuft im Browser (document, window, fetch als Globals) und
// laesst sich darum nicht einfach in node:test importieren, ohne eine ganze
// DOM-Umgebung vorzutaeuschen - fuer diesen einen Zweck waere das mehr
// Infrastruktur als der Fehler wert ist. Stattdessen ein gezielter Text-
// Check gegen genau die Fehlerklasse, die real aufgetreten ist: ein in der
// Legende/Hinweiszeile beworbenes Kuerzel rief eine Funktion auf, die nirgends
// definiert war (openSnoozeEditor statt openSnoozeMenu) - ReferenceError erst
// beim Druecken der Taste, nicht beim Start und nicht durch `node --check`
// (Syntaxpruefung sieht undefinierte Bezeichner nicht).
const appJs = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'app.js'),
  'utf8'
);

test('W-Kuerzel ruft eine tatsaechlich definierte Funktion auf', () => {
  const wCase = appJs.match(/if \(key === 'w' && focusedKey\) \{[\s\S]*?\n {2}\}/);
  assert.ok(wCase, 'W-Handler im keydown-Listener nicht gefunden - Legende/i18n pruefen, ob das Kuerzel noch beworben wird');

  const call = wCase[0].match(/(\w+)\(slot,/);
  assert.ok(call, 'kein Funktionsaufruf mit (slot, ...) im W-Handler gefunden');

  const fnName = call[1];
  const isDefined = new RegExp(`function ${fnName}\\(|const ${fnName} = `).test(appJs);
  assert.ok(isDefined, `W-Handler ruft "${fnName}" auf, aber diese Funktion ist in app.js nicht definiert`);
});

test('kein toter Verweis auf den frueheren Tippfehler openSnoozeEditor', () => {
  assert.ok(!appJs.includes('openSnoozeEditor'), 'openSnoozeEditor existiert nicht - die korrekte Funktion heisst openSnoozeMenu');
});

// Vorschlag 2 aus der Produktanalyse: "Aeltestes zuerst"-Sortiermodus.
// Textueller Regressionstest fuer die Verkabelung (die eigentliche Sortier-
// LOGIK ist per Browser-Nachstellung an einer isolierten Instanz mit
// gestaffeltem Testbestand verifiziert, siehe PR-Beschreibung - DOM-Verhalten
// gehoert nicht in node:test, siehe Begruendung oben in dieser Datei).
test('dritter Sortiermodus "age" ist in HTML, i18n und app.js konsistent verdrahtet', () => {
  const indexHtml = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),
    'utf8'
  );
  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  assert.match(indexHtml, /data-sort-value="age"/, 'Sortier-Knopf fuer "age" fehlt in index.html');
  assert.match(appJs, /domainSortMode === 'age'/, 'groupByDomain() wertet den age-Modus nicht aus');
  assert.match(appJs, /function byAgeAscending/, 'Sortierfunktion fehlt');
  for (const key of ['sortAgeLabel', 'ageToday', 'ageYesterday', 'ageDays']) {
    const count = (i18n.match(new RegExp(`${key}:`, 'g')) || []).length;
    assert.equal(count, 2, `${key} muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
  }
});

// Vorschlag 3 aus der Produktanalyse: Mehrfachauswahl in "Am PC". Textueller
// Verkabelungstest (Verhalten selbst per Browser-Nachstellung an einer
// isolierten Instanz verifiziert, siehe PR-Beschreibung).
test('Mehrfachauswahl-Aktionen fuer "Am PC" sind vollstaendig verdrahtet', () => {
  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  assert.match(appJs, /function bulkPcDone/, 'bulkPcDone fehlt');
  assert.match(appJs, /function bulkPcReturn/, 'bulkPcReturn fehlt');
  assert.match(appJs, /function bulkSetSnooze/, 'bulkSetSnooze fehlt');
  assert.match(appJs, /function makePcSelectionActions/, 'makePcSelectionActions fehlt');
  assert.match(appJs, /selectedKeys\.clear\(\);\s*\n\s*for \(const view of VIEWS\)|selectedKeys\.clear\(\);/, 'setView() muss die Auswahl bei Ablagenwechsel leeren');
  assert.match(appJs, /'\/api\/pc\/bulk-return'/, 'Client ruft den Sammel-Endpunkt nicht auf');

  for (const key of ['bulkDoneToast', 'bulkReturnedToast', 'bulkSnoozeToast', 'bulkReturnConfirm']) {
    const count = (i18n.match(new RegExp(`${key}:`, 'g')) || []).length;
    assert.equal(count, 2, `${key} muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
  }
});
