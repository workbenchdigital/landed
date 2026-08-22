import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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

test('bookmarksInstalled meldet false, wenn keine Token-Datei existiert', async () => {
  await withTempToken(async (tokenFile) => {
    assert.equal(await bookmarksInstalled({ tokenFile }), false);
  });
});

test('bookmarksInstalled meldet true, wenn die Token-Datei existiert', async () => {
  await withTempToken(async (tokenFile) => {
    await writeFile(tokenFile, 'abc123', 'utf8');
    assert.equal(await bookmarksInstalled({ tokenFile }), true);
  });
});

test('forwardToBookmarks ist fail-soft, wenn keine Token-Datei existiert (nicht installiert)', async () => {
  await withTempToken(async (tokenFile) => {
    const result = await forwardToBookmarks([{ url: 'https://a.test', title: 'A' }], {
      tokenFile,
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
      { tokenFile, fetchImpl }
    );
    assert.deepEqual(result, { ok: true, count: 2 });
    assert.equal(capturedHeaders['X-Inbox-Token'], 'mytoken');
    assert.equal(capturedBody.items.length, 2);
  });
});

test('forwardToBookmarks ist fail-soft, wenn LANDED Bookmarks nicht erreichbar ist', async () => {
  await withTempToken(async (tokenFile) => {
    await writeFile(tokenFile, 'mytoken', 'utf8');
    const result = await forwardToBookmarks([{ url: 'https://a.test', title: 'A' }], {
      tokenFile,
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    assert.deepEqual(result, { ok: false, count: 0 });
  });
});

test('forwardToBookmarks liefert ok:true,count:0 ohne Netzwerkaufruf bei leerer Liste', async () => {
  await withTempToken(async (tokenFile) => {
    const result = await forwardToBookmarks([], {
      tokenFile,
      fetchImpl: async () => { throw new Error('sollte nie aufgerufen werden'); },
    });
    assert.deepEqual(result, { ok: true, count: 0 });
  });
});
