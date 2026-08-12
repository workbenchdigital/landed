#!/usr/bin/env node
// Einmalige Migration vom alten Zwei-Datei-Modell (inventory.json + flaches
// decisions.json + archive.md) auf den Item-Store (landed.db, Tabellen
// items/meta/archive). Dry-run per Default - Reversibilitaet
// ist gratis, weil dieses Skript ausschliesslich NEUE Pfade schreibt und die
// Altdateien nur liest, nie anfasst. Rollback = Code zurueck, neue Dateien loeschen.
//
// Aufruf: node tools/migrate-v2.mjs           (nur Bericht, schreibt nichts)
//         node tools/migrate-v2.mjs --write   (schreibt nach landed.db)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dataPath } from '../lib/config.mjs';
import { normalizeUrl, safeDomain } from '../lib/store.mjs';
import { updateItems, appendArchiveRecords, readArchiveIndex, getMeta, DEFAULT_DEVICE } from '../lib/items.mjs';
import * as adb from '../lib/adb.mjs';

const WRITE = process.argv.includes('--write');

async function readJsonOrFallback(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

// Trennung am LETZTEN "](" statt per Regex ueber die ganze Zeile: Titel
// koennen "]" enthalten (z.B. "Titel [Teil 2]"), URLs koennen ")" enthalten
// (z.B. Klammern in einem UTM-Parameter) - beides real in archive.md
// beobachtet. Das letzte "](" ist der einzige Trennpunkt, der beides uebersteht.
export function parseArchiveMd(content) {
  const records = [];
  let currentTimestamp = null;
  let currentDomain = null;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    let m;
    if ((m = line.match(/^## (.+?) — \d+ Tabs?$/))) {
      currentTimestamp = m[1];
      continue;
    }
    if ((m = line.match(/^### (.+) \(\d+\)$/))) {
      currentDomain = m[1];
      continue;
    }
    if (line.startsWith('- [') && line.endsWith(')')) {
      const idx = line.lastIndexOf('](');
      if (idx === -1) continue; // verstuemmelte Zeile - ueberspringen statt abzubrechen
      records.push({
        title: line.slice(3, idx),
        url: line.slice(idx + 2, -1),
        domain: currentDomain,
        timestamp: currentTimestamp,
      });
    }
  }
  return records;
}

// "2026-08-10 05:08" (Format aus dem alten store.mjs formatArchiveBlock) ->
// ISO-String. Sekunden/Millisekunden gehen dabei verloren (nie gespeichert),
// fuer ein Archivdatum nicht relevant.
function archiveTimestampToIso(ts) {
  if (!ts) return new Date().toISOString();
  const iso = ts.replace(' ', 'T') + ':00.000Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// Baseline fuer die "verdaechtiger Scan"-Erkennung (mergeScan). inventory.length
// ist dafuer die FALSCHE Zahl: inventory.json ist bereits auf eindeutige URLs
// dedupliziert, waehrend sourceCount die rohe CDP-Tab-Zahl VOR der
// Deduplizierung war (in echten Daten beobachtet: 161 dedupliziert vs. 248
// roh). Eine zu niedrige Baseline macht die Verdaechtig-Erkennung beim ersten
// Scan nach der Migration zu lasch und laesst echte CDP-Aussetzer faelschlich
// als normale Abwesenheit durch. scan-meta.json hatte die rohe Zahl schon
// immer direkt gespeichert - nur wenn die fehlt, aus duplicateCount schaetzen.
export function computeScanBaseline(inventory, legacyScanMeta) {
  if (Number.isFinite(legacyScanMeta?.sourceCount)) return legacyScanMeta.sourceCount;
  return inventory.reduce((sum, item) => sum + (item.duplicateCount ?? 1), 0);
}

// Nur fuer den Bericht/meta.serial - der Server ruft alle items.mjs-Funktionen
// bis Stufe 5 (Geraete-Umschalter) ausnahmslos ohne deviceKey auf, landet also
// immer bei DEFAULT_DEVICE. Wuerde die Migration nach der echten Seriennummer
// schreiben, laege der migrierte Bestand neben dem Store, den die App
// tatsaechlich liest - kein Datenverlust, aber wirkungslos.
async function detectRealSerial() {
  try {
    const device = await adb.selectDevice();
    return device.serial;
  } catch {
    return null; // kein Geraet verbunden/mehrdeutig - fuer den Bericht nicht kritisch
  }
}

async function main() {
  const deviceKey = DEFAULT_DEVICE;
  const realSerial = await detectRealSerial();

  // Ueber getMeta() statt direkt aus meta.json: der Item-Store liegt seit der
  // SQLite-Umstellung in landed.db, eine noch herumliegende meta.json waere
  // nur noch ein Ueberbleibsel und der Doppellauf-Schutz damit wirkungslos.
  const existingMeta = await getMeta(deviceKey);
  if (existingMeta?.migratedAt) {
    console.log(`Bereits am ${existingMeta.migratedAt} migriert - kein erneuter Lauf.`);
    console.log('Ein zweiter --write-Lauf wuerde seither vorgenommene Aenderungen (Entscheidungen, Notizen) auf den Migrationsstand zuruecksetzen.');
    if (WRITE) {
      console.log('Abgebrochen. Bei Bedarf migratedAt in der meta-Zeile fuer "' + deviceKey + '" in landed.db loeschen, um einen erneuten Lauf zu erzwingen.');
      return;
    }
  }

  const [inventory, decisions, archiveMdRaw, legacyScanMeta] = await Promise.all([
    readJsonOrFallback(dataPath('inventory.json'), []),
    readJsonOrFallback(dataPath('decisions.json'), {}),
    readFile(dataPath('archive.md'), 'utf8').catch((e) => {
      if (e.code === 'ENOENT') return '';
      throw e;
    }),
    readJsonOrFallback(dataPath('scan-meta.json'), null),
  ]);

  const archiveRecordsFromMdRaw = parseArchiveMd(archiveMdRaw).map((r) => {
    const normalizedUrl = normalizeUrl(r.url);
    const at = archiveTimestampToIso(r.timestamp);
    return {
      normalizedUrl,
      url: r.url,
      title: r.title,
      domain: r.domain || safeDomain(r.url),
      kind: 'archived',
      device: null,
      at,
      firstSeen: at,
    };
  });

  // Innerhalb von archive.md koennen zwei Zeilen auf denselben normalizedUrl
  // fallen (z.B. dieselbe URL zweimal mit unterschiedlichem fbclid-Parameter -
  // normalizeUrl() entfernt den) - ohne dieses Eindampfen bekaeme archive.jsonl
  // echte Duplikate innerhalb eines einzigen Laufs (readArchiveIndex prueft nur
  // gegen VORHANDENE Eintraege, nicht innerhalb des aktuellen Batches).
  const archiveRecordsFromMd = [...new Map(archiveRecordsFromMdRaw.map((r) => [r.normalizedUrl, r])).values()];
  const duplicateWithinBatch = archiveRecordsFromMdRaw.length - archiveRecordsFromMd.length;

  // Bereits vorhandene archive.jsonl-Eintraege (falls das Skript zuvor schon
  // einmal mit --write lief) - verhindert doppelte Datensaetze bei erneutem Lauf.
  const existingArchiveIndex = await readArchiveIndex();
  const newArchiveRecords = archiveRecordsFromMd.filter((r) => !existingArchiveIndex.has(r.normalizedUrl));
  const skippedDuplicateArchiveRecords = archiveRecordsFromMd.length - newArchiveRecords.length;

  // Fuer Schritt 4: "bereits ausgefuehrte Entscheidungen" erkennen. archive.md
  // kannte nur 'archive' (kind 'archived') - eine verwaiste 'drop'-Entscheidung
  // laesst sich NICHT gegen ein Archiv pruefen (drop hinterliess nie eine Spur),
  // bleibt also immer eine offene Vormerkung mit missingSince.
  const archivedNormalizedUrls = new Set(archiveRecordsFromMd.map((r) => r.normalizedUrl));

  const now = new Date().toISOString();
  const migratedItems = {};
  const inventoryByNormalizedUrl = new Map(inventory.map((item) => [item.normalizedUrl, item]));

  const alreadyExecuted = [];
  let orphanedImportedCount = 0;

  for (const item of inventory) {
    const state = decisions[item.normalizedUrl] || 'open';
    migratedItems[item.normalizedUrl] = {
      url: item.url,
      title: item.title,
      domain: item.domain,
      state,
      firstSeen: now,
      lastSeen: now,
      stateChangedAt: now,
      snoozeUntil: null,
      missingSince: null,
      missedScans: 0,
      closedAt: null,
      note: null,
      // Stammen aus dem letzten Scan vor der Migration - moeglicherweise
      // veraltete CDP-Target-IDs (Chrome laeuft ggf. nicht mehr mit derselben
      // Session). Ein fehlgeschlagenes Schliessen heilt sich selbst ueber
      // den naechsten Scan, siehe closeDecidedHandler/applyCloseResults.
      duplicateCount: item.duplicateCount ?? 1,
      duplicateIds: item.duplicateIds ?? [item.id],
      seenBefore: archivedNormalizedUrls.has(item.normalizedUrl),
    };
  }

  for (const [normalizedUrl, state] of Object.entries(decisions)) {
    if (inventoryByNormalizedUrl.has(normalizedUrl)) continue; // oben schon behandelt

    // Nur 'archive' kann hier je matchen - archive.md kannte nur diesen einen
    // Fall (drop hinterliess nie einen Eintrag, siehe Kommentar oben).
    if (state === 'archive' && archivedNormalizedUrls.has(normalizedUrl)) {
      // Bereits real ausgefuehrt (Tab am Telefon laengst geschlossen, Eintrag
      // schon in archive.md) - keine offene Vormerkung importieren. Namentlich
      // protokolliert statt nur gezaehlt - das ist der einzige Pfad, auf dem
      // eine Entscheidung dieses Skript verlassen koennte, ohne im neuen
      // Bestand aufzutauchen, also muss er nachpruefbar sein.
      alreadyExecuted.push({ normalizedUrl, state });
      continue;
    }

    const archiveRecord = archiveRecordsFromMd.find((r) => r.normalizedUrl === normalizedUrl);
    migratedItems[normalizedUrl] = {
      url: archiveRecord?.url || normalizedUrl,
      title: archiveRecord?.title || normalizedUrl,
      domain: archiveRecord?.domain || safeDomain(normalizedUrl),
      state,
      firstSeen: now,
      lastSeen: now,
      stateChangedAt: now,
      snoozeUntil: null,
      missingSince: now,
      missedScans: 1,
      closedAt: null,
      note: null,
      duplicateCount: 0,
      duplicateIds: [],
      seenBefore: archivedNormalizedUrls.has(normalizedUrl),
    };
    orphanedImportedCount++;
  }

  const report = {
    deviceKey,
    realSerialDetected: realSerial,
    inventoryItemsImported: inventory.length,
    orphanedDecisionsImported: orphanedImportedCount,
    alreadyExecutedSkipped: alreadyExecuted.length,
    totalItemsToWrite: Object.keys(migratedItems).length,
    archiveRecordsParsed: archiveRecordsFromMdRaw.length,
    archiveRecordsDuplicateWithinBatch: duplicateWithinBatch,
    archiveRecordsToWrite: newArchiveRecords.length,
    archiveRecordsSkippedAsDuplicate: skippedDuplicateArchiveRecords,
  };

  console.log(WRITE ? '--- Migration (schreibt) ---' : '--- Migration (Dry-Run, schreibt nichts) ---');
  console.log(JSON.stringify(report, null, 2));
  if (alreadyExecuted.length) {
    console.log('\nAls "bereits ausgefuehrt" uebersprungen (nicht importiert):');
    for (const e of alreadyExecuted) console.log(`  - [${e.state}] ${e.normalizedUrl}`);
  }

  if (!WRITE) {
    console.log('\nKein --write angegeben - nichts geschrieben. Bei Bedarf mit --write erneut ausfuehren.');
    return;
  }

  await appendArchiveRecords(newArchiveRecords);
  await updateItems(deviceKey, async (items, meta) => {
    Object.assign(items, migratedItems);
    meta.schema = 2;
    meta.migratedAt = now;
    meta.serial = realSerial;
    meta.lastScanSourceCount = computeScanBaseline(inventory, legacyScanMeta);
    return null;
  });
  console.log(`\nGeschrieben: landed.db (Items/Meta fuer "${deviceKey}", Archiv-Eintraege).`);
  console.log('Altdateien (inventory.json, decisions.json, archive.md) unveraendert - bei Bedarf manuell aufraeumen.');
}

// Nur beim direkten Aufruf ausfuehren, nicht beim Import (z.B. aus einem Test,
// der parseArchiveMd isoliert pruefen will) - selbes Muster wie server.mjs.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Migration fehlgeschlagen:', err);
    process.exit(1);
  });
}
