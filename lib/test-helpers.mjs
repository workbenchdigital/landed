import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from './config.mjs';
import { closeStore } from './items.mjs';

// Biegt config.dataDir fuer die Dauer von fn() auf ein frisches, leeres
// Temp-Verzeichnis um. Funktioniert nur, weil lib/store.mjs Pfade als
// Funktionen liest (dataPath()) statt sie beim Modul-Import einzufrieren -
// siehe lib/config.mjs.
export async function withTempData(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'landed-'));
  const previous = config.dataDir;
  config.dataDir = dir;
  try {
    return await fn(dir);
  } finally {
    // Erst das SQLite-Handle schliessen, dann loeschen: unter Windows laesst
    // sich eine offene Datenbankdatei nicht entfernen (EBUSY).
    closeStore();
    config.dataDir = previous;
    await rm(dir, { recursive: true, force: true });
  }
}
