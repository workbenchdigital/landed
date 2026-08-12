// Eigene Datei statt in app.js: der Assistent hat sein eigenes, in sich
// geschlossenes Zustandsmodell (Schritt, Polling, Live-Erkennung) und wuerde
// app.js sonst weiter aufblaehen.

import { t } from './i18n.mjs';

const ICON_SETTINGS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>';
const ICON_CABLE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="6" height="6" rx="1"/><path d="M9 12h4M13 8v8M13 8h4a2 2 0 012 2v4a2 2 0 01-2 2h-4"/></svg>';
const ICON_CHROME =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3v6M12 15v6M4.8 7.5l5.6 3.3M18.6 16.2l-5.7-3.3M4.8 16.5l5.6-3.3M18.6 7.8l-5.7 3.3"/></svg>';

// step: die feste Schrittdefinition (Titel/Body als i18n-Keys statt fester
// Strings, siehe i18n.mjs STRINGS.*.wizardStepXTitle/Html - t() wird bei
// jedem renderStep()-Aufruf frisch ausgewertet, damit ein Sprachwechsel auch
// bei offenem Assistenten greift). liveHintKey (optional): Statuszeile beim
// Warten auf Live-Erkennung, done: Bedingung gegen die letzte /api/health-
// Antwort, ab der automatisch weitergeschaltet wird (Schritte 2-4).
const STEPS = [
  { titleKey: 'wizardStep0Title', htmlKey: 'wizardStep0Html' },
  { titleKey: 'wizardStep1Title', icon: ICON_SETTINGS, htmlKey: 'wizardStep1Html' },
  { titleKey: 'wizardStep2Title', icon: ICON_CABLE, htmlKey: 'wizardStep2Html', liveHintKey: 'wizardStep2LiveHint' },
  { titleKey: 'wizardStep3Title', htmlKey: 'wizardStep3Html', liveHintKey: 'wizardStep3LiveHint' },
  { titleKey: 'wizardStep4Title', icon: ICON_CHROME, htmlKey: 'wizardStep4Html', liveHintKey: 'wizardStep4LiveHint' },
  {
    titleKey: 'wizardStep5Title',
    htmlKey: null, // wird dynamisch aus dem letzten Health-Stand gerendert, siehe renderFinalStep()
  },
];

const dialogEl = document.getElementById('setupWizard');
const bodyEl = document.getElementById('wizardBody');
const progressEl = document.getElementById('wizardProgress');
const nextBtn = document.getElementById('wizardNext');
const skipBtn = document.getElementById('wizardSkip');

let currentStep = 0;
let completedMarked = false;
let lastHealth = null;
let pollTimeoutId = null;
let pollAbort = null;
let lastChangeAt = 0;
let pollInterval = 1500;
const POLL_INTERVAL_MS = 1500;
const POLL_SLOW_MS = 5000;
const POLL_SLOWDOWN_AFTER_MS = 120_000;

function isStep2Done(h) {
  return (h.devices?.length ?? 0) > 0;
}
function isStep3Done(h) {
  return isStep2Done(h) && h.step !== 'device';
}
function isStep4Done(h) {
  return h.chrome?.ok === true;
}

function reachableStep(h) {
  if (isStep4Done(h)) return 5;
  if (isStep3Done(h)) return 4;
  if (isStep2Done(h)) return 3;
  return 2;
}

async function markComplete(via) {
  if (completedMarked) return;
  completedMarked = true;
  try {
    await fetch('/api/settings/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completedVia: via }),
    });
  } catch {
    // Bestenfalls beim naechsten Laden erneut versucht - kein blockierender Fehler
  }
}

// h.securityPatch kommt vom verbundenen Geraet (adb shell getprop
// ro.build.version.security_patch) - kein vertrauenswuerdiger String. t()
// escaped Platzhalter nicht (siehe i18n.mjs), und dieser Wert landet unten
// per innerHTML im DOM - ohne Escaping waere ein praeparierter Systemwert
// (gerootetes/emuliertes Geraet) ein DOM-XSS-Sink.
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderFinalStep() {
  const h = lastHealth;
  const title = t('wizardStep5Title');
  if (!h || !h.chrome?.ok) {
    bodyEl.innerHTML = `<h2>${title}</h2><p>${t('wizardFinalWaiting')}</p>`;
    return;
  }
  const patchLine = h.securityPatch ? t('wizardFinalPatchLine', { patch: escapeHtml(h.securityPatch) }) : '';
  const tabLine =
    h.chrome.tabCount > 0
      ? t('wizardFinalTabsFound', { n: h.chrome.tabCount })
      : t('wizardFinalNoTabs');
  bodyEl.innerHTML = `
    <h2>${title}</h2>
    ${tabLine}
    ${patchLine}
    <button id="wizardShortcutBtn" type="button">${t('createShortcutBtn')}</button>
    <p class="wizard-hint" id="wizardShortcutStatus"></p>
  `;
  const shortcutBtn = document.getElementById('wizardShortcutBtn');
  const statusEl = document.getElementById('wizardShortcutStatus');
  shortcutBtn.addEventListener('click', async () => {
    shortcutBtn.disabled = true;
    try {
      const res = await fetch('/api/create-shortcut', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('genericFailed'));
      statusEl.textContent = t('shortcutCreated', { path: data.shortcutPath });
    } catch (e) {
      // Aus dem Quellcode gestartet (kein SEA) lehnt der Server das ab - nur
      // die gepackte .exe kann eine sinnvolle Verknuepfung auf sich selbst anlegen.
      // e.message kommt vom Server (Deutsch) - bewusst nicht uebersetzt, siehe Scope-Grenze.
      statusEl.textContent = e.message;
      shortcutBtn.disabled = false;
    }
  });
}

function renderStep() {
  const step = STEPS[currentStep];
  progressEl.textContent = t('wizardProgress', { current: currentStep + 1, total: STEPS.length });
  skipBtn.hidden = currentStep === STEPS.length - 1;
  nextBtn.textContent = currentStep === STEPS.length - 1 ? t('wizardClose') : t('wizardNext');

  if (currentStep === STEPS.length - 1) {
    renderFinalStep();
    return;
  }

  const icon = step.icon ? `<div class="wizard-icon">${step.icon}</div>` : '';
  const liveStatus =
    step.liveHintKey && currentStep >= 2 && currentStep <= 4
      ? `<p class="wizard-live" id="wizardLiveStatus">${t(step.liveHintKey)}</p>`
      : '';
  bodyEl.innerHTML = `${icon}<h2>${t(step.titleKey)}</h2>${t(step.htmlKey)}${liveStatus}`;
}

function showRegressionBanner(show) {
  let banner = bodyEl.querySelector('.wizard-regression');
  if (show && !banner) {
    banner = document.createElement('p');
    banner.className = 'wizard-regression';
    banner.textContent = t('connectionInterrupted');
    bodyEl.appendChild(banner);
  } else if (!show && banner) {
    banner.remove();
  }
}

function handleHealthUpdate(health) {
  lastHealth = health;
  if (currentStep < 2) return; // Schritte 0/1 sind rein informativ, kein Auto-Vorruecken

  const reachable = reachableStep(health);
  if (currentStep <= 4 && reachable > currentStep) {
    currentStep = reachable;
    renderStep();
    syncPollingForStep(); // stoppt automatisch, sobald Schritt 5 erreicht ist
    return;
  }
  if (currentStep <= 5 && reachable < currentStep) {
    // Vorwaerts automatisch, rueckwaerts nie (siehe Plan) - nur ein
    // Hinweisstreifen statt zurueckzuspringen, falls z.B. das Kabel rausfliegt.
    showRegressionBanner(true);
  } else {
    showRegressionBanner(false);
  }
  if (currentStep === 5) renderFinalStep();
}

let isPolling = false;

async function pollOnce() {
  pollAbort = new AbortController();
  try {
    const res = await fetch('/api/health', { method: 'POST', signal: pollAbort.signal });
    const health = await res.json();
    const json = JSON.stringify(health);
    if (json !== JSON.stringify(lastHealth)) {
      lastChangeAt = Date.now();
      pollInterval = POLL_INTERVAL_MS;
      handleHealthUpdate(health);
    } else if (Date.now() - lastChangeAt > POLL_SLOWDOWN_AFTER_MS) {
      pollInterval = POLL_SLOW_MS;
    }
  } catch {
    // Abgebrochen (Dialog zu/Tab versteckt) oder Netzwerkfehler - naechster Tick versucht es erneut
  }
  if (isPolling && dialogEl.open && !document.hidden) {
    pollTimeoutId = setTimeout(pollOnce, pollInterval);
  }
}

function stopPolling() {
  isPolling = false;
  if (pollTimeoutId) clearTimeout(pollTimeoutId);
  pollTimeoutId = null;
  pollAbort?.abort();
}

// Startet nur, wenn noch nicht aktiv - ein zweiter Aufruf waehrend eine
// pollOnce()-Kette schon laeuft wuerde sonst eine zweite, parallele Kette
// erzeugen und die Anfragerate verdoppeln.
function startPolling() {
  if (isPolling) return;
  isPolling = true;
  pollOnce();
}

// Bewusst je Schrittwechsel neu entschieden statt nur beim initialen Oeffnen:
// der Standardweg oeffnet den Assistenten bei Schritt 0 und der Nutzer
// klickt sich manuell zu Schritt 2 hoch - ohne diesen Aufruf haette die
// Live-Erkennung dort nie angefangen (codemouseai-Review auf PR #10).
function syncPollingForStep() {
  if (currentStep >= 2 && currentStep <= 4) startPolling();
  else stopPolling();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling();
  else if (dialogEl.open) syncPollingForStep();
});

nextBtn.addEventListener('click', () => {
  if (currentStep === STEPS.length - 1) {
    markComplete('wizard');
    dialogEl.close();
    return;
  }
  currentStep++;
  renderStep();
  syncPollingForStep();
});

skipBtn.addEventListener('click', () => {
  // Nicht nur auf das 'close'-Event verlassen (deckt Esc/Backdrop ab, siehe
  // unten) - explizit hier aufrufen ist die zuverlaessigere Garantie fuer den
  // haeufigsten Fall, dass "Ueberspringen" tatsaechlich als abgeschlossen zaehlt.
  markComplete('skip');
  dialogEl.close();
});

// Deckt Esc und Backdrop-Klick ab (die keinen eigenen Klick-Handler haben) -
// Ueberspringen zaehlt laut Plan als abgeschlossen, damit der Assistent nicht
// bei jedem Laden erneut aufploppt. markComplete() ist idempotent
// (completedMarked-Flag), doppelt schadet also nichts.
dialogEl.addEventListener('close', () => {
  stopPolling();
  markComplete('skip');
});

dialogEl.addEventListener('click', (e) => {
  // Klick auf das <dialog>-Element selbst (nicht auf ein Kind) = Backdrop-Klick
  if (e.target === dialogEl) dialogEl.close();
});

// ---- Drahtlose Verbindung (Opt-in) ----
// Bewusst neben der Schrittkette, nicht als Schritt: der Regelweg bleibt USB.
// Der Pairing-Code wird nur an den Server durchgereicht und danach sofort aus
// dem Feld geloescht - Landed speichert ihn nirgends.
const wirelessEl = {
  panel: document.getElementById('wirelessPanel'),
  enabled: document.getElementById('wirelessEnabled'),
  fields: document.getElementById('wirelessFields'),
  ip: document.getElementById('wirelessIp'),
  pairPort: document.getElementById('wirelessPairPort'),
  code: document.getElementById('wirelessCode'),
  port: document.getElementById('wirelessPort'),
  pairBtn: document.getElementById('wirelessPairBtn'),
  connectBtn: document.getElementById('wirelessConnectBtn'),
  status: document.getElementById('wirelessStatus'),
};

async function postJson(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || t('genericFailed'));
  return data;
}

async function loadWirelessSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    wirelessEl.enabled.checked = settings.wirelessAdbEnabled === true;
    wirelessEl.fields.hidden = !wirelessEl.enabled.checked;
    // lastWirelessTarget ist reine Bequemlichkeit (kein Geheimnis) - belegt
    // IP und Verbindungsport vor, Pairing-Port und Code bleiben immer leer.
    const [ip, port] = (settings.lastWirelessTarget || '').split(':');
    if (ip && !wirelessEl.ip.value) wirelessEl.ip.value = ip;
    if (port && !wirelessEl.port.value) wirelessEl.port.value = port;
  } catch {
    // Einstellungen nicht ladbar - Panel bleibt im Aus-Zustand, kein Blocker
  }
}

wirelessEl.enabled.addEventListener('change', async () => {
  const enabled = wirelessEl.enabled.checked;
  try {
    await postJson('/api/settings/wireless', { enabled });
    wirelessEl.fields.hidden = !enabled;
    wirelessEl.status.textContent = enabled ? t('wirelessEnabledMsg') : t('wirelessDisabledMsg');
  } catch (e) {
    wirelessEl.enabled.checked = !enabled; // Serverzustand hat das letzte Wort
    wirelessEl.status.textContent = e.message;
  }
});

async function runWirelessAction(btn, fn) {
  btn.disabled = true;
  wirelessEl.status.textContent = t('runningStatus');
  try {
    wirelessEl.status.textContent = await fn();
  } catch (e) {
    wirelessEl.status.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

wirelessEl.pairBtn.addEventListener('click', () =>
  runWirelessAction(wirelessEl.pairBtn, async () => {
    const data = await postJson('/api/wireless/pair', {
      ip: wirelessEl.ip.value,
      port: wirelessEl.pairPort.value,
      code: wirelessEl.code.value,
    });
    // Code ist einmalig und ab hier wertlos - sofort aus dem DOM entfernen.
    wirelessEl.code.value = '';
    return data.message || t('wirelessPairedDefault');
  })
);

wirelessEl.connectBtn.addEventListener('click', () =>
  runWirelessAction(wirelessEl.connectBtn, async () => {
    const data = await postJson('/api/wireless/connect', {
      ip: wirelessEl.ip.value,
      port: wirelessEl.port.value,
    });
    return data.message || t('wirelessConnectedDefault', { target: data.target });
  })
);

export function openWizard(startStep = 0) {
  currentStep = Math.min(Math.max(startStep, 0), STEPS.length - 1);
  completedMarked = false;
  lastHealth = null;
  lastChangeAt = Date.now();
  pollInterval = POLL_INTERVAL_MS;
  renderStep();
  wirelessEl.panel.open = false; // eingeklappt oeffnen - der Regelweg bleibt USB
  wirelessEl.status.textContent = '';
  loadWirelessSettings();
  if (!dialogEl.open) dialogEl.showModal();
  syncPollingForStep();
}

// Fuer die "Einrichtung pruefen"-Aktion aus Fehler-Toasts: oeffnet direkt bei
// dem Schritt, der zum aktuellen /api/health-hint passt, statt immer bei 0.
export function openWizardAtHint(hint) {
  const stepByHint = {
    missing: 1,
    none: 2,
    unauthorized: 3,
    offline: 3,
    multiple: 3,
    'wireless-only': 2,
    'forward-failed': 4,
    'not-running': 4,
    'no-tabs': 4,
  };
  openWizard(stepByHint[hint] ?? 0);
}

// Fuer den Sprachumschalter (app.js #langSwitch): der Assistent haelt seine
// STEPS-Titel/Bodys nicht als fertige Strings, sondern loest sie erst bei
// renderStep() ueber t() auf - ein Sprachwechsel bei offenem Dialog braucht
// darum nur einen erneuten renderStep()-Aufruf, kein eigenes Neuladen.
export function refreshWizardLanguage() {
  if (dialogEl.open) renderStep();
}
