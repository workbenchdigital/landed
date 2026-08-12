import assert from 'node:assert/strict';
import { normalizeUrl, safeDomain } from './store.mjs';

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

console.log('store.mjs: alle Checks OK');
