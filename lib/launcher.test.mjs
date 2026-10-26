import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGoogleChromePath } from './launcher.mjs';

test('isGoogleChromePath: nur echtes Google Chrome, kein Chromium-Fork', () => {
  assert.equal(isGoogleChromePath('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'), true);
  assert.equal(isGoogleChromePath('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'), true);
  assert.equal(isGoogleChromePath('C:\\Users\\x\\AppData\\Local\\Google\\Chrome SxS\\Application\\chrome.exe'), true);
  assert.equal(isGoogleChromePath('C:\\Users\\x\\AppData\\Local\\BrowserClaw\\Application\\chrome.exe'), false);
  assert.equal(isGoogleChromePath(null), false);
});
