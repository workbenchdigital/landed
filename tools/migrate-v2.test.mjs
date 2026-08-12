import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArchiveMd, computeScanBaseline } from './migrate-v2.mjs';

test('parseArchiveMd trennt Titel/URL am letzten "](" statt per naiver Regex', () => {
  const content = `## 2026-08-07 09:11 — 2 Tabs

### a.com (2)

- [Titel mit ] Klammer](https://a.com/1)
- [Deals](https://a.com/2?utm_campaign=Sale-(11-June)-More&x=1)
`;
  const records = parseArchiveMd(content);
  assert.equal(records.length, 2);
  assert.equal(records[0].title, 'Titel mit ] Klammer');
  assert.equal(records[0].url, 'https://a.com/1');
  assert.equal(records[1].url, 'https://a.com/2?utm_campaign=Sale-(11-June)-More&x=1');
});

test('parseArchiveMd traegt Domain und Timestamp aus den Kopfzeilen durch', () => {
  const content = `## 2026-08-10 05:08 — 1 Tab

### www.example.com (1)

- [Ein Titel](https://www.example.com/x)
`;
  const [record] = parseArchiveMd(content);
  assert.equal(record.domain, 'www.example.com');
  assert.equal(record.timestamp, '2026-08-10 05:08');
});

test('parseArchiveMd ueberspringt verstuemmelte Zeilen statt abzubrechen', () => {
  const content = `## 2026-08-10 05:08 — 1 Tab

### x.com (1)

- [kaputte Zeile ohne Klammer-Ende
- [gueltige Zeile](https://x.com/ok)
`;
  const records = parseArchiveMd(content);
  assert.equal(records.length, 1);
  assert.equal(records[0].url, 'https://x.com/ok');
});

test('parseArchiveMd bei leerem Inhalt liefert leeres Array', () => {
  assert.deepEqual(parseArchiveMd(''), []);
});

// Regression: inventory.length wurde faelschlich als Baseline verwendet -
// inventory.json ist bereits auf eindeutige URLs dedupliziert, sourceCount
// war die rohe CDP-Tab-Zahl davor (in echten Daten: 161 vs. 248). Eine zu
// niedrige Baseline macht die "verdaechtiger Scan"-Erkennung beim ersten
// Scan nach der Migration zu lasch (codemouseai-Review auf PR #8).
test('computeScanBaseline nutzt scan-meta.json sourceCount statt inventory.length', () => {
  const inventory = [{ duplicateCount: 1 }, { duplicateCount: 1 }]; // 2 dedupliziert
  const legacyScanMeta = { sourceCount: 248, timestamp: '2026-08-07T14:08:37.622Z' };
  assert.equal(computeScanBaseline(inventory, legacyScanMeta), 248);
});

test('computeScanBaseline faellt ohne scan-meta.json auf die Summe der duplicateCount zurueck', () => {
  const inventory = [{ duplicateCount: 3 }, { duplicateCount: 2 }, {}]; // drittes Item ohne Feld -> 1
  assert.equal(computeScanBaseline(inventory, null), 6);
});
