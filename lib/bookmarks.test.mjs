import assert from 'node:assert/strict';
import { webkitToDate } from './bookmarks.mjs';

// Realer Wert aus einem echten Bookmark-Node (Chrome Default-Profil dieses PCs),
// entspricht 2026-06-11 - deckt die Epoch-Umrechnung ab.
const d = webkitToDate('13425660375291727');
assert.equal(d.getUTCFullYear(), 2026);
assert.equal(d.getUTCMonth(), 5); // Juni = Index 5

assert.equal(webkitToDate('0'), null);
assert.equal(webkitToDate(undefined), null);

console.log('bookmarks.mjs: alle Checks OK');
