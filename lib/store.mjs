import { writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { dataPath } from './config.mjs';

const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  'igshid',
  'twclid',
  'yclid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  'ref',
];

async function ensureDirs() {
  await mkdir(dataPath('backups'), { recursive: true });
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return url;
  }
}

export function safeDomain(url) {
  try {
    return new URL(url).hostname || 'unbekannt';
  } catch {
    return 'unbekannt';
  }
}

// Runde-3-Befund #24: Backups wuchsen unbegrenzt - zwei neue Dateien pro
// "Auf Handy uebertragen" (pre_close_/pre_restore_), nie geloescht. Nach
// echtem MTIME sortiert statt nach Dateiname: die beiden Praefixe
// (pre_close_/pre_restore_) sortieren als Strings nicht chronologisch
// ineinander, auch wenn der eingebettete Timestamp-Suffix es innerhalb
// eines Praefixes tut.
const MAX_BACKUPS = 20;

async function pruneOldBackups(dir) {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  if (entries.length <= MAX_BACKUPS) return;
  const withMtime = await Promise.all(
    entries.map(async (f) => ({ f, mtimeMs: (await stat(path.join(dir, f))).mtimeMs }))
  );
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  await Promise.all(withMtime.slice(MAX_BACKUPS).map((e) => rm(path.join(dir, e.f))));
}

export async function saveBackup(label, data) {
  await ensureDirs();
  const dir = dataPath('backups');
  const file = path.join(dir, `${label}.json`);
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  // Aufraeumen darf das eigentliche Backup nie verhindern - best effort.
  await pruneOldBackups(dir).catch(() => {});
  return file;
}
