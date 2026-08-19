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

// Runde 2 der Produktanalyse, Vorschlag 2: D/R-Kuerzel in "Am PC" - bisher
// waren Erledigt/Zurueck aufs Handy dort nur per Maus erreichbar, obwohl die
// Pfeiltasten-Navigation laengst funktioniert.
test('D/R-Kuerzel in "Am PC" rufen pcDone/pcReturn auf', () => {
  const pcBlock = appJs.match(/if \(activeView === 'pc' && focusedKey\) \{[\s\S]*?\n {2}\}/);
  assert.ok(pcBlock, 'PC-Tastatur-Block im keydown-Listener nicht gefunden');
  assert.match(pcBlock[0], /key === 'd'.*pcDone\(item\)/, 'D-Kuerzel ruft pcDone nicht auf');
  assert.match(pcBlock[0], /key === 'r'.*pcReturn\(item\)/, 'R-Kuerzel ruft pcReturn nicht auf');

  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  const count = (i18n.match(/pcKeyboardHintText:/g) || []).length;
  assert.equal(count, 2, `pcKeyboardHintText muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
});

// Runde 2, Vorschlag 1: faellige Wiedervorlagen waren bisher nur ein
// einmaliger Toast beim Start - jetzt zusaetzlich ein dauerhaftes Badge im
// Wiedervorlage-Reiter, solange etwas faellig ist.
test('Faellige Wiedervorlagen zeigen ein dauerhaftes Badge im Ablagen-Reiter', () => {
  assert.match(appJs, /function dueSnoozeCount/, 'dueSnoozeCount fehlt');
  assert.match(appJs, /tray-due/, 'tray-due Badge-Klasse wird nirgends gesetzt');
  const style = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'),
    'utf8'
  );
  assert.match(style, /\.tray-due/, 'CSS fuer .tray-due fehlt');
});

// Runde 2, Vorschlag 3: Erledigt-Zaehler im Kontrollstreifen - bisher zeigte
// der Streifen nur den Ist-Bestand, nie einen Zeitbezug.
test('Erledigt-Zaehler im Kontrollstreifen ist verdrahtet', () => {
  const indexHtml = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),
    'utf8'
  );
  assert.match(indexHtml, /id="doneThisWeek"/, 'Container fuer den Erledigt-Zaehler fehlt in index.html');
  assert.match(appJs, /doneThisWeek\.textContent = meta\.recentDoneCount/, 'loadScanMeta() setzt doneThisWeek nicht');

  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  const count = (i18n.match(/doneThisWeek:/g) || []).length;
  assert.equal(count, 2, `doneThisWeek muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
});

// codemouseai-Review auf PR #55: `if (meta.sourceCount)` behandelt 0 als
// falsy - ein Scan mit 0 gefundenen Tabs haette die Zeile auf dem Stand
// eines frueheren, groesseren Scans stehen lassen. loadScanMeta() muss
// stattdessen anhand von meta.timestamp entscheiden, ob schon gescannt wurde.
test('loadScanMeta() prueft meta.timestamp, nicht meta.sourceCount (0 ist ein gueltiger Scan)', () => {
  assert.doesNotMatch(appJs, /if \(meta\.sourceCount\)/, 'sourceCount als Truthy-Check ignoriert einen Scan mit 0 Tabs');
  assert.match(appJs, /meta\.timestamp \? formatMetaInfo\(meta\.sourceCount \?\? 0, meta\.timestamp\) : t\('metaInfoInitial'\)/);
});

// Vorschlag 4 der Produktanalyse: Archiv ohne Suchbegriff durchblaettern
// statt leer zu bleiben.
test('Archiv-Blaettermodus (Vorschlag 4) ist verdrahtet', () => {
  assert.match(appJs, /function loadArchiveBrowsePage/, 'loadArchiveBrowsePage fehlt');
  assert.match(appJs, /function renderArchiveBrowse/, 'renderArchiveBrowse fehlt');
  assert.match(appJs, /function makeArchiveRow/, 'makeArchiveRow (gemeinsame Zeile fuer Suche+Blaettern) fehlt');
  assert.match(appJs, /if \(!q\) return loadArchiveBrowsePage\(\{ reset: true \}\)/, 'runArchiveSearch muss bei leerer Anfrage blaettern statt abzubrechen');
  assert.doesNotMatch(appJs, /if \(!query\.trim\(\)\) \{\s*renderArchiveResults\(\[\], ''\);/, 'alter Fruehausstieg bei leerer Anfrage darf nicht mehr existieren');

  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  const count = (i18n.match(/archiveLoadMoreBtn:/g) || []).length;
  assert.equal(count, 2, `archiveLoadMoreBtn muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
});

// codemouseai-Review auf PR #56: ein schneller Doppelklick auf "Mehr laden"
// las denselben Offset zweimal und haengte die Seite doppelt an, bevor die
// erste Anfrage zurueckkam.
test('loadArchiveBrowsePage() verwirft veraltete Antworten per requestId', () => {
  assert.match(appJs, /let archiveBrowseRequestId = 0/, 'archiveBrowseRequestId fehlt');
  assert.match(appJs, /const requestId = \+\+archiveBrowseRequestId/, 'requestId wird nicht bei jedem Aufruf erhoeht');
  assert.match(appJs, /if \(requestId !== archiveBrowseRequestId\) return/, 'veraltete Antwort wird nicht verworfen');
});

// Runde 3, Befund #1: ein phase:'error'-Ereignis liess runStep() bisher nur
// toasten und normal zurueckkehren - der Aufrufer meldete danach faelschlich
// Erfolg mit dem `total` aus dem fruehen "start"-Ereignis.
test('runStep() wirft bei phase:"error" statt nur zu toasten und normal zurueckzukehren', () => {
  const errorBranch = appJs.match(/\} else if \(evt\.phase === 'error'\) \{[\s\S]*?\n {4}\}/);
  assert.ok(errorBranch, 'phase:"error"-Zweig in runStep() nicht gefunden');
  assert.match(errorBranch[0], /throw new Error\(evt\.message\)/, 'phase:"error" muss werfen, nicht nur toasten');
  assert.doesNotMatch(errorBranch[0], /toast\(/, 'kein Toast mehr hier - Aufrufer haben bereits einen eigenen catch mit derselben Aktion');

  assert.match(appJs, /await loadInventory\(\);\s*\n\s*btn\.disabled = false;/, 'runTransfer() muss auch nach einem Fehler neu laden (finally), nicht nur bei Erfolg');
});

// Runde 3, Befund #2: "Alle N im PC-Browser oeffnen" versprach die volle
// sichtbare Menge, der Server lehnte aber schon ab 51 URLs die GESAMTE
// Anfrage ab (server.mjs MAX_OPEN_URLS=50) - bei realistischen Bestaenden
// (283 Eintraege in "Am PC") oeffnete der Knopf dann buchstaeblich nichts.
test('openExternal() teilt in Chargen auf statt alles in einer Anfrage zu senden', () => {
  assert.match(appJs, /const OPEN_EXTERNAL_BATCH_SIZE = 50/, 'Chargengroesse fehlt');
  assert.match(appJs, /for \(let i = 0; i < urls\.length; i \+= OPEN_EXTERNAL_BATCH_SIZE\)/, 'openExternal() sendet nicht in Chargen');
  assert.match(appJs, /if \(!confirm\(t\('openAllInBrowserConfirm', \{ n: items\.length \}\)\)\) return;/, 'openAllInBrowser() fragt nicht mehr nach vor dem Oeffnen vieler Tabs');

  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  const count = (i18n.match(/openAllInBrowserConfirm:/g) || []).length;
  assert.equal(count, 2, `openAllInBrowserConfirm muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
});

// Runde 3, Befund #3/#4: "Erledigt" war irreversibel, ohne Toast, ohne
// Rueckgaengig - im Gegensatz zum harmlosen "Zurueck aufs Telefon", das
// vorher fragte. pcDone/bulkPcDone muessen jetzt einen Rueckgaengig-Toast
// zeigen, der /api/pc/undo-done aufruft.
test('pcDone/bulkPcDone bieten Rueckgaengig ueber undoPcDone an', () => {
  assert.match(appJs, /async function undoPcDone\(normalizedUrls\)/, 'undoPcDone fehlt');
  assert.match(appJs, /'\/api\/pc\/undo-done'/, 'Client ruft den Undo-Endpunkt nicht auf');
  assert.match(appJs, /toast\(t\('pcDoneToast'\), \{ actionLabel: t\('undoAction'\), onAction: \(\) => undoPcDone\(\[item\.normalizedUrl\]\) \}\)/, 'pcDone() bietet kein Rueckgaengig an');
  assert.match(appJs, /toast\(t\('bulkDoneToast', \{ n: items\.length \}\), \{ actionLabel: t\('undoAction'\), onAction: \(\) => undoPcDone\(urls\) \}\)/, 'bulkPcDone() bietet kein Rueckgaengig an');

  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  const count = (i18n.match(/pcDoneToast:/g) || []).length;
  assert.equal(count, 2, `pcDoneToast muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
});

// Runde 3, Befund #5: keine Abbruchmoeglichkeit fuer lange Operationen.
// cdp.mjs/streamOperation brauchen echte ADB-Hardware (im ganzen Repo dafuer
// keine node:test-Abdeckung, siehe server.test.mjs-Kommentar) - hier nur die
// Client-Seite als textueller Verkabelungstest, das eigentliche Abbrechen
// wurde live gegen eine isolierte Instanz geprueft (Cancel-Knopf, kein
// echtes Geraet noetig fuer diesen Teil).
test('runTransfer/bulkPcReturn sind ueber AbortController abbrechbar', () => {
  assert.match(appJs, /function isAbortError\(e\)/, 'isAbortError fehlt');
  assert.match(appJs, /async function runStep\(url, label, body, \{ signal, onCancel \} = \{\}\)/, 'runStep nimmt signal/onCancel nicht entgegen');
  assert.match(appJs, /const res = await fetch\(url, \{\s*\n\s*method: 'POST',\s*\n\s*signal,/, 'signal wird nicht an fetch() durchgereicht');

  const transferFn = appJs.match(/async function runTransfer\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(transferFn, 'runTransfer() nicht gefunden');
  assert.match(transferFn, /const controller = new AbortController\(\)/, 'runTransfer() erzeugt keinen AbortController');
  assert.match(transferFn, /if \(isAbortError\(e\)\)/, 'runTransfer() unterscheidet Abbruch nicht von echtem Fehler');

  const bulkReturnFn = appJs.match(/async function bulkPcReturn\(items\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(bulkReturnFn, 'bulkPcReturn() nicht gefunden');
  assert.match(bulkReturnFn, /const controller = new AbortController\(\)/, 'bulkPcReturn() erzeugt keinen AbortController');
  assert.match(bulkReturnFn, /if \(isAbortError\(e\)\)/, 'bulkPcReturn() unterscheidet Abbruch nicht von echtem Fehler');

  const indexHtml = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),
    'utf8'
  );
  assert.match(indexHtml, /id="progressCancelBtn"/, 'Abbrechen-Knopf fehlt im Fortschrittspanel');

  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  for (const key of ['progressCancelBtn', 'operationCancelledToast']) {
    const count = (i18n.match(new RegExp(`${key}:`, 'g')) || []).length;
    assert.equal(count, 2, `${key} muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
  }
});

// Runde 2, Vorschlag 5: Wiedergaenger mit ihrer frueheren Entscheidung
// zeigen statt nur eines stummen Zeichens.
test('seenBefore-Badge zeigt Art und Zeitpunkt der frueheren Entscheidung', () => {
  assert.match(appJs, /function formatAgoHint\(iso\)/, 'formatAgoHint fehlt');
  assert.match(appJs, /item\.seenBeforeKind\s*\n?\s*\? t\('seenBeforeTitleDetailed'/, 'renderSeenBeforeBadge() nutzt seenBeforeKind nicht');

  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  for (const key of ['seenBeforeTitleDetailed', 'seenBeforeToday', 'seenBeforeYesterday', 'seenBeforeDaysAgo']) {
    const count = (i18n.match(new RegExp(`${key}:`, 'g')) || []).length;
    assert.equal(count, 2, `${key} muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
  }
});

// Vorschlag 7 der Produktanalyse: zuschaltbarer Fokus-Modus fuer "Am PC" -
// muss laut Plan-Bedingung standardmaessig aus sein, eine reine
// Anzeigefilterung (keine Datenaenderung), und die volle Liste immer in
// einem Klick erreichbar sein (der Schalter selbst).
test('Fokus-Modus (Vorschlag 7) ist standardmaessig aus und aendert keine Daten', () => {
  assert.match(appJs, /let pcFocusMode = localStorage\.getItem\('pcFocusMode'\) === '1'/, 'pcFocusMode muss per Default aus sein (nur "1" schaltet ein)');
  assert.match(appJs, /const PC_FOCUS_BATCH_SIZE = 10/, 'PC_FOCUS_BATCH_SIZE fehlt');

  const toggleHandler = appJs.match(/focusCb\.addEventListener\('change', \(\) => \{[\s\S]*?\n {2}\}\);/)?.[0];
  assert.ok(toggleHandler, 'Toggle-Handler fuer den Fokus-Schalter nicht gefunden');
  assert.doesNotMatch(toggleHandler, /fetch\(/, 'der Schalter selbst darf keine Server-Anfrage ausloesen - reine Anzeigefilterung');
  assert.match(toggleHandler, /localStorage\.setItem\('pcFocusMode'/, 'Schalterstellung wird nicht gemerkt');
  assert.match(toggleHandler, /render\(\);/, 'Schalter muss nur neu rendern, keine Datenmutation');

  // Die volle Liste bleibt immer in einem Klick erreichbar: die Slice-Logik
  // greift nur ueber PC_FOCUS_BATCH_SIZE hinaus, nie darunter oder wenn der
  // Schalter aus ist.
  assert.match(appJs, /const focusApplies = pcFocusMode && sortedFlat\.length > PC_FOCUS_BATCH_SIZE/, 'Fokus-Filter greift nicht korrekt bedingt');

  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  for (const key of ['pcFocusToggleLabel', 'pcFocusHint']) {
    const count = (i18n.match(new RegExp(`${key}:`, 'g')) || []).length;
    assert.equal(count, 2, `${key} muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
  }
});

// Runde-3-Befund #9: Fehler-Toasts verschwanden bisher nach 4,2s (8s mit
// Aktion) wie jeder andere Toast - zu kurz fuer eine oft laengere oder
// technische Fehlermeldung. Bleiben jetzt wie sticky-Toasts stehen, mit
// Schliessen-Knopf.
test('Fehler-Toasts bleiben stehen (kein Auto-Dismiss) und bekommen einen Schliessen-Knopf', () => {
  const toastFn = appJs.match(/function toast\(message, \{[\s\S]*?\n\}/)?.[0];
  assert.ok(toastFn, 'toast() nicht gefunden');
  assert.match(toastFn, /const stays = sticky \|\| error;/, 'error muss wie sticky behandelt werden');
  assert.match(toastFn, /if \(stays\) \{/, 'Schliessen-Knopf muss auch bei error angehaengt werden, nicht nur bei sticky');
  assert.match(toastFn, /if \(!stays\) setTimeout/, 'Auto-Dismiss darf bei error nicht mehr greifen');
});

// Runde 3, Bündel 2 (Befunde 12/13/14). Vor der Umsetzung wurde der
// umgebende Code auf "bewusst"/"siehe Plan"-Kommentare geprueft (Lehre aus
// Buendel 1) - hier fanden sich keine, alle drei sind echte Funde.
test('Bestandsweite Suche (Befund 12): Hinweis auf Treffer in anderen Ablagen ist verdrahtet', () => {
  assert.match(appJs, /function renderCrossTrayHint\(p\)/, 'renderCrossTrayHint fehlt');
  assert.match(appJs, /renderCrossTrayHint\(p\);/, 'render() ruft renderCrossTrayHint() nicht auf');
  assert.match(appJs, /link\.addEventListener\('click', \(\) => setView\(hit\.id\)\)/, 'Klick auf einen Treffer muss die Ablage wechseln');

  const indexHtml = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),
    'utf8'
  );
  assert.match(indexHtml, /id="crossTrayHint"/, 'Container fuer den Hinweis fehlt in index.html');

  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  const count = (i18n.match(/crossTrayHintPrefix:/g) || []).length;
  assert.equal(count, 2, `crossTrayHintPrefix muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
});

test('Domain-Filter-Reichweite (Befund 13): Hinweis auf anderswo ausgeblendete Quellen ist verdrahtet', () => {
  assert.match(appJs, /const hiddenElsewhereCount = \[\.\.\.hiddenDomains\]\.filter/, 'renderFilterSidebar() berechnet hiddenElsewhereCount nicht');

  const indexHtml = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),
    'utf8'
  );
  assert.match(indexHtml, /id="filterHiddenElsewhereNote"/, 'Hinweis-Container fehlt in index.html');

  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  const count = (i18n.match(/filterHiddenElsewhereNote:/g) || []).length;
  assert.equal(count, 2, `filterHiddenElsewhereNote muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
});

// Befund 14: Kopfzeilen-Zaehler in "Am PC"/Wiedervorlage/Verschwunden/
// Vorgemerkt zeigten bisher immer die Ablagen-Gesamtzahl, auch wenn ein
// Filter die sichtbare Liste auf wenige Zeilen reduzierte.
test('Kopfzeilen-Zaehler folgen der gefilterten Menge, nicht der Ablagen-Gesamtzahl (Befund 14)', () => {
  assert.doesNotMatch(appJs, /renderSectionHead\(pcSectionEl, t\('pcSectionTitle'\), items\.length/, 'Am PC nutzt noch die ungefilterte Menge');
  assert.doesNotMatch(appJs, /renderSectionHead\(snoozedSectionEl, t\('viewSnoozed'\), items\.length/, 'Wiedervorlage nutzt noch die ungefilterte Menge');
  assert.doesNotMatch(appJs, /renderSectionHead\(missingSectionEl, t\('viewMissing'\), items\.length/, 'Verschwunden nutzt noch die ungefilterte Menge');
  assert.doesNotMatch(appJs, /renderSectionHead\(pendingSectionEl, t\('viewPending'\), items\.length/, 'Vorgemerkt nutzt noch die ungefilterte Menge');

  assert.match(appJs, /renderSectionHead\(pcSectionEl, t\('pcSectionTitle'\), filtered\.length/, 'Am PC muss die gefilterte Menge zeigen');
  assert.match(appJs, /renderSectionHead\(snoozedSectionEl, t\('viewSnoozed'\), shown\.length/, 'Wiedervorlage muss die gefilterte Menge zeigen');
  assert.match(appJs, /renderSectionHead\(missingSectionEl, t\('viewMissing'\), shown\.length/, 'Verschwunden muss die gefilterte Menge zeigen');
  assert.match(appJs, /renderSectionHead\(pendingSectionEl, t\('viewPending'\), filtered\.length/, 'Vorgemerkt muss die gefilterte Menge zeigen');
});

// Runde 3, Buendel 3 (Befunde 6/7). Vor der Umsetzung auf "bewusst"/"siehe
// Plan"-Kommentare geprueft: die stateChangedAt-statt-firstSeen-Sortierung
// aus Befund 7 ist explizit dokumentierte Absicht und bleibt unangetastet -
// nur das fehlende newCount wurde behoben.
test('Scan-Toast nennt den Zuwachs (Befund 7)', () => {
  assert.match(appJs, /data\.newCount\s*\n?\s*\? t\('scanToastWithNew'/, 'scan() nutzt newCount nicht fuer den Toast');

  const i18n = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'i18n.mjs'),
    'utf8'
  );
  const count = (i18n.match(/scanToastWithNew:/g) || []).length;
  assert.equal(count, 2, `scanToastWithNew muss in beiden Sprachen (DE/EN) vorhanden sein, gefunden: ${count}`);
});

test('adb/cdp-Aufrufe haben ein Timeout (Befund 6)', () => {
  const adbJs = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'adb.mjs'),
    'utf8'
  );
  assert.match(adbJs, /const HIDDEN = \{ windowsHide: true, timeout: config\.adbTimeoutMs \};/, 'execFile-Aufrufe haben kein Timeout');

  const cdpJs = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'cdp.mjs'),
    'utf8'
  );
  const timeoutFetches = (cdpJs.match(/signal: AbortSignal\.timeout\(config\.cdpTimeoutMs\)/g) || []).length;
  assert.equal(timeoutFetches, 2, 'fetchTabs UND browserWsUrl muessen ein Timeout haben, gefunden: ' + timeoutFetches);

  const configJs = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'config.mjs'),
    'utf8'
  );
  assert.match(configJs, /adbTimeoutMs: 15_000/, 'adbTimeoutMs fehlt in config.mjs');
});

// Nutzer-Feedback nach der v0.3.20-Auslieferung: die "verdaechtiger Scan"-
// Warnung erschien praktisch bei jedem ersten Scan nach einem USB-
// Neuanstecken, obwohl sich der Zustand Sekunden spaeter von selbst loeste
// (Chrome auf dem Handy braucht nach dem Reconnect einen Moment). scanHandler
// braucht eine echte ADB-Session fuer einen vollen Rundlauf-Test (wie die
// uebrigen Scan-Aenderungen) - hier nur der textuelle Beleg, dass der Retry
// tatsaechlich verdrahtet ist.
test('Scan retried einmal still, bevor die "verdaechtig"-Warnung angezeigt wird', () => {
  const serverJs = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'),
    'utf8'
  );
  const scanHandlerBody = serverJs.match(/async function scanHandler\([\s\S]*?\n\}/)?.[0];
  assert.ok(scanHandlerBody, 'scanHandler nicht gefunden');
  assert.match(scanHandlerBody, /if \(result\.suspicious\) \{/, 'kein Retry-Zweig fuer einen verdaechtigen Scan');
  assert.match(scanHandlerBody, /await cdp\.sleep\(1500\);/, 'Retry wartet nicht vor dem zweiten Versuch');
  assert.match(scanHandlerBody, /const retryTabs = await cdp\.listTabs\(session\);/, 'Retry liest keine frischen Tabs');
  assert.match(scanHandlerBody, /result = await items\.mergeScan\(deviceKey, retryTabs\);/, 'Retry-Ergebnis wird nicht uebernommen');
});

test('cdp.openMany/closeMany und streamOperation pruefen signal/Verbindungsstatus', () => {
  const cdpJs = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'cdp.mjs'),
    'utf8'
  );
  const openManyMatches = (cdpJs.match(/if \(signal\?\.aborted\) break;/g) || []).length;
  assert.equal(openManyMatches, 2, 'openMany UND closeMany muessen signal.aborted vor jedem Tab pruefen');

  const serverJs = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'),
    'utf8'
  );
  assert.match(serverJs, /if \(!res\.writableEnded\) controller\.abort\(\);/, 'streamOperation unterscheidet Verbindungsabbruch nicht von regulaerem Abschluss');
  const streamOperationCalls = (serverJs.match(/return streamOperation\(req, res,/g) || []).length;
  assert.equal(streamOperationCalls, 3, 'alle drei Handler (restore/close-decided/pc-bulk-return) muessen req durchreichen, gefunden: ' + streamOperationCalls);
});
