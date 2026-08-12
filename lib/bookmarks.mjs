import { readFile } from 'node:fs/promises';
import path from 'node:path';

// WebKit-Zeitstempel: Mikrosekunden seit 1601-01-01 UTC (nicht Unix-Epoch).
const WEBKIT_EPOCH_OFFSET_MS = 11644473600000;
export function webkitToDate(ts) {
  const n = Number(ts);
  if (!n) return null;
  return new Date(n / 1000 - WEBKIT_EPOCH_OFFSET_MS);
}

function chromeUserDataDir() {
  const base = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  return path.join(base, 'Google', 'Chrome', 'User Data');
}

async function findProfiles() {
  const userDataDir = chromeUserDataDir();
  let profileDirs;
  try {
    const localState = JSON.parse(await readFile(path.join(userDataDir, 'Local State'), 'utf8'));
    const infoCache = localState.profile?.info_cache || {};
    profileDirs = Object.entries(infoCache).map(([dir, info]) => ({ dir, label: info.name || dir }));
  } catch {
    // Local State nicht lesbar - Standardprofile als Fallback versuchen.
    profileDirs = [{ dir: 'Default', label: 'Default' }, { dir: 'Profile 1', label: 'Profile 1' }];
  }

  const profiles = [];
  for (const { dir, label } of profileDirs) {
    const file = path.join(userDataDir, dir, 'Bookmarks');
    try {
      await readFile(file, 'utf8');
      profiles.push({ dir, label, file });
    } catch {
      // Profil ohne Bookmarks-Datei - ueberspringen, kein Fehlerfall.
    }
  }
  return profiles;
}

// Zaehlt URLs im Teilbaum und sammelt Ordner in einem einzigen Durchlauf
// (Rueckgabewert statt erneuter Neu-Traversierung pro Ordner) - bei tiefen
// Baeumen sonst O(n^2), da jede URL einmal pro Vorfahren-Ordner gezaehlt wuerde.
function collectFolders(node, profile, out, depth = 0) {
  if (!node) return 0;
  if (node.type === 'url') return node.url ? 1 : 0;
  if (node.type !== 'folder') return 0;

  let urlCount = 0;
  for (const child of node.children || []) {
    urlCount += collectFolders(child, profile, out, depth + 1);
  }

  // Tiefe 0 = die drei Wurzelcontainer selbst (Lesezeichenleiste, Weitere
  // Lesezeichen, Mobile Lesezeichen) - die will niemand als "meinen
  // Export-Ordner" auswaehlen, und ihr date_added ist zudem irrefuehrend
  // (Profil-Erstellungsdatum, nicht Inhalt). Nur echte Unterordner listen.
  if (depth > 0 && urlCount > 0) {
    out.push({
      id: `${profile.dir}::${node.id}`,
      profileLabel: profile.label,
      name: node.name || '(ohne Namen)',
      childCount: urlCount,
      dateAdded: webkitToDate(node.date_added)?.toISOString() ?? null,
    });
  }
  return urlCount;
}

function findNodeById(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

function collectUrls(node, out) {
  if (!node) return;
  if (node.type === 'url' && node.url) {
    out.push({ title: node.name || '(kein Titel)', url: node.url });
  }
  for (const child of node.children || []) collectUrls(child, out);
}

// Listet alle Lesezeichen-Ordner mit mindestens einem Link, ueber alle
// Chrome-Profile hinweg, neuester zuerst. Android-Bulk-Exports landen unter
// roots.synced ("Mobile Lesezeichen"), aber wir durchsuchen alle Roots, falls
// der Nutzer den Ordner manuell verschoben hat.
export async function listBookmarkFolders() {
  const profiles = await findProfiles();
  if (!profiles.length) {
    throw new Error('Keine Chrome-Profile mit Bookmarks-Datei gefunden.');
  }
  const folders = [];
  for (const profile of profiles) {
    const data = JSON.parse(await readFile(profile.file, 'utf8'));
    for (const root of Object.values(data.roots || {})) {
      collectFolders(root, profile, folders);
    }
  }
  folders.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
  return folders;
}

// Extrahiert alle URLs (rekursiv, inkl. Unterordner) aus einem Ordner anhand
// der zusammengesetzten ID aus listBookmarkFolders().
export async function getFolderUrls(compoundId) {
  const [profileDir, nodeId] = compoundId.split('::');
  const profiles = await findProfiles();
  const profile = profiles.find((p) => p.dir === profileDir);
  if (!profile) throw new Error(`Profil "${profileDir}" nicht gefunden.`);

  const data = JSON.parse(await readFile(profile.file, 'utf8'));
  let node = null;
  for (const root of Object.values(data.roots || {})) {
    node = findNodeById(root, nodeId);
    if (node) break;
  }
  if (!node) throw new Error('Lesezeichen-Ordner nicht mehr gefunden - evtl. inzwischen umbenannt oder gelöscht.');

  const urls = [];
  collectUrls(node, urls);
  return urls;
}
