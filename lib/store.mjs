import { writeFile, mkdir } from 'node:fs/promises';
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

export async function saveBackup(label, data) {
  await ensureDirs();
  const file = path.join(dataPath('backups'), `${label}.json`);
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  return file;
}
