import assert from 'node:assert/strict';
import { friendlyError } from './errors.mjs';

assert.match(
  friendlyError(new Error("Command failed: adb.exe forward ...\nadb.exe: device unauthorized.\r\nThis adb server's $ADB_VENDOR_KEYS is not set")),
  /Debugging-Anfrage noch nicht bestätigt/
);

assert.match(friendlyError(new Error('fetch failed')), /Chrome antwortet auf dem Telefon nicht/);

assert.match(
  friendlyError(new Error('Some totally unknown weird failure\nwith extra lines\nthat should not leak')),
  /^Unerwarteter Fehler: Some totally unknown weird failure$/
);

console.log('errors.mjs: alle Checks OK');
