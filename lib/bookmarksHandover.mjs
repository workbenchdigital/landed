import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

// LANDED Bookmarks ist eine eigene Installation mit eigenem
// %LOCALAPPDATA%-Verzeichnis, unabhaengig von diesem Programm (config.mjs
// dataDir hier zeigt auf .../Landed, nicht .../LandedBookmarks) - deshalb
// hier bewusst ein eigener, direkter Pfadaufbau statt eine Abhaengigkeit auf
// das andere Repo.
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
const BOOKMARKS_TOKEN_FILE = path.join(LOCAL_APP_DATA, 'LandedBookmarks', 'inbox.token');
const BOOKMARKS_INBOX_URL = 'http://127.0.0.1:7891/api/inbox';

// tokenFile/fetchImpl sind injizierbar - macht beide Funktionen ohne eine
// echte LANDED-Bookmarks-Installation testbar (gleiches Prinzip wie
// lib/adb.mjs/lib/cdp.mjs an anderer Stelle in diesem Repo).

// Die Existenz der Token-Datei ist zugleich "ist LANDED Bookmarks installiert
// und wurde mindestens einmal gestartet" (die Datei entsteht beim ersten
// Serverstart dort, siehe LANDED-Bookmarks lib/inbox.mjs ensureInboxToken()).
export async function bookmarksInstalled({ tokenFile = BOOKMARKS_TOKEN_FILE } = {}) {
  try {
    await access(tokenFile);
    return true;
  } catch {
    return false;
  }
}

// Fail-soft: wirft nie. Der Aufrufer (server.mjs closeDecidedHandler) hat das
// Item bereits ins eigene Archiv geschrieben, BEVOR dies aufgerufen wird -
// ein Fehlschlag hier bedeutet "bleibt im Archiv, wurde nicht zusaetzlich
// aufs Board uebertragen", niemals Datenverlust. items = [{url, title}].
export async function forwardToBookmarks(
  items,
  { tokenFile = BOOKMARKS_TOKEN_FILE, url = BOOKMARKS_INBOX_URL, fetchImpl = fetch } = {}
) {
  if (!items.length) return { ok: true, count: 0 };
  let token;
  try {
    token = (await readFile(tokenFile, 'utf8')).trim();
  } catch {
    return { ok: false, count: 0 }; // nicht installiert oder noch nie gestartet
  }
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Inbox-Token': token },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, count: 0 };
    const data = await res.json();
    return { ok: true, count: data.count ?? items.length };
  } catch {
    return { ok: false, count: 0 }; // Bookmarks nicht erreichbar (nicht gestartet)
  }
}
