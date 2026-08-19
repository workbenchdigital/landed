import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir, utimes } from 'node:fs/promises';
import { normalizeUrl, safeDomain, saveBackup } from './store.mjs';
import { withTempData } from './test-helpers.mjs';
import { dataPath } from './config.mjs';

// Tracking-Parameter und Fragment werden entfernt
assert.equal(
  normalizeUrl('https://example.com/a?utm_source=x&id=1#frag'),
  'https://example.com/a?id=1'
);

// Gleiche URL nach Normalisierung ergibt denselben Schluessel -
// buildInventory/mergeScan verlassen sich darauf, um Duplikate zusammenzufassen.
assert.equal(
  normalizeUrl('https://example.com/a?utm_source=x'),
  normalizeUrl('https://example.com/a')
);

// kaputte URL bricht nicht ab, liefert die Roh-URL zurueck statt zu werfen
assert.equal(normalizeUrl('not-a-url'), 'not-a-url');

assert.equal(safeDomain('https://example.com/a'), 'example.com');
assert.equal(safeDomain('not-a-url'), 'unbekannt');

// Runde-3-Befund #24: Backups wuchsen unbegrenzt. saveBackup() raeumt jetzt
// auf MAX_BACKUPS (20) ab, nach echtem mtime sortiert (nicht nach
// Dateiname - pre_close_/pre_restore_ sortieren als Strings nicht
// chronologisch ineinander). Mtimes hier bewusst per utimes() explizit
// gesetzt statt sich auf reale Schreibabstaende zu verlassen - macht den
// Test deterministisch statt von der Uhrenaufloesung des Dateisystems
// abhaengig.
await withTempData(async () => {
  for (let i = 0; i < 24; i++) {
    await saveBackup(`pre_close_${i}`, { i });
    // Aufsteigend in der Vergangenheit, aeltestes zuerst - weit genug
    // auseinander, dass keine Aufloesung der Zeitstempel Gleichstaende erzeugt.
    const mtime = new Date(Date.now() - (24 - i) * 60_000);
    await utimes(path.join(dataPath('backups'), `pre_close_${i}.json`), mtime, mtime);
  }
  // 25. Backup, mit "jetzt" als mtime - loest genau einen Prune-Durchlauf aus.
  await saveBackup('pre_close_newest', { i: 24 });

  const files = await readdir(dataPath('backups'));
  assert.equal(files.length, 20, 'mehr als MAX_BACKUPS duerfen nicht liegen bleiben');
  assert.ok(files.includes('pre_close_newest.json'), 'das juengste Backup muss ueberleben');
  assert.ok(files.includes('pre_close_23.json'), 'das zweitjuengste Backup muss ueberleben');
  assert.ok(!files.includes('pre_close_0.json'), 'das aelteste Backup haette geloescht werden muessen');
});

console.log('store.mjs: alle Checks OK');
