import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDevices, checkSessionConflict, pickDevice, wirelessTarget } from './adb.mjs';

// Realistische adb-devices-l-Ausgabe: Daemon-Rauschzeile, Kopfzeile, ein
// autorisiertes USB-Geraet, ein unautorisiertes, ein offline haengendes
// Emulator-Geraet und ein per WLAN verbundenes Geraet (adb connect). Das ist
// genau die Mischung, an der die vorherige rohe .slice(1)-Zeilenliste
// device/unauthorized/offline und USB/drahtlos nicht unterscheiden konnte.
const FIXTURE = `* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
R58M12ABCDE            device usb:1-1 product:beyond1qlteue model:SM_G991B device:beyond1q transport_id:5
R58M99ZZZZZ            unauthorized transport_id:7
emulator-5554          offline transport_id:1
192.168.1.42:5555      device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64x transport_id:3

`;

test('parseDevices ignoriert Daemon-Rauschzeilen und die Kopfzeile', () => {
  const devices = parseDevices(FIXTURE);
  assert.equal(devices.length, 4, 'erwartet genau 4 Geraete, keine Rausch-/Leerzeilen');
});

test('parseDevices unterscheidet device/unauthorized/offline', () => {
  const [usbOk, unauthorized, offline] = parseDevices(FIXTURE);
  assert.equal(usbOk.state, 'device');
  assert.equal(unauthorized.state, 'unauthorized');
  assert.equal(offline.state, 'offline');
});

test('parseDevices unterscheidet USB von drahtlos verbundenen Geraeten', () => {
  const devices = parseDevices(FIXTURE);
  const usb = devices.filter((d) => d.transport === 'usb');
  const wireless = devices.filter((d) => d.transport === 'wireless');
  assert.equal(usb.length, 3, 'USB: autorisiert, unauthorized und offline sind alle USB-Seriennummern');
  assert.equal(wireless.length, 1, 'nur der IP:Port-Eintrag ist drahtlos');
  assert.equal(wireless[0].serial, '192.168.1.42:5555');
});

test('parseDevices extrahiert model und transportId', () => {
  const [usbOk] = parseDevices(FIXTURE);
  assert.equal(usbOk.serial, 'R58M12ABCDE');
  assert.equal(usbOk.model, 'SM_G991B');
  assert.equal(usbOk.transportId, '5');
});

test('parseDevices bei leerer/keiner Geraete-Ausgabe liefert leeres Array', () => {
  const noneOutput = 'List of devices attached\n\n';
  assert.deepEqual(parseDevices(noneOutput), []);
});

// codemouseai-Review auf PR #13: eine waehrend refs>0 eintreffende Anfrage
// fuer ein ANDERES Geraet durfte die laufende Sitzung nicht stillschweigend
// mitbenutzen (Scan-Ergebnisse von Geraet A landen sonst unter Bs items.json).
test('checkSessionConflict: keine offene Sitzung (refs=0) - immer erlaubt', () => {
  assert.doesNotThrow(() => checkSessionConflict(0, null, 'B'));
  assert.doesNotThrow(() => checkSessionConflict(0, 'A', 'B')); // sessionSerial aus vorheriger, schon geschlossener Sitzung
});

test('checkSessionConflict: Single-Device-Automodus (kein serial auf einer Seite) - immer erlaubt', () => {
  assert.doesNotThrow(() => checkSessionConflict(1, null, null));
  assert.doesNotThrow(() => checkSessionConflict(1, null, 'B')); // erste Sitzung war Automodus
  assert.doesNotThrow(() => checkSessionConflict(1, 'A', null)); // neue Anfrage ohne Praeferenz
});

test('checkSessionConflict: dasselbe Geraet erneut anfragen (Verschachtelung) - erlaubt', () => {
  assert.doesNotThrow(() => checkSessionConflict(1, 'A', 'A'));
});

test('checkSessionConflict: laufende Sitzung fuer A, Anfrage fuer B - wirft', () => {
  assert.throws(() => checkSessionConflict(1, 'A', 'B'), /Sitzung für Gerät 'A' läuft bereits/);
});

// ---- Geraeteauswahl: USB-Standard vs. Wireless-Opt-in ----
// Die Faelle mit allowWireless=false bilden das Verhalten VOR dem Opt-in ab
// und muessen unveraendert bleiben - das ist der eigentliche Regressionstest.

const usbReady = { serial: 'R58M12ABCDE', state: 'device', transport: 'usb' };
const usbReady2 = { serial: 'R58M99YYYYY', state: 'device', transport: 'usb' };
const wifiReady = { serial: '192.168.1.42:5555', state: 'device', transport: 'wireless' };
const usbOffline = { serial: 'R58M77XXXXX', state: 'offline', transport: 'usb' };

test('pickDevice (Flag aus): genau ein USB-Geraet wird gewaehlt', () => {
  assert.equal(pickDevice([usbReady, usbOffline], null).serial, usbReady.serial);
});

test('pickDevice (Flag aus): nur drahtlos verbunden - wirft die USB-only-Meldung', () => {
  assert.throws(() => pickDevice([wifiReady], null), /nutzt ausschließlich USB/);
});

test('pickDevice (Flag aus): drahtloses Geraet zaehlt auch bei preferredSerial nicht', () => {
  assert.throws(() => pickDevice([wifiReady], wifiReady.serial), /nicht per USB verbunden/);
});

test('pickDevice (Flag aus): mehrere USB-Geraete ohne Praeferenz - wirft', () => {
  assert.throws(() => pickDevice([usbReady, usbReady2], null), /Mehrere Geräte per USB verbunden/);
});

test('pickDevice (Flag aus): gar kein Geraet - adb-Wortlaut fuer friendlyError', () => {
  assert.throws(() => pickDevice([], null), /no devices\/emulators found/);
});

test('pickDevice (Flag an): drahtloses Geraet ist waehlbar', () => {
  assert.equal(pickDevice([wifiReady], null, true).serial, wifiReady.serial);
  assert.equal(pickDevice([wifiReady], wifiReady.serial, true).serial, wifiReady.serial);
});

test('pickDevice (Flag an): USB hat weiterhin denselben Weg, kein Sonderpfad', () => {
  assert.equal(pickDevice([usbReady], null, true).serial, usbReady.serial);
  assert.throws(() => pickDevice([usbReady, wifiReady], null, true), /Mehrere Geräte verbunden/);
});

test('pickDevice (Flag an): nicht bereite Geraete bleiben aussen vor', () => {
  assert.throws(() => pickDevice([usbOffline], null, true), /no devices\/emulators found/);
});

// ---- Eingabevalidierung vor execFile ----

test('wirelessTarget normalisiert gueltige Eingaben zu ip:port', () => {
  assert.equal(wirelessTarget('192.168.1.42', '5555'), '192.168.1.42:5555');
  assert.equal(wirelessTarget(' 10.0.0.7 ', 37123), '10.0.0.7:37123');
  assert.equal(wirelessTarget('192.168.001.042', '5555'), '192.168.1.42:5555');
});

test('wirelessTarget weist ungueltige IPs ab', () => {
  for (const bad of ['', '192.168.1', '192.168.1.256', 'localhost', '1.2.3.4;rm -rf /', null]) {
    assert.throws(() => wirelessTarget(bad, '5555'), /Ungültige IP-Adresse/, `IP: ${bad}`);
  }
});

test('wirelessTarget weist ungueltige Ports ab', () => {
  for (const bad of ['', '0', '70000', '-1', '55 55', '5555abc', null]) {
    assert.throws(() => wirelessTarget('192.168.1.42', bad), /Ungültiger Port/, `Port: ${bad}`);
  }
});

test('wirelessTarget baut nur harmlose Argumente - nie etwas, das adb als Option liest', () => {
  // execFile kennt keine Shell, aber ein Argument, das mit "-" beginnt, waere
  // fuer adb ein Schalter statt einer Adresse. Die Normalisierung laesst das
  // gar nicht erst zu: Ausgabe ist immer ziffern-/punktbasiert.
  assert.match(wirelessTarget('192.168.1.42', '5555'), /^\d+(\.\d+){3}:\d+$/);
  for (const bad of ['-a 1.2.3.4', '1.2.3.4 --foo', '$(whoami).2.3.4']) {
    assert.throws(() => wirelessTarget(bad, '5555'), /Ungültige IP-Adresse/, `IP: ${bad}`);
  }
  assert.throws(() => wirelessTarget('192.168.1.42', '-1'), /Ungültiger Port/);
});

test('wirelessTarget prueft den Pairing-Code nur, wenn einer erwartet wird', () => {
  assert.equal(wirelessTarget('192.168.1.42', '37123', '123456'), '192.168.1.42:37123');
  for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', null]) {
    assert.throws(() => wirelessTarget('192.168.1.42', '37123', bad), /Ungültiger Pairing-Code/, `Code: ${bad}`);
  }
});
