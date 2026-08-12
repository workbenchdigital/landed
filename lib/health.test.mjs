import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __testables } from './health.mjs';

const { classifyDeviceError } = __testables;

function dev(state, transport = 'usb') {
  return { serial: 'x', state, transport, model: null, transportId: null };
}

test('classifyDeviceError: kein Geraet -> hint "none"', () => {
  const result = classifyDeviceError([]);
  assert.equal(result.hint, 'none');
});

test('classifyDeviceError: genau ein bereites USB-Geraet -> kein Fehler (null)', () => {
  assert.equal(classifyDeviceError([dev('device')]), null);
});

test('classifyDeviceError: unauthorized -> hint "unauthorized"', () => {
  const result = classifyDeviceError([dev('unauthorized')]);
  assert.equal(result.hint, 'unauthorized');
});

test('classifyDeviceError: offline -> hint "offline"', () => {
  const result = classifyDeviceError([dev('offline')]);
  assert.equal(result.hint, 'offline');
});

test('classifyDeviceError: nur drahtlos verbunden -> hint "wireless-only"', () => {
  const result = classifyDeviceError([dev('device', 'wireless')]);
  assert.equal(result.hint, 'wireless-only');
});

test('classifyDeviceError: mehrere bereite USB-Geraete -> hint "multiple"', () => {
  const result = classifyDeviceError([dev('device'), dev('device')]);
  assert.equal(result.hint, 'multiple');
});

test('classifyDeviceError mit Wireless-Opt-in: drahtloses Geraet ist ein gueltiges Ziel', () => {
  assert.equal(classifyDeviceError([dev('device', 'wireless')], true), null);
});

test('classifyDeviceError mit Wireless-Opt-in: USB + drahtlos gleichzeitig -> hint "multiple"', () => {
  assert.equal(classifyDeviceError([dev('device'), dev('device', 'wireless')], true).hint, 'multiple');
});

test('classifyDeviceError: ein bereites USB-Geraet unter mehreren Zustaenden gewinnt (kein Fehler)', () => {
  // Ein autorisiertes + ein unautorisiertes Geraet gleichzeitig verbunden -
  // das bereite Geraet ist trotzdem nutzbar, kein "multiple"/"unauthorized".
  assert.equal(classifyDeviceError([dev('device'), dev('unauthorized')]), null);
});
