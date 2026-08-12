#!/usr/bin/env node
// Erzeugt assets/landed.ico aus der echten Bildmarke (assets/landed-logo.svg,
// die gelandete Untertasse mit Chrome-Kuppel) - ersetzt die fruehere von
// Hand mit GDI+ gezeichnete Drei-Punkte-Platzhaltermarke.
//
// GDI+ (System.Drawing, das vorherige Werkzeug) kann kein SVG parsen - dafuer
// braeuchte es entweder eine npm-Abhaengigkeit (sharp/resvg) oder ein externes
// Tool (Inkscape/ImageMagick, auf diesem System nicht installiert). Stattdessen
// wird ein auf jedem Windows 11 ohnehin vorhandener Chromium-Browser (Edge,
// per Registry-Suche wie in lib/launcher.mjs) headless zum Rastern jeder
// Icon-Groesse genutzt - kein Zusatz-Tool, keine neue Abhaengigkeit.
//
// Aufruf: node tools/make-icon.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome, findEdge } from '../lib/launcher.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG_FILE = path.join(ROOT, 'assets', 'landed-logo.svg');
const OUT_FILE = path.join(ROOT, 'assets', 'landed.ico');
const SIZES = [16, 32, 48, 64, 256];

const browser = (await findEdge()) || (await findChrome());
if (!browser) {
  console.error('Weder Edge noch Chrome per Registry gefunden - einer von beiden wird zum Rastern des SVG-Logos gebraucht.');
  process.exit(1);
}

// fill auf dem Wurzel-<svg> statt auf jedem einzelnen <path>/<circle>: fill
// ist eine vererbte SVG-Eigenschaft, die Bildmarke selbst setzt kein eigenes
// fill (daher schwarz per SVG-Default) - ein einziges Attribut hier faerbt
// die komplette Marke weiss fuer den dunklen Kachelhintergrund.
const rawSvg = readFileSync(SVG_FILE, 'utf8');
const whiteSvg = rawSvg.replace('<svg ', '<svg fill="#ffffff" ');

// Dunkle Kachel (Markenfarbe #202124, wie zuvor) statt Transparenz: eine
// schwarze/dunkle Bildmarke waere auf einer dunklen Taskleiste unsichtbar.
// Volle Kantenlaenge statt abgerundeter Ecken, damit kein Transparenz-Handling
// noetig ist (headless-Screenshots sind sonst nur ueber CDP sauber
// transparent zu bekommen) - Windows rundet Taskleisten-Icons ohnehin selbst.
function pageHtml(size) {
  const pad = Math.round(size * 0.16);
  return `<!doctype html><html><head><style>
html,body{margin:0;padding:0;overflow:hidden;background:#202124;}
.tile{width:${size}px;height:${size}px;box-sizing:border-box;padding:${pad}px;}
.tile svg{width:100%;height:100%;display:block;}
</style></head><body><div class="tile">${whiteSvg}</div></body></html>`;
}

const tempDir = mkdtempSync(path.join(tmpdir(), 'landed-icon-'));

const pngBuffers = SIZES.map((size) => {
  const htmlFile = path.join(tempDir, `${size}.html`);
  const pngFile = path.join(tempDir, `${size}.png`);
  writeFileSync(htmlFile, pageHtml(size));
  execFileSync(browser, [
    '--headless',
    '--disable-gpu',
    `--user-data-dir=${path.join(tempDir, 'profile')}`, // isolierte Instanz, kollidiert nicht mit einer laufenden Edge-Sitzung
    `--screenshot=${pngFile}`,
    `--window-size=${size},${size}`,
    pathToFileURL(htmlFile).href,
  ]);
  return readFileSync(pngFile);
});

// ICO-Container von Hand zusammengesetzt: 6-Byte ICONDIR-Header + je ein
// 16-Byte ICONDIRENTRY, danach die PNG-Bytes aller Groessen hintereinander.
// Windows Vista+ akzeptiert PNG-komprimierte Eintraege direkt (kein
// unkomprimiertes BMP-DIB noetig, auch nicht fuer die kleinen Groessen).
const headerSize = 6 + SIZES.length * 16;
let offset = headerSize;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(SIZES.length, 4);

const entries = SIZES.map((size, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 = 256)
  entry.writeUInt8(0, 2); // color count (0 = kein Palette)
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffers[i].length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += pngBuffers[i].length;
  return entry;
});

mkdirSync(path.dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, Buffer.concat([header, ...entries, ...pngBuffers]));
rmSync(tempDir, { recursive: true, force: true });

console.log(`Fertig: ${OUT_FILE} (${SIZES.join('/')} px)`);
