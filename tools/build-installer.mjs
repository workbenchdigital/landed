#!/usr/bin/env node
// Baut aus dem bestehenden build/-Ordner (node tools/build.mjs) einen
// richtigen Windows-Installer via Inno Setup (installer/landed.iss) -
// Start-Menue-Eintrag, sauberes Deinstallieren ueber die Windows-
// Einstellungen, stabile AppUserModelID fuer Taskleisten-/Start-Pins.
// Inno Setup selbst ist ein separat zu installierendes Werkzeug (nicht
// npm-paketierbar) - nur zum Bauen noetig, nicht fuer Endnutzer.
//
// Aufruf: node tools/build-installer.mjs   (nach node tools/build.mjs)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(ROOT, 'build');
const DIST_DIR = path.join(ROOT, 'dist');
const ISS_FILE = path.join(ROOT, 'installer', 'landed.iss');
const PKG_VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

if (!existsSync(path.join(BUILD_DIR, 'Landed.exe'))) {
  throw new Error(`${BUILD_DIR}\\Landed.exe fehlt. Erst bauen: node tools/build.mjs`);
}

// Registry-Suche wie lib/launcher.mjs waere hier Overkill fuer ein reines
// Build-Tool (laeuft nie in der gepackten App) - eine kurze Liste bekannter
// Installationspfade plus PATH-Fallback reicht.
//
// codemouseai-Review auf PR #24: die PATH-Kandidaten (ohne Backslash) gaben
// vorher ungeprueft sofort true zurueck - 'ISCC.exe' wurde dadurch IMMER
// als erster nicht-absoluter Treffer gewaehlt, 'ISCC' war toter Code und
// nie erreichbar. Jetzt wird jeder PATH-Kandidat echt per `where` geprueft.
const CANDIDATES = [
  'C:\\Program Files\\Inno Setup 7\\ISCC.exe',
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  'ISCC.exe',
  'ISCC',
];
const iscc = CANDIDATES.find((c) => {
  if (c.includes('\\')) {
    try {
      statSync(c);
      return true;
    } catch {
      return false;
    }
  }
  try {
    execFileSync('where', [c], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});

if (!iscc) {
  throw new Error(
    'Inno Setup (ISCC.exe) nicht gefunden. Installieren: https://jrsoftware.org/isdl.php - danach erneut versuchen.'
  );
}

mkdirSync(DIST_DIR, { recursive: true });

execFileSync(iscc, [`/DMyAppVersion=${PKG_VERSION}`, ISS_FILE], { stdio: 'inherit' });

const outFile = path.join(DIST_DIR, `Landed-Setup-v${PKG_VERSION}.exe`);
const sizeMb = (statSync(outFile).size / (1024 * 1024)).toFixed(1);
console.log(`\nFertig: ${outFile} (${sizeMb} MB)`);
