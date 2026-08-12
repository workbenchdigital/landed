#!/usr/bin/env node
// Laedt die offiziellen Android-Platform-Tools von Google und legt die drei
// Dateien, die adb.exe unter Windows tatsaechlich braucht, in
// platform-tools-cache/ ab (gitignored - ~8 MB Binaerdateien gehoeren nicht
// ins Repo, aber ein erneuter Download bei jedem Build waere unnoetig
// langsam). Apache-2.0-lizenziert, NOTICE.txt wird mitgenommen (Pflicht bei
// Weitergabe). Idempotent: bei bereits vorhandenem Cache wird nichts erneut
// heruntergeladen.
//
// Aufruf: node tools/fetch-platform-tools.mjs
import { mkdirSync, existsSync, rmSync, createWriteStream, readdirSync, copyFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'platform-tools-cache');
const NEEDED_FILES = ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'NOTICE.txt'];
// Offizielle, stabile Google-URL (developer.android.com/tools/releases/platform-tools) -
// zeigt immer auf die aktuelle Version, aendert sich selbst nicht.
const DOWNLOAD_URL = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
// Rafter-Fund (error): TLS beweist nur "kommt von dl.google.com", nicht
// "ist unveraendert" - kein Schutz gegen einen kompromittierten Hosting-Pfad
// oder eine lokal vertrauenswuerdige MITM-Stelle (Firmen-Proxy mit eigener
// Root-CA). Ohne Pruefsumme wuerden abweichende Bytes unbemerkt als adb.exe/
// DLLs in die ausgelieferte .exe wandern. Da die URL absichtlich "latest"
// ist (kein stabiler Versionslink bei Google), kann der Hash nicht ewig
// gelten - bewusster Trade-off: bei einem legitimen Google-Update schlaegt
// dieser Build fehl, bis der Hash hier bewusst nachgezogen wird (neu
// herunterladen, pruefen, Wert unten ersetzen), statt still einen
// unverifizierten Stand zu uebernehmen.
const EXPECTED_SHA256 = '45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99';

if (NEEDED_FILES.every((f) => existsSync(path.join(CACHE_DIR, f)))) {
  console.log(`Schon vorhanden: ${CACHE_DIR}`);
  process.exit(0);
}

console.log(`Lade platform-tools von ${DOWNLOAD_URL} ...`);
const tempDir = path.join(ROOT, '.platform-tools-download-tmp');
rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });
const zipFile = path.join(tempDir, 'platform-tools.zip');

const res = await fetch(DOWNLOAD_URL);
if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`);
await pipeline(res.body, createWriteStream(zipFile));

const actualHash = createHash('sha256').update(readFileSync(zipFile)).digest('hex');
if (actualHash !== EXPECTED_SHA256) {
  throw new Error(
    `SHA256 der heruntergeladenen platform-tools.zip stimmt nicht mit dem gepinnten Wert ueberein ` +
      `(erwartet ${EXPECTED_SHA256}, erhalten ${actualHash}). Abgebrochen, statt einen unverifizierten ` +
      `Stand zu verwenden - entweder ein legitimes Google-Update (Hash hier im Skript bewusst ` +
      `aktualisieren, nach manueller Pruefung) oder ein kompromittierter Download.`
  );
}

// Windows' eigenes tar.exe (System32, seit Windows 10 1803, bsdtar-basiert)
// kann .zip direkt entpacken - kein zusaetzliches Tool noetig. Expliziter
// Pfad statt nur 'tar': in einer Git-Bash-Umgebung wuerde sonst MSYS' eigenes
// GNU-tar zuerst gefunden, das "D:\..."-Pfade als Remote-Host-Syntax
// missversteht (der Doppelpunkt nach dem Laufwerksbuchstaben). Ueber
// %WINDIR% statt hartcodiertem C:\Windows aufgeloest, falls Windows auf
// einem anderen Laufwerk/Pfad installiert ist.
const tarExe = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tarExe, ['-xf', zipFile, '-C', tempDir]);

const extractedDir = path.join(tempDir, 'platform-tools');
if (!existsSync(extractedDir)) {
  throw new Error(`Erwarteter Ordner fehlt nach dem Entpacken: ${extractedDir}. Inhalt: ${readdirSync(tempDir).join(', ')}`);
}

mkdirSync(CACHE_DIR, { recursive: true });
for (const file of NEEDED_FILES) {
  copyFileSync(path.join(extractedDir, file), path.join(CACHE_DIR, file));
}

rmSync(tempDir, { recursive: true, force: true });
console.log(`Fertig: ${CACHE_DIR} (${NEEDED_FILES.join(', ')})`);
