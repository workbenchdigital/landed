import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bookmarksInstalled, forwardToBookmarks } from './bookmarksHandover.mjs';

async function withTempToken(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'landed-handover-'));
  try {
    return await fn(path.join(dir, 'inbox.token'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('bookmarksInstalled meldet false, wenn keine der Token-Dateien existiert', async () => {
  await withTempToken(async (tokenFile) => {
    assert.equal(await bookmarksInstalled({ tokenFileCandidates: [tokenFile] }), false);
  });
});

test('bookmarksInstalled meldet true, wenn die (unpaketierte) Token-Datei existiert', async () => {
  await withTempToken(async (tokenFile) => {
    await writeFile(tokenFile, 'abc123', 'utf8');
    assert.equal(await bookmarksInstalled({ tokenFileCandidates: [tokenFile] }), true);
  });
});

// M6/D5: der Kern des Fixes - unter MSIX existiert NUR der virtualisierte
// Pfad, der unpaketierte (erste) Kandidat fehlt. Ohne den zweiten Kandidaten
// waere bookmarksInstalled() hier faelschlich false und die fuenfte
// Ablage-Entscheidung "Board" wuerde unbemerkt aus der Oberflaeche
// verschwinden (siehe LANDED-Bookmarks docs/decisions.md, 05.09.2026).
test('bookmarksInstalled meldet true, wenn nur der ZWEITE Kandidat (MSIX-Pfad) existiert', async () => {
  await withTempToken(async (missingTokenFile) => {
    await withTempToken(async (packagedTokenFile) => {
      await writeFile(packagedTokenFile, 'abc123', 'utf8');
      assert.equal(
        await bookmarksInstalled({ tokenFileCandidates: [missingTokenFile, packagedTokenFile] }),
        true
      );
    });
  });
});

test('forwardToBookmarks ist fail-soft, wenn keine der Token-Dateien existiert (nicht installiert)', async () => {
  await withTempToken(async (tokenFile) => {
    const result = await forwardToBookmarks([{ url: 'https://a.test', title: 'A' }], {
      tokenFileCandidates: [tokenFile],
      fetchImpl: async () => { throw new Error('sollte nie aufgerufen werden'); },
    });
    assert.deepEqual(result, { ok: false, count: 0 });
  });
});

test('forwardToBookmarks postet mit Token-Header und meldet den Server-Zähler zurück', async () => {
  await withTempToken(async (tokenFile) => {
    await writeFile(tokenFile, 'mytoken', 'utf8');
    let capturedHeaders;
    let capturedBody;
    const fetchImpl = async (url, opts) => {
      capturedHeaders = opts.headers;
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ ok: true, count: 2 }) };
    };
    const result = await forwardToBookmarks(
      [{ url: 'https://a.test', title: 'A' }, { url: 'https://b.test', title: 'B' }],
      { tokenFileCandidates: [tokenFile], fetchImpl }
    );
    assert.deepEqual(result, { ok: true, count: 2 });
    assert.equal(capturedHeaders['X-Inbox-Token'], 'mytoken');
    assert.equal(capturedBody.items.length, 2);
  });
});

// M6/D5: derselbe Kern-Fall wie oben, jetzt fuer den tatsaechlichen Sendeweg
// statt nur der Installationserkennung - der erste (unpaketierte) Kandidat
// fehlt, das Token kommt aus dem zweiten (MSIX-)Kandidaten.
test('forwardToBookmarks liest das Token aus dem zweiten Kandidaten, wenn der erste fehlt', async () => {
  await withTempToken(async (missingTokenFile) => {
    await withTempToken(async (packagedTokenFile) => {
      await writeFile(packagedTokenFile, 'msix-token', 'utf8');
      let capturedHeaders;
      const fetchImpl = async (url, opts) => {
        capturedHeaders = opts.headers;
        return { ok: true, json: async () => ({ ok: true, count: 1 }) };
      };
      const result = await forwardToBookmarks([{ url: 'https://a.test', title: 'A' }], {
        tokenFileCandidates: [missingTokenFile, packagedTokenFile],
        fetchImpl,
      });
      assert.deepEqual(result, { ok: true, count: 1 });
      assert.equal(capturedHeaders['X-Inbox-Token'], 'msix-token');
    });
  });
});

test('forwardToBookmarks ist fail-soft, wenn LANDED Bookmarks nicht erreichbar ist', async () => {
  await withTempToken(async (tokenFile) => {
    await writeFile(tokenFile, 'mytoken', 'utf8');
    const result = await forwardToBookmarks([{ url: 'https://a.test', title: 'A' }], {
      tokenFileCandidates: [tokenFile],
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    assert.deepEqual(result, { ok: false, count: 0 });
  });
});

test('forwardToBookmarks liefert ok:true,count:0 ohne Netzwerkaufruf bei leerer Liste', async () => {
  await withTempToken(async (tokenFile) => {
    const result = await forwardToBookmarks([], {
      tokenFileCandidates: [tokenFile],
      fetchImpl: async () => { throw new Error('sollte nie aufgerufen werden'); },
    });
    assert.deepEqual(result, { ok: true, count: 0 });
  });
});

// Codemouse-Review PR #71: zwei Ordner mit passendem Praefix (z.B. ein
// verwaister Rest einer frueheren Installation neben dem aktuell aktiven
// Paket) - nur der ZWEITE traegt ein echtes inbox.token. Vor dem Fix haette
// entries.find() je nach readdir()-Reihenfolge des Dateisystems moeglicherweise
// den ersten (leeren) Ordner gewaehlt und bookmarksInstalled() faelschlich
// false geliefert, obwohl LANDED Bookmarks tatsaechlich installiert ist.
test('bookmarksInstalled findet das Token, wenn von zwei passenden Paket-Ordnern nur der zweite eines traegt', async () => {
  const fakeLocalAppData = await mkdtemp(path.join(tmpdir(), 'landed-handover-localappdata-'));
  try {
    const packagesDir = path.join(fakeLocalAppData, 'Packages');
    const emptyPackageDir = path.join(packagesDir, 'workbench.LandedBookmarks_aaa000');
    const realPackageDir = path.join(packagesDir, 'workbench.LandedBookmarks_zzz999');
    const tokenDir = path.join(realPackageDir, 'LocalCache', 'Local', 'LandedBookmarks');
    await mkdir(emptyPackageDir, { recursive: true });
    await mkdir(tokenDir, { recursive: true });
    await writeFile(path.join(tokenDir, 'inbox.token'), 'echtes-token', 'utf8');

    const previousLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = fakeLocalAppData;
    try {
      const fresh = await import(`./bookmarksHandover.mjs?probe=${Date.now()}-multi`);
      assert.equal(await fresh.bookmarksInstalled(), true);
      const result = await fresh.forwardToBookmarks([{ url: 'https://a.test', title: 'A' }], {
        fetchImpl: async (url, opts) => {
          assert.equal(opts.headers['X-Inbox-Token'], 'echtes-token');
          return { ok: true, json: async () => ({ ok: true, count: 1 }) };
        },
      });
      assert.deepEqual(result, { ok: true, count: 1 });
    } finally {
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocalAppData;
    }
  } finally {
    await rm(fakeLocalAppData, { recursive: true, force: true });
  }
});

// M6/D5: der Praefix-Glob selbst (resolveTokenFileCandidates() ist nicht
// exportiert, deshalb hier ueber das oeffentliche bookmarksInstalled() ohne
// Override geprueft) - simuliert einen echten %LOCALAPPDATA%\Packages-Ordner
// mit einem MSIX-Paket, dessen Name-Praefix passt, PLUS einen weiteren
// Eintrag, dessen Praefix NICHT passt (eine andere, unbeteiligte
// Store-App) - der Glob darf sich davon nicht irritieren lassen.
test('der Praefix-Glob findet das richtige Paket unter mehreren Packages-Eintraegen und ignoriert Nicht-Treffer', async () => {
  const fakeLocalAppData = await mkdtemp(path.join(tmpdir(), 'landed-handover-localappdata-'));
  try {
    const packagesDir = path.join(fakeLocalAppData, 'Packages');
    const otherAppDir = path.join(packagesDir, 'SomeOtherPublisher.SomeOtherApp_abc123');
    const ourAppDir = path.join(packagesDir, 'workbench.LandedBookmarks_xyz789');
    const tokenDir = path.join(ourAppDir, 'LocalCache', 'Local', 'LandedBookmarks');
    await mkdir(otherAppDir, { recursive: true });
    await mkdir(tokenDir, { recursive: true });
    await writeFile(path.join(tokenDir, 'inbox.token'), 'packaged-token', 'utf8');

    const previousLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = fakeLocalAppData;
    try {
      // Erzwingt einen frischen Modul-Import, damit LOCAL_APP_DATA/PACKAGES_DIR
      // die soeben gesetzte Umgebungsvariable lesen - das Modul liest sie nur
      // einmal beim ersten Import, ein zweiter Import unter Node bekaeme aus
      // dem Cache dieselbe (alte) Konstante zurueck.
      const fresh = await import(`./bookmarksHandover.mjs?probe=${Date.now()}`);
      assert.equal(await fresh.bookmarksInstalled(), true);
    } finally {
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocalAppData;
    }
  } finally {
    await rm(fakeLocalAppData, { recursive: true, force: true });
  }
});
