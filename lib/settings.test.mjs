import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSettings, completeSetup, updateSettings } from './settings.mjs';
import { withTempData } from './test-helpers.mjs';

test('getSettings ohne vorherige Datei liefert setupCompletedAt: null', async () => {
  await withTempData(async () => {
    const settings = await getSettings();
    assert.equal(settings.setupCompletedAt, null);
  });
});

test('completeSetup schreibt setupCompletedAt/completedVia und ist danach ueber getSettings sichtbar', async () => {
  await withTempData(async () => {
    await completeSetup('skip');
    const settings = await getSettings();
    assert.ok(settings.setupCompletedAt);
    assert.equal(settings.completedVia, 'skip');
    assert.equal(settings.setupVersion, 1);
  });
});

test('wirelessAdbEnabled ist ohne Zutun aus - Opt-in, kein Automatismus', async () => {
  await withTempData(async () => {
    assert.equal((await getSettings()).wirelessAdbEnabled, false);
    // Auch nach dem Abschliessen des Assistenten: nichts schaltet das Flag
    // nebenbei ein.
    await completeSetup('wizard');
    assert.equal((await getSettings()).wirelessAdbEnabled, false);
    assert.equal((await getSettings()).lastWirelessTarget, null);
  });
});

test('showBoardDecision ist standardmäßig "auto" (Auflösung passiert in server.mjs settingsHandler)', async () => {
  await withTempData(async () => {
    assert.equal((await getSettings()).showBoardDecision, 'auto');
  });
});

test('updateSettings aendert nur das uebergebene Feld und bleibt persistent', async () => {
  await withTempData(async () => {
    await completeSetup('wizard');
    await updateSettings({ wirelessAdbEnabled: true, lastWirelessTarget: '192.168.1.42:5555' });
    const settings = await getSettings();
    assert.equal(settings.wirelessAdbEnabled, true);
    assert.equal(settings.lastWirelessTarget, '192.168.1.42:5555');
    assert.equal(settings.completedVia, 'wizard', 'bestehende Felder bleiben erhalten');
  });
});
