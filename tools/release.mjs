#!/usr/bin/env node
// Schnuert aus dem fertigen build/-Ordner (node tools/build.mjs) ein
// Release-ZIP inklusive SmartScreen-Hinweis und Pruefsumme - beides Signale,
// die eine unsignierte Indie-Binary anbieten kann, statt den Nutzer zum
// Abschalten von Schutzmechanismen zu raten (siehe README "Bekannte Grenzen").
//
// Aufruf: node tools/release.mjs   (nach node tools/build.mjs)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync, readFileSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(ROOT, 'build');
const DIST_DIR = path.join(ROOT, 'dist');
const PKG_VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const ZIP_NAME = `Landed-v${PKG_VERSION}-win.zip`;
const ZIP_FILE = path.join(DIST_DIR, ZIP_NAME);

if (!existsSync(path.join(BUILD_DIR, 'Landed.exe'))) {
  throw new Error(`${BUILD_DIR}\\Landed.exe fehlt. Erst bauen: node tools/build.mjs`);
}

const FIRST_RUN_TEXT = `Landed für Android/Chrome — Erster Start
==========================================

Windows SmartScreen wird beim ersten Start von Landed.exe vermutlich warnen
("Windows hat den Start dieser App verhindert" / "unbekannter Herausgeber").
Das ist normal für kleine, unsignierte Programme wie dieses — Landed schickt
keine Daten irgendwohin, läuft ausschließlich lokal auf 127.0.0.1 (siehe
README, Abschnitt "Sicherheit").

So verhinderst du die Warnung komplett (empfohlen, VOR dem Entpacken):
  1. Rechtsklick auf die heruntergeladene ZIP-Datei -> Eigenschaften
  2. Unten bei "Sicherheit": Haken bei "Zulassen" setzen -> OK
  3. Erst jetzt entpacken

Grund: Windows markiert heruntergeladene Dateien mit einer "Mark of the Web".
Beim Entpacken einer nicht entsperrten ZIP überträgt der Explorer diese
Markierung auf jede einzelne entpackte Datei. Entsperrst du stattdessen die
ZIP selbst vor dem Entpacken, sind alle entpackten Dateien sauber.

Warnung trotzdem erschienen? Im Dialog auf "Weitere Informationen" klicken,
dann "Trotzdem ausführen". Kein Zertifikat vorhanden (siehe README) - die
Prüfsumme in SHA256SUMS.txt ist das verfügbare Vertrauenssignal:

  certutil -hashfile Landed-v${PKG_VERSION}-win.zip SHA256

Der ausgegebene Hash muss exakt mit dem Eintrag in SHA256SUMS.txt
übereinstimmen.
`;

writeFileSync(path.join(BUILD_DIR, 'FIRST-RUN.txt'), FIRST_RUN_TEXT, 'utf8');

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });

// Compress-Archive ist in jedem Windows eingebaut - kein zusaetzliches
// Tool noetig (gleiche "native platform feature"-Ueberlegung wie beim Icon).
execFileSync('powershell', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path '${BUILD_DIR}\\*' -DestinationPath '${ZIP_FILE}' -Force`,
]);

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const hash = await sha256(ZIP_FILE);
writeFileSync(path.join(DIST_DIR, 'SHA256SUMS.txt'), `${hash} *${ZIP_NAME}\n`, 'utf8');

const sizeMb = (statSync(ZIP_FILE).size / (1024 * 1024)).toFixed(1);
console.log(`Fertig: ${ZIP_FILE} (${sizeMb} MB)`);
console.log(`SHA256: ${hash}`);
