import { DECISIONS as ALL_DECISIONS, BY_ID, KEYMAP } from './shared/decisions.mjs';
import { openWizard, openWizardAtHint, refreshWizardLanguage } from './wizard.js';
import { t, getLang, setLang, applyStaticTranslations } from './i18n.mjs';

// Gefiltert um 'board', solange LANDED Bookmarks nicht installiert ist (siehe
// applyBoardVisibility() unten, aufgerufen vor dem ersten Render) - alle
// bestehenden `for (const d of DECISIONS)`-Stellen bleiben dadurch
// unveraendert, DECISIONS zeigt einfach auf eine kuerzere Liste.
let DECISIONS = ALL_DECISIONS;

// document.documentElement.dataset.theme wurde bereits synchron im <head>
// gesetzt (index.html) - type="module" ist deferred, das waere hier zu spaet
// gegen den sichtbaren Umschlag von falsch auf richtig. Hier nur noch die
// Button-Zustaende im Theme-Switch synchronisieren.
function applyTheme(value) {
  document.documentElement.dataset.theme = value;
  document.querySelectorAll('#themeSwitch button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeValue === value);
  });
}
applyTheme(localStorage.getItem('theme') || 'auto');
applyStaticTranslations();

// Anzeige-Texte der Entscheidungen (frueher direkt in DECISIONS, siehe
// shared/decisions.mjs) liegen jetzt in i18n.mjs unter decision<Id>Label/
// StateLabel/Outcome - eine kleine Helferfamilie statt die Key-Zusammen-
// setzung an jeder Stelle zu wiederholen.
function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}
function decisionLabel(id) {
  return t('decision' + capitalize(id) + 'Label');
}
function decisionStateLabel(id) {
  return t('decision' + capitalize(id) + 'StateLabel');
}
function decisionOutcome(id) {
  return t('decision' + capitalize(id) + 'Outcome');
}
function archiveKindLabel(kind) {
  return kind === 'archived' ? t('archiveKindArchived')
    : kind === 'dropped' ? t('archiveKindDropped')
    : kind === 'done' ? t('archiveKindDone')
    : kind === 'board' ? t('archiveKindBoard')
    : kind;
}

// Datums-/Zeitformatierung folgt der App-Sprache statt fest 'de-DE' - sonst
// stuenden in einer sonst englischen Oberflaeche ploetzlich deutsch
// formatierte Daten (siehe formatMetaInfo, renderArchiveResults).
function dateLocale() {
  return getLang() === 'de' ? 'de-DE' : 'en-US';
}

function applyLangSwitchButtons() {
  const lang = localStorage.getItem('lang') || 'auto';
  document.querySelectorAll('#langSwitch button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.langValue === lang);
  });
}
applyLangSwitchButtons();
document.querySelectorAll('#langSwitch button').forEach((btn) => {
  btn.addEventListener('click', () => {
    setLang(btn.dataset.langValue);
    applyLangSwitchButtons();
    applyStaticTranslations();
    // renderLegend()/renderSortStripSkeleton() bauen ihre Labels nur einmalig
    // beim Laden auf (siehe Bootstrap ganz unten) - render() allein wuerde sie
    // darum nicht umschalten. renderSortStripSkeleton() setzt die Zahlen
    // zurueck auf 0, render() -> renderSortStrip() fuellt sie im selben Zug
    // wieder korrekt.
    renderLegend();
    renderSortStripSkeleton();
    render();
    refreshWizardLanguage();
  });
});

let inventory = [];
let filterText = '';
let focusedKey = null;
let domainSortMode = localStorage.getItem('domainSortMode') || 'count';
const collapsedDomains = new Set();

// Vorschlag 7 der Produktanalyse: standardmaessig AUS (localStorage-Default
// '0'/nicht gesetzt), wie das Farbschema und domainSortMode gemerkt.
const PC_FOCUS_BATCH_SIZE = 10;
let pcFocusMode = localStorage.getItem('pcFocusMode') === '1';

// Zustaende, die aktuell AUSGEBLENDET sind (leer = alles sichtbar, der
// Normalfall). Als ausgeschlossene statt eingeschlossene Menge gespeichert,
// damit ein neuer Zustand in DECISIONS automatisch sichtbar ist, ohne die
// gespeicherten Einstellungen aller Nutzer anzufassen.
let hiddenStates = new Set(JSON.parse(localStorage.getItem('hiddenStates') || '[]'));
const STATE_FILTER_OPTIONS = [{ id: 'open', key: null }, ...DECISIONS];
// 'open' ist kein Eintrag in DECISIONS und hat darum keinen eigenen
// i18n-Key ueber decisionLabel() - Sonderfall hier statt in der Helferfamilie.
function filterOptionLabel(id) {
  return id === 'open' ? t('stateOpenLabel') : decisionLabel(id);
}

// wb-audit-Fund W3: der Zustandsfilter deckte nur eine Dimension ab - Filtern
// nach Quelle/Domain fehlte komplett, obwohl die Domain-Sprungleiste genau
// das (grob) konnte, bevor sie in Stufe "UI-Werkbank" entfernt wurde. Gleiches
// Muster wie hiddenStates: ausgeschlossene statt eingeschlossene Menge, damit
// eine neu auftauchende Domain automatisch sichtbar ist.
let hiddenDomains = new Set(JSON.parse(localStorage.getItem('hiddenDomains') || '[]'));

// Mehrfachauswahl in Sichten (Stufe E) - bewusst NICHT persistiert (anders
// als hiddenStates/hiddenDomains): eine Auswahl ist eine kurzlebige Aktion
// fuer den naechsten Klick auf "entscheiden/kopieren/exportieren", kein
// dauerhafter Filter. renderSelectionBar() raeumt Keys weg, die aus dem
// Bestand verschwunden sind (z.B. nach einer eigenen Entscheidung+Uebertragen).
let selectedKeys = new Set();

const appEl = document.getElementById('app');
const appMain = document.getElementById('app-main');
const traysEl = document.getElementById('trays');
const pendingSectionEl = document.getElementById('view-pending');
const pcSectionEl = document.getElementById('view-pc');
const snoozedSectionEl = document.getElementById('view-snoozed');
const missingSectionEl = document.getElementById('view-missing');
const metaInfo = document.getElementById('metaInfo');
const doneThisWeek = document.getElementById('doneThisWeek');
const toastsEl = document.getElementById('toasts');
const progressPanel = document.getElementById('progressPanel');
const progressLabel = document.getElementById('progressLabel');
const progressCount = document.getElementById('progressCount');
const progressFill = document.getElementById('progressFill');
const progressCancelBtn = document.getElementById('progressCancelBtn');
const confirmDialogEl = document.getElementById('confirmDialog');
const confirmDialogMessageEl = document.getElementById('confirmDialogMessage');
const confirmDialogInputEl = document.getElementById('confirmDialogInput');
const connectionStatusEl = document.getElementById('connectionStatus');
const keyboardHint = document.getElementById('keyboardHint');
const archiveResultsEl = document.getElementById('archiveResults');
const deviceSwitchEl = document.getElementById('deviceSwitch');
const deviceRenameBtn = document.getElementById('deviceRenameBtn');
let devicesCache = [];

const ARCHIVE_KIND_SWATCH = { archived: 'archive', dropped: 'drop', done: 'pc' };

// Ablagen statt gestapelter Kaesten: der Bestand durchlaeuft Stationen
// (sichten -> am PC erledigen -> Archiv), und man ist immer nur an genau
// einer davon dran. Vorher lagen alle gleichzeitig untereinander, wodurch die
// eigentliche Sichtliste unter den Falz rutschte. Die Zahl an der Ablage
// haelt sichtbar, wo Arbeit wartet, ohne sie einblenden zu muessen.
const VIEWS = [
  { id: 'triage', labelKey: 'viewTriage', accent: 'signal' },
  { id: 'pending', labelKey: 'viewPending', accent: 'pc' },
  { id: 'pc', labelKey: 'viewPc', accent: 'pc' },
  { id: 'snoozed', labelKey: 'viewSnoozed', accent: null },
  { id: 'missing', labelKey: 'viewMissing', accent: null },
  { id: 'archive', labelKey: 'viewArchive', accent: null },
];
let activeView = 'triage';

// Runde-3-Befund #9: Fehler-Toasts verschwanden bisher nach 4,2s (8s mit
// Aktions-Knopf) wie jeder andere Toast - zu kurz, um eine oft laengere oder
// technische Fehlermeldung zu lesen und zu entscheiden, was zu tun ist.
// Bleiben jetzt wie die ausdruecklich sticky markierten Warnungen stehen,
// mit demselben Schliessen-Knopf - der Nutzer entscheidet selbst, wann er
// fertig gelesen hat, statt dass die Meldung ihm wegverschwindet.
function toast(message, { error = false, sticky = false, actionLabel = null, onAction = null } = {}) {
  const stays = sticky || error;
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '') + (sticky ? ' warning' : '');
  el.textContent = message;
  if (stays) {
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.className = 'toast-close';
    closeBtn.addEventListener('click', () => el.remove());
    el.appendChild(closeBtn);
  }
  if (actionLabel && onAction) {
    const actionBtn = document.createElement('button');
    actionBtn.textContent = actionLabel;
    actionBtn.className = 'toast-action';
    actionBtn.addEventListener('click', () => { onAction(); el.remove(); });
    el.appendChild(actionBtn);
  }
  toastsEl.appendChild(el);
  // Toasts mit Aktion (z.B. "Rueckgaengig") bleiben laenger stehen - man muss
  // erst realisieren, dass die Bulk-Aktion daneben ging, bevor man reagieren kann.
  if (!stays) setTimeout(() => el.remove(), actionLabel ? 8000 : 4200);
}

// Runde-3-Befund #23: native confirm()/prompt() zeigen im --app-Fenster
// (keine Adressleiste) nur eine generische Systemzeile ohne Kontext, wer da
// fragt. Ersetzt beide durch denselben <dialog> mit Landed-Branding.
// method="dialog" + button-value tragen die Antwort automatisch ins
// dialog.returnValue - Esc/Backdrop-Klick zaehlen dadurch von selbst als
// Abbrechen (leeres returnValue), kein Sonderfall noetig.
function showConfirmDialog(message, { withInput = false, defaultValue = '' } = {}) {
  confirmDialogMessageEl.textContent = message;
  confirmDialogInputEl.hidden = !withInput;
  confirmDialogInputEl.value = defaultValue;
  return new Promise((resolve) => {
    confirmDialogEl.addEventListener(
      'close',
      () => {
        const ok = confirmDialogEl.returnValue === 'ok';
        resolve(withInput ? (ok ? confirmDialogInputEl.value : null) : ok);
      },
      { once: true }
    );
    confirmDialogEl.showModal();
    if (withInput) {
      confirmDialogInputEl.focus();
      confirmDialogInputEl.select();
    }
  });
}
// Cancel ist bewusst kein type="submit": bei zwei Submit-Buttons waehlt der
// Browser bei impliziter Formular-Uebermittlung (Enter im Textfeld) den
// ERSTEN im DOM als Default - das waere hier Abbrechen statt OK. Ein
// einzelner Submit-Button (OK) plus expliziter close() fuer Abbrechen
// haelt Enter beim erwarteten Bestaetigen.
document.getElementById('confirmDialogCancelBtn').addEventListener('click', () => confirmDialogEl.close('cancel'));

// fetch() wirft bei einem Netzwerk-/Verbindungsfehler (Server nicht
// erreichbar, abgestuerzt, Rechner im Schlaf) ein TypeError mit dem kryptischen
// "Failed to fetch" - im Unterschied zu unseren eigenen `throw new Error(...)`
// bei einer erhaltenen, aber fehlerhaften Serverantwort. Diese Unterscheidung
// macht daraus eine verstaendliche, umsetzbare Meldung statt Rohtext.
// Runde-3-Befund #5: ein per AbortController abgebrochener fetch() wirft
// eine DOMException/Error mit name 'AbortError' - davon unterscheiden, um
// dem Nutzer statt eines Fehler-Toasts (mit "Einrichtung pruefen"-Aktion,
// die hier fehl am Platz waere) eine neutrale Bestaetigung zu zeigen.
function isAbortError(e) {
  return e?.name === 'AbortError';
}

function friendlyFetchError(e) {
  if (e instanceof TypeError) {
    return t('errServerUnreachable');
  }
  return e.message;
}

// Haengt an bestehende Fehler-Toasts (scan(), runStep()/runTransfer()) - der
// groesste Aufwand-Nutzen-Punkt aus Stufe 3: jede reaktive Fehlermeldung
// wird zum Weg zur Loesung statt nach 4,2 Sekunden zu verschwinden.
async function checkAndOpenWizard() {
  try {
    const res = await fetch('/api/health', { method: 'POST' });
    const health = await res.json();
    openWizardAtHint(health.hint);
  } catch {
    openWizard(0);
  }
}

// Runde-3-Befund #5: onCancel optional, weil nicht jede Operation, die
// dieses Panel benutzt, abbrechbar ist (aktuell: runTransfer, bulkPcReturn -
// beide streamen via runStep()/AbortController). .onclick statt
// addEventListener: es gibt immer nur EINE laufende Operation gleichzeitig,
// jeder setProgress()-Aufruf derselben Operation liefert denselben Callback -
// ein Ersetzen statt Anhaengen verhindert doppelte Listener ueber die
// wiederholten Fortschritts-Updates hinweg.
function setProgress(active, { label, done = 0, total = 0, onCancel } = {}) {
  progressPanel.classList.toggle('active', active);
  if (!active) {
    progressCancelBtn.hidden = true;
    progressCancelBtn.onclick = null;
    return;
  }
  progressLabel.textContent = label;
  progressCount.textContent = `${done}/${total}`;
  progressFill.style.transform = `scaleX(${total ? done / total : 0})`;
  progressCancelBtn.hidden = !onCancel;
  progressCancelBtn.onclick = onCancel || null;
}

// Runde-3-Befund #21: der Zeitstempel war rein absolut ("19.8.2026,
// 10:53") - ob der Bestand von eben oder von vor einer Woche ist, musste
// man selbst nachrechnen. Relativer Zusatz nur ab einem Tag Abstand
// (formatAgoHint liefert fuer "heute" ohnehin nichts Zusaetzliches).
function formatMetaInfo(sourceCount, timestamp) {
  const date = new Date(timestamp).toLocaleString(dateLocale());
  return daysSince(timestamp) > 0
    ? t('metaInfoTextWithAge', { n: sourceCount, date, age: formatAgoHint(timestamp) })
    : t('metaInfoText', { n: sourceCount, date });
}

async function loadInventory() {
  const res = await fetch('/api/items');
  inventory = await res.json();
  render();
  showStoreAnomaly();
  // Am selben Ort wie der Bestand selbst neu laden: sonst zeigt der Erledigt-
  // Zaehler im Kontrollstreifen nach "Erledigt"/Archivieren/Verwerfen weiter
  // die Zahl vom Seitenstart, obwohl loadInventory() genau jetzt neue Daten
  // aus derselben Mutation abholt.
  loadScanMeta();
}

// Ein leerer Bestand und ein FEHLGESCHLAGENES Lesen sehen in der Oberflaeche
// sonst identisch aus - dreimal hat das den Eindruck erzeugt, alle "Am PC"-
// Links seien geloescht worden, obwohl sie unangetastet auf der Platte lagen.
// Deshalb hier ausdruecklich sagen, dass NICHTS verloren ist, statt eine
// harmlos wirkende leere Liste zu zeigen.
async function showStoreAnomaly() {
  let anomaly = null;
  try {
    anomaly = (await (await fetch('/api/store-status')).json()).anomaly;
  } catch {
    return; // Diagnose darf die Seite nie blockieren
  }
  const existing = document.getElementById('storeAnomaly');
  if (existing) existing.remove();
  if (!anomaly) return;

  const box = document.createElement('div');
  box.id = 'storeAnomaly';
  box.className = 'store-anomaly';
  // 'identity' = es liegt eine ANDERE Datenbank darunter als beim letzten
  // Start (Neustart hilft da nicht, der Pfad muss geklaert werden).
  // 'read' = dieselbe Datenbank, aber die Lesung kam leer zurueck.
  box.textContent = t(anomaly.kind === 'identity' ? 'storeSwitchedText' : 'storeAnomalyText');
  const detail = document.createElement('code');
  detail.textContent = anomaly.detail;
  box.appendChild(detail);
  document.querySelector('main').prepend(box);
}

// Zeigt den Zeitstempel des letzten Scans auch nach einem Seiten-Reload an -
// vorher stand hier "noch nicht eingelesen", obwohl bereits ein Bestand
// vorlag, weil metaInfo nur direkt nach einem frischen Scan gesetzt wurde.
async function loadScanMeta() {
  const res = await fetch('/api/scan-meta');
  const meta = await res.json();
  // codemouseai-Review auf PR #55: meta.sourceCount als Truthy-Check haette
  // einen Scan mit 0 gefundenen Tabs ignoriert und die Zeile auf dem Stand
  // eines fruehren, groesseren Scans stehen gelassen. timestamp entscheidet,
  // ob ueberhaupt schon gescannt wurde - sourceCount selbst darf 0 sein.
  metaInfo.textContent = meta.timestamp ? formatMetaInfo(meta.sourceCount ?? 0, meta.timestamp) : t('metaInfoInitial');
  doneThisWeek.textContent = meta.recentDoneCount ? t('doneThisWeek', { n: meta.recentDoneCount }) : '';
}

async function scan() {
  const scanBtn = document.getElementById('scanBtn');
  scanBtn.disabled = true;
  scanBtn.textContent = t('scanBtnLoading');
  try {
    const res = await fetch('/api/scan', { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error || t('unknownError'));
    const data = await res.json();
    // Runde-3-Befund #7: der Toast sagte bisher nur die Gesamtzahl, nie den
    // Zuwachs - bei 300 Tabs war ohne das faktisch unauffindbar, was ein
    // Scan tatsaechlich Neues gebracht hat.
    toast(
      data.newCount
        ? t('scanToastWithNew', { count: data.count, sourceCount: data.sourceCount, newCount: data.newCount })
        : t('scanToast', { count: data.count, sourceCount: data.sourceCount })
    );
    if (data.warning) toast(data.warning, { sticky: true });
    metaInfo.textContent = formatMetaInfo(data.sourceCount, new Date().toISOString());
    await loadInventory();
  } catch (e) {
    toast(t('scanFailedPrefix') + friendlyFetchError(e), {
      error: true,
      actionLabel: t('checkSetupAction'),
      onAction: checkAndOpenWizard,
    });
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = t('scanBtn');
  }
}

// "Aeltestes zuerst" sortiert NICHT nur, welche Domain-Gruppe zuerst kommt -
// bei der real gemessenen Verteilung (github.com allein 67 von 283 "Am PC"-
// Eintraegen) waere das wertlos, wenn die 67 Zeilen innerhalb der Gruppe
// weiterhin in Scan-Reihenfolge liegen. stateChangedAt statt firstSeen: es
// geht um "wie lange liegt die Entscheidung schon", nicht um das Alter des
// Tabs selbst (firstSeen ist bei allem vor der SQLite-Migration ohnehin auf
// einen einzigen Zeitpunkt eingefroren, siehe lib/items.mjs).
function byAgeAscending(a, b) {
  return new Date(a.stateChangedAt) - new Date(b.stateChangedAt);
}

function groupByDomain(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.domain)) groups.set(item.domain, []);
    groups.get(item.domain).push(item);
  }
  const entries = [...groups.entries()];
  if (domainSortMode === 'age') {
    for (const [, group] of entries) group.sort(byAgeAscending);
    return entries.sort((a, b) => byAgeAscending(a[1][0], b[1][0]));
  }
  return domainSortMode === 'alpha'
    ? entries.sort((a, b) => a[0].localeCompare(b[0]))
    : entries.sort((a, b) => b[1].length - a[1].length);
}

function matchesFilter(item) {
  if (!filterText) return true;
  const t = filterText.toLowerCase();
  return item.title.toLowerCase().includes(t) || item.url.toLowerCase().includes(t);
}

function matchesStateFilter(item) {
  return !hiddenStates.has(item.state);
}

function matchesDomainFilter(item) {
  return !hiddenDomains.has(item.domain);
}

// Der Text-/Zustands-/Domainfilter galt bisher nur in Sichten - Ablagen wie
// "Am PC" wachsen im echten Betrieb aber genauso gross (270+ Eintraege ohne
// jede Suche waren nicht mehr bedienbar). Dieselbe Filterkette jetzt auch in
// den anderen Ablagen, sichtbare Zaehler (renderSectionHead) bleiben aber die
// ungefilterte Trayaufe - nur die Liste darunter schrumpft.
function visibleItems(items) {
  return items.filter(matchesFilter).filter(matchesStateFilter).filter(matchesDomainFilter);
}

// Leichte Domain-Gruppierung fuer Ablagen ohne Mehrfachauswahl/Sammelent-
// scheidung (die Entscheidung ist hier schon gefallen) - Kopfzeile ohne
// Checkbox/Gruppenaktionen, sonst dieselbe Optik wie die Sichten-Gruppierung.
// Rafter-Fund: `domain` stammt aus einer gescannten Tab-URL (store.safeDomain
// liefert unveraendert new URL(url).hostname) - eine Tab-URL mit interner/
// Loopback-Adresse (z.B. ein Router- oder localhost-Tab am Handy) wuerde
// sonst ungeprueft zum Favicon-Fetch-Ziel: `<img src>` laesst den Browser
// selbst gegen 127.0.0.1/private IPs/IPv6-Literale anfragen (SSRF-shaped,
// Erfolg/Fehlschlag ueber das load/error-Event beobachtbar). Nur echte
// Internet-Hostnamen (mit Punkt, kein IP-Literal) bekommen ueberhaupt eine
// Favicon-Anfrage - Anzeige/Gruppierung nach Domain bleibt fuer alle
// unveraendert, nur das <img src> wird nicht gesetzt.
function isSafeFaviconDomain(domain) {
  if (!domain || !domain.includes('.')) return false; // localhost, einzelnes Label
  if (domain.includes(':')) return false; // IPv6-Literal (echte Hostnamen enthalten nie ':')
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return false; // IPv4-Literal
  if (/\.(local|internal|lan|home|localdomain)$/i.test(domain)) return false; // mDNS/private TLDs
  return true;
}

// selectable: bewusst dieselbe Checkbox+selectedKeys-Mechanik wie in der
// eigenstaendigen Sichten-Gruppierung (render() weiter unten), NICHT
// dupliziert, sondern hier optional zugeschaltet - vermeidet eine zweite
// Auswahl-Implementierung fuer denselben Zweck. Nur "Am PC" nutzt das
// bisher; missing/archive rufen weiterhin ohne Optionen auf, unveraendert.
// Runde-3-Befund #19: Mehrfachauswahl gab es bisher nur PRO Domain-Gruppe,
// kein "alles auswaehlen" fuer die ganze sichtbare Liste - bei vielen
// kleinen Gruppen (106 von 132 Domains im echten Bestand haben nur einen
// Tab) waere das viele Einzelklicks fuer eine Sammelaktion ueber mehrere
// Domains hinweg gewesen. Gleiches Dreizustands-Muster wie die
// Gruppen-Checkbox in renderDomainGroup, nur ueber ALLE uebergebenen Keys.
function makeSelectAllCheckbox(keys) {
  const selectedCount = keys.filter((k) => selectedKeys.has(k)).length;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'select-all-visible';
  cb.title = t('selectAllVisibleTitle');
  cb.checked = selectedCount > 0 && selectedCount === keys.length;
  cb.indeterminate = selectedCount > 0 && selectedCount < keys.length;
  cb.addEventListener('change', () => {
    for (const k of keys) (cb.checked ? selectedKeys.add(k) : selectedKeys.delete(k));
    render();
  });
  return cb;
}

function renderDomainGroup(container, domain, items, { selectable = false } = {}) {
  const group = document.createElement('div');
  group.className = 'domain-group' + (collapsedDomains.has(domain) ? ' collapsed' : '');

  const header = document.createElement('div');
  header.className = 'domain-header';

  if (selectable) {
    const groupKeys = items.map((i) => i.normalizedUrl);
    const selectedInGroup = groupKeys.filter((k) => selectedKeys.has(k)).length;
    const groupCb = document.createElement('input');
    groupCb.type = 'checkbox';
    groupCb.className = 'group-select';
    groupCb.title = t('selectGroupTitle');
    groupCb.checked = selectedInGroup > 0 && selectedInGroup === groupKeys.length;
    groupCb.indeterminate = selectedInGroup > 0 && selectedInGroup < groupKeys.length;
    groupCb.addEventListener('click', (e) => e.stopPropagation());
    groupCb.addEventListener('change', () => {
      for (const k of groupKeys) (groupCb.checked ? selectedKeys.add(k) : selectedKeys.delete(k));
      render();
    });
    header.appendChild(groupCb);
  }

  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.textContent = '▾';
  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  if (isSafeFaviconDomain(domain)) favicon.src = `https://${domain}/favicon.ico`;
  favicon.alt = '';
  favicon.addEventListener('error', () => favicon.remove());
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = domain;
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = String(items.length);
  header.append(chevron, favicon, name, count);
  header.addEventListener('click', () => {
    if (collapsedDomains.has(domain)) collapsedDomains.delete(domain);
    else collapsedDomains.add(domain);
    render();
  });
  group.appendChild(header);

  const rows = document.createElement('div');
  rows.className = 'domain-rows flat-list';
  group.appendChild(rows);
  container.appendChild(group);
  return rows;
}

// Filter matched nichts (Tray selbst hat Eintraege, aber Text-/Zustands-/
// Domainfilter blendet gerade alles aus) - dieselbe Botschaft wie in Sichten.
// Runde-3-Befund #15: dieser Leerzustand nannte in allen Nebenablagen (Am
// PC/Wiedervorlage/Verschwunden/Vorgemerkt) denselben generischen Text,
// unabhaengig davon, WAS gerade filtert - Sichten unterschied das schon
// (siehe render() weiter unten), hier fehlte dieselbe Unterscheidung nur.
function renderNoFilterMatch(container) {
  const body = filterText.trim() ? t('noMatchFilterTextBody', { filterText }) : t('noMatchFilterStateBody');
  renderEmptyState(container, t('noFilterMatchTitle'), body);
}

// Ein pc-Item, das schon geschlossen wurde (closedAt gesetzt), lebt nur noch
// in der "Am PC erledigen"-Liste - vorher (noch ein lebender Tab) verhaelt es
// sich wie jede andere Vormerkung und bleibt in der normalen Liste.
function isPcDone(item) {
  return item.state === 'pc' && item.closedAt;
}

async function postStates(entries) {
  const res = await fetch('/api/decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) throw new Error((await res.json()).error || t('saveFailedGeneric'));
}

// Entscheidungen werden ueber normalizedUrl verknuepft, nicht ueber die CDP-
// Target-ID: die ist nur innerhalb einer laufenden Chrome-Instanz stabil und
// existiert fuer "Am PC"/"Nicht mehr auffindbar"-Items oft gar nicht mehr.
// normalizedUrl bleibt dauerhaft gleich - das ist jetzt auch der Schluessel,
// unter dem der Server jedes Item fuehrt.
async function setState(key, state) {
  const item = inventory.find((i) => i.normalizedUrl === key);
  if (!item) return;
  const previous = item.state;
  const next = item.state === state ? null : state;
  item.state = next || 'open';
  renderSortStrip();
  renderRowState(item);
  try {
    await postStates([[item.normalizedUrl, next]]);
  } catch (e) {
    item.state = previous; // Server hat es nicht uebernommen - lokal zuruecksetzen
    renderSortStrip();
    renderRowState(item);
    toast(t('saveErrorPrefix') + friendlyFetchError(e), { error: true });
  }
}

async function undoDomainDecision(previousStates) {
  const entries = previousStates.map(([item, prev]) => {
    item.state = prev;
    return [item.normalizedUrl, prev];
  });
  render();
  try {
    await postStates(entries);
  } catch (e) {
    toast(t('undoFailedPrefix') + friendlyFetchError(e), { error: true });
  }
}

async function setDomainDecision(items, state) {
  const previousStates = items.map((item) => [item, item.state]);
  const entries = items.map((item) => {
    item.state = state;
    return [item.normalizedUrl, state];
  });
  render();
  try {
    await postStates(entries);
    toast(t('bulkDecisionToast', { n: items.length, label: decisionLabel(state) }), {
      actionLabel: t('undoAction'),
      onAction: () => undoDomainDecision(previousStates),
    });
  } catch (e) {
    for (const [item, prev] of previousStates) item.state = prev;
    toast(t('saveErrorPrefix') + friendlyFetchError(e), { error: true });
    render();
  }
}

// Sammelentscheidung fuer die Mehrfachauswahl - dieselbe Mechanik wie
// setDomainDecision (Undo-Toast inklusive), nur mit der Auswahl statt einer
// Domain-Gruppe als Eingabe. Auswahl leert sich danach: sie ist eine
// Aktionsvorbereitung, kein dauerhafter Filter.
async function decideSelection(state) {
  const items = inventory.filter((i) => selectedKeys.has(i.normalizedUrl));
  if (!items.length) return;
  await setDomainDecision(items, state);
  selectedKeys.clear();
  render();
}

async function copyUrls(items) {
  if (!items.length) return;
  try {
    await navigator.clipboard.writeText(items.map((i) => i.url).join('\n'));
    toast(items.length === 1 ? t('copyLinkSingle') : t('copyLinkPlural', { n: items.length }));
  } catch (e) {
    toast(t('copyFailedPrefix') + friendlyFetchError(e), { error: true });
  }
}

function makeCopyButton(item) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy-btn';
  btn.textContent = '⧉';
  btn.title = t('copyBtnTitle');
  btn.addEventListener('click', (e) => { e.stopPropagation(); copyUrls([item]); });
  return btn;
}

// Blob-URL statt Endpunkt: die Daten liegen schon im Browser (inventory),
// ein Server-Roundtrip fuer eine reine Textumformatierung waere unnoetig.
function downloadFile(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Gleiche Gliederung (## Domain (n), - [Titel](URL)) wie das fruehere
// archive.md-Format (siehe tools/migrate-v2.mjs parseArchiveMd) - vertraute
// Form statt eines neu erfundenen Layouts.
function toMarkdown(items) {
  const date = formatYmdDe(localYmd());
  const heading = items.length === 1 ? t('exportHeadingOne', { date }) : t('exportHeadingMany', { date, n: items.length });
  const lines = [heading, ''];
  for (const [domain, group] of groupByDomain(items)) {
    lines.push(`## ${domain} (${group.length})`);
    for (const item of group) lines.push(`- [${item.title}](${item.url})`);
    lines.push('');
  }
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Netscape-Bookmark-Format (seit 1996 unveraendert) - Chrome, Firefox und
// Edge importieren es alle direkt ueber "Lesezeichen importieren".
function toBookmarksHtml(items) {
  const addDate = Math.floor(Date.now() / 1000);
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    ...items.map((i) => `  <DT><A HREF="${escapeHtml(i.url)}" ADD_DATE="${addDate}">${escapeHtml(i.title)}</A>`),
    '</DL><p>',
  ];
  return lines.join('\n');
}

function exportItems(items, format) {
  if (!items.length) {
    toast(t('nothingToExport'), { error: true });
    return;
  }
  const stamp = localYmd();
  if (format === 'markdown') downloadFile(`landed-export-${stamp}.md`, toMarkdown(items), 'text/markdown;charset=utf-8');
  else downloadFile(`landed-export-${stamp}.html`, toBookmarksHtml(items), 'text/html;charset=utf-8');
  toast(items.length === 1 ? t('exportedOne') : t('exportedMany', { n: items.length }));
}

// Jeder Link verlaesst die App ueber den Server, nie ueber window.open oder
// einen normalen Klick im App-Fenster. Grund: das Fenster laeuft seit 0.3.6 in
// einem eigenen Browserprofil (noetig fuer das Taskleisten-Icon, siehe
// lib/launcher.mjs). Ein Klick darin wuerde die Seite in genau diesem Profil
// oeffnen - ohne die Anmeldungen des Nutzers, ueberall Login-Seiten. Der
// Server startet stattdessen den Alltagsbrowser.
// Runde-3-Befund #2: der Server deckelt bei MAX_OPEN_URLS=50 (server.mjs) -
// bewusst, weil jeder Eintrag einen eigenen Browserprozess/Tab startet, kein
// Zufallswert. Bei mehr als 50 sichtbaren Eintraegen (im echten Bestand die
// Regel, nicht die Ausnahme: 283 in "Am PC") lehnte der Server bisher die
// GESAMTE Anfrage ab - der Knopf versprach "Alle N", oeffnete aber keinen
// einzigen. In Chargen von OPEN_EXTERNAL_BATCH_SIZE aufteilen haelt das
// Limit ein UND das Versprechen "alle" gleichzeitig ein.
const OPEN_EXTERNAL_BATCH_SIZE = 50;

async function openExternal(urls) {
  if (!urls.length) return;
  try {
    for (let i = 0; i < urls.length; i += OPEN_EXTERNAL_BATCH_SIZE) {
      const batch = urls.slice(i, i + OPEN_EXTERNAL_BATCH_SIZE);
      const res = await fetch('/api/open-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: batch }),
      });
      if (!res.ok) throw new Error((await res.json()).error || t('genericFailed'));
    }
  } catch (e) {
    toast(t('openExternalFailedPrefix') + friendlyFetchError(e), { error: true });
  }
}

// Gegenstueck zu "Auf Handy uebertragen" (oeffnet Links AM HANDY): oeffnet
// dieselben URLs stattdessen hier im PC-Browser - fuer die PC-Arbeitsliste,
// wo per Definition kein Handy-Tab mehr existiert. Fragt nach wie
// bulkPcReturn - auf einen Schlag mehrere Dutzend Browserfenster oeffnen ist
// genauso eine folgenreiche Aktion wie mehrere Tabs am Telefon zu oeffnen.
async function openAllInBrowser(items) {
  if (!(await showConfirmDialog(t('openAllInBrowserConfirm', { n: items.length })))) return;
  openExternal(items.map((item) => item.url));
}

// Klicks auf Titel-Links abfangen, statt an jeder Stelle einzeln umzubauen -
// es gibt mehrere Renderer, die Links erzeugen, und ein vergessener waere
// genau der eine, der wieder im falschen Profil landet. Auch mit Modifier
// abfangen: "im Hintergrund oeffnen" wuerde sonst ebenfalls im App-Profil
// landen. Mittelklick loest kein click-Ereignis aus, daher zusaetzlich
// auxclick.
function routeLinkClicksToBrowser(event) {
  const link = event.target.closest?.('a[target="_blank"]');
  if (!link || !link.href) return;
  if (event.type === 'auxclick' && event.button !== 1) return;
  event.preventDefault();
  openExternal([link.href]);
}
document.addEventListener('click', routeLinkClicksToBrowser);
document.addEventListener('auxclick', routeLinkClicksToBrowser);

// Sammel-"Erledigt" fuer die Auswahl in "Am PC" - derselbe Serveraufruf wie
// der Einzelknopf (pcDone), aber EIN loadInventory() am Ende statt eines pro
// Item. Bei 67 Eintraegen in einer einzigen Domain-Gruppe (real gemessen,
// github.com) waere ein Reload pro Klick unnoetig langsam gewesen.
//
// Codemouse-Fund auf PR #53, bestaetigt: Promise.all bricht beim ERSTEN
// Fehlschlag sofort ab (der laesst try/finally sofort weiterlaufen), aber
// die uebrigen, noch laufenden fetch()-Aufrufe werden dadurch nicht
// abgebrochen - sie laufen im Hintergrund weiter. loadInventory() im
// finally-Block konnte dadurch vor deren Abschluss greifen und einen
// unvollstaendigen Zwischenstand laden. Promise.allSettled wartet auf ALLE
// Aufrufe, bevor irgendetwas weitergeht - kein Wettlauf mehr moeglich.
async function bulkPcDone(items) {
  if (!items.length) return;
  try {
    const results = await Promise.allSettled(
      items.map(async (item) => {
        await flushNoteSave(item.normalizedUrl);
        const res = await fetch('/api/pc/done', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ normalizedUrl: item.normalizedUrl }),
        });
        if (!res.ok) throw new Error((await res.json()).error || t('genericFailed'));
      })
    );
    // Nicht nur zaehlen, sondern den ERSTEN echten Fehlschlag weiterreichen -
    // Codemouse-Fund auf PR #54, bestaetigt: eine synthetische generische
    // Fehlermeldung hier haette die konkrete Serverantwort verschluckt (z.B.
    // "Item nicht in der PC-Arbeitsliste gefunden."), die vorher (mit
    // Promise.all) im catch-Block ankam.
    const firstRejected = results.find((r) => r.status === 'rejected');
    if (firstRejected) throw firstRejected.reason instanceof Error ? firstRejected.reason : new Error(t('genericFailed'));
    selectedKeys.clear();
    const urls = items.map((i) => i.normalizedUrl);
    toast(t('bulkDoneToast', { n: items.length }), { actionLabel: t('undoAction'), onAction: () => undoPcDone(urls) });
  } catch (e) {
    toast(t('errorPrefix') + friendlyFetchError(e), { error: true });
  } finally {
    // Nachladen statt lokal zu raten: bei Promise.allSettled koennen
    // einzelne Aufrufe fehlgeschlagen sein, waehrend andere durchgingen -
    // der Serverstand ist die einzige verlaessliche Quelle fuer "was
    // wirklich passiert ist". Laeuft jetzt garantiert erst NACH allen
    // Aufrufen, nicht mehr nach dem ersten Fehlschlag.
    await loadInventory();
  }
}

// Sammel-Wiedervorlage: gleiche Semantik wie setSnooze() fuer ein Einzelitem,
// aber ohne dessen Render-pro-Aufruf. "Am PC"-Items sind bereits state 'pc' -
// anders als bei setSnooze() fuer Sichten-Items gibt es hier keinen
// 'open'->'pc'-Uebergang zu beachten.
//
// Gleicher Codemouse-Fund wie bei bulkPcDone (PR #53) - Promise.allSettled
// statt Promise.all, aus demselben Grund: sonst kann loadInventory() vor
// dem Abschluss noch laufender Aufrufe greifen.
async function bulkSetSnooze(items, value) {
  if (!items.length) return;
  try {
    const results = await Promise.allSettled(
      items.map(async (item) => {
        const res = await fetch('/api/snooze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ normalizedUrl: item.normalizedUrl, snoozeUntil: value }),
        });
        if (!res.ok) throw new Error((await res.json()).error || t('genericFailed'));
      })
    );
    // Nicht nur zaehlen, sondern den ERSTEN echten Fehlschlag weiterreichen -
    // Codemouse-Fund auf PR #54, bestaetigt: eine synthetische generische
    // Fehlermeldung hier haette die konkrete Serverantwort verschluckt (z.B.
    // "Item nicht in der PC-Arbeitsliste gefunden."), die vorher (mit
    // Promise.all) im catch-Block ankam.
    const firstRejected = results.find((r) => r.status === 'rejected');
    if (firstRejected) throw firstRejected.reason instanceof Error ? firstRejected.reason : new Error(t('genericFailed'));
    selectedKeys.clear();
    toast(t('bulkSnoozeToast', { n: items.length }));
  } catch (e) {
    toast(t('snoozeSaveFailedPrefix') + friendlyFetchError(e), { error: true });
  } finally {
    await loadInventory();
  }
}

// Sammel-"Zurueck aufs Handy": ANDERS als die beiden obigen Aktionen bewusst
// NICHT parallelisiert - das hier ist echte Geraete-I/O (ein Tab pro URL
// live am Handy oeffnen), keine reine Datenbank-Mutation. adb.mjs haelt
// ohnehin nur eine ADB-Session gleichzeitig; parallele Einzelaufrufe wuerden
// sich gegenseitig um dieselbe Session streiten. Der Server buendelt die
// ganze Auswahl in EINE Session (cdp.openMany), gleiches Muster wie
// restoreHandler fuer "Auf Handy uebertragen".
// Runde-3-Befund #20: der Server lehnte mehr als MAX_BULK_RETURN Tabs erst
// NACH dem Bestaetigungsdialog ab (server.mjs) - "127 Tabs wieder aufs
// Telefon oeffnen?" bestaetigt, und erst danach ein Fehler-Toast mit der
// eigentlichen Grenze. Gleicher Wert wie server.mjs MAX_BULK_RETURN, gleiches
// Duplizierungsmuster wie OPEN_EXTERNAL_BATCH_SIZE (Runde-3-Befund #2).
const MAX_BULK_RETURN = 200;

async function bulkPcReturn(items) {
  if (!items.length) return;
  if (items.length > MAX_BULK_RETURN) {
    toast(t('bulkReturnTooManyToast', { n: items.length, max: MAX_BULK_RETURN }), { error: true });
    return;
  }
  if (!(await showConfirmDialog(t('bulkReturnConfirm', { n: items.length })))) return;
  const controller = new AbortController();
  setProgress(true, { label: t('openingTabsLabel'), done: 0, total: 0, onCancel: () => controller.abort() });
  try {
    const result = await runStep(
      '/api/pc/bulk-return',
      t('openingTabsLabel'),
      { normalizedUrls: items.map((i) => i.normalizedUrl) },
      { signal: controller.signal, onCancel: () => controller.abort() }
    );
    setProgress(false);
    const opened = result.total - result.failed;
    toast(
      t('bulkReturnedToast', { n: opened }) + (result.failed ? t('failedSuffixText', { n: result.failed }) : ''),
      { error: result.failed > 0 && opened === 0 }
    );
    selectedKeys.clear();
  } catch (e) {
    setProgress(false);
    if (isAbortError(e)) {
      toast(t('operationCancelledToast'));
    } else {
      toast(t('errorPrefix') + friendlyFetchError(e), {
        error: true,
        actionLabel: t('checkSetupAction'),
        onAction: checkAndOpenWizard,
      });
    }
  } finally {
    await loadInventory();
  }
}

// Eigenes, schlankeres Menue statt openSnoozeMenu() wiederzuverwenden: das
// dortige "revert zu Knopf"-Verhalten gilt fuer EIN Item mit dauerhaftem
// Slot in der Zeile - hier baut renderSelectionBar() bei jedem Klick ohnehin
// alles neu, ein Revert-Pfad haette keinen Nutzen. Gleiche Schnellwahl-
// Optionen (snoozeQuickOptions), gleiches Aussen-Klick/Escape-Aufraeumen.
function openBulkSnoozeMenu(slot, items) {
  const menu = document.createElement('div');
  menu.className = 'snooze-menu';

  const cleanup = () => {
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onEscape, true);
  };
  const revert = () => { cleanup(); render(); };
  const onOutside = (e) => { if (!menu.contains(e.target)) revert(); };
  const onEscape = (e) => { if (e.key === 'Escape') revert(); };

  const addOption = (label, onPick, className) => {
    const opt = document.createElement('button');
    opt.type = 'button';
    if (className) opt.className = className;
    opt.textContent = label;
    opt.addEventListener('click', (e) => { e.stopPropagation(); cleanup(); onPick(); });
    menu.appendChild(opt);
  };

  for (const { label, value } of snoozeQuickOptions(localYmd())) {
    addOption(label, () => bulkSetSnooze(items, value));
  }
  addOption(t('snoozePickDate'), () => {
    cleanup();
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'snooze-input';
    input.title = t('snoozeDateInputTitle');
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', (e) => { e.stopPropagation(); bulkSetSnooze(items, input.value); });
    slot.replaceChildren(input);
    input.focus();
  });

  document.addEventListener('click', onOutside, true);
  document.addEventListener('keydown', onEscape, true);
  slot.replaceChildren(menu);
}

// Knopfleiste fuer die Mehrfachauswahl in "Am PC" - Gegenstueck zu den vier
// DECISIONS-Knoepfen in Sichten, aber mit den Aktionen, die dort etwas
// bewirken: die Entscheidung ist bereits gefallen, "Erledigt"/"Zurueck aufs
// Handy"/"Wiedervorlage" sind die verbleibenden Schritte (siehe renderPcView
// fuer die Einzelitem-Entsprechung).
function makePcSelectionActions(items) {
  const wrap = document.createElement('div');
  wrap.className = 'decision-buttons';

  const doneBtn = document.createElement('button');
  doneBtn.textContent = t('doneBtn');
  doneBtn.title = t('bulkDoneTitle', { n: items.length });
  doneBtn.addEventListener('click', () => bulkPcDone(items));
  wrap.appendChild(doneBtn);

  const returnBtn = document.createElement('button');
  returnBtn.textContent = t('returnToPhoneBtn');
  returnBtn.title = t('bulkReturnTitle', { n: items.length });
  returnBtn.addEventListener('click', () => bulkPcReturn(items));
  wrap.appendChild(returnBtn);

  const snoozeSlot = document.createElement('div');
  snoozeSlot.className = 'snooze-slot';
  const snoozeBtn = document.createElement('button');
  snoozeBtn.type = 'button';
  snoozeBtn.className = 'snooze-btn';
  snoozeBtn.textContent = '⏲';
  snoozeBtn.title = t('bulkSnoozeTitle', { n: items.length });
  snoozeBtn.addEventListener('click', (e) => { e.stopPropagation(); openBulkSnoozeMenu(snoozeSlot, items); });
  snoozeSlot.appendChild(snoozeBtn);
  wrap.appendChild(snoozeSlot);

  return wrap;
}

// Erscheint nur, wenn etwas ausgewaehlt ist - Sammelaktionen fuer die
// Mehrfachauswahl (siehe .row-select/.group-select in render()). Auswahl ist
// zustaendig-uebergreifend gedacht, aber die sinnvollen AKTIONEN sind es
// nicht: in Sichten ist "entscheiden" die Aktion, in "Am PC" ist bereits
// entschieden - dort sind "Erledigt"/"Zurueck aufs Handy"/"Wiedervorlage" die
// Aktionen, die etwas bewirken. setView() leert die Auswahl bei jedem
// Ablagenwechsel, eine gemischte Auswahl ueber beide Ablagen hinweg kann
// also nicht entstehen.
function renderSelectionBar() {
  const bar = document.getElementById('selectionBar');
  if (!bar) return;
  // Aufraeumen: Keys von Items, die den Bestand verlassen haben (archiviert,
  // verworfen und uebertragen, o.ae.), sonst zaehlt die Leiste sie ewig mit.
  for (const key of selectedKeys) {
    if (!inventory.some((i) => i.normalizedUrl === key)) selectedKeys.delete(key);
  }
  bar.innerHTML = '';
  bar.hidden = selectedKeys.size === 0 || (activeView !== 'triage' && activeView !== 'pc');
  if (bar.hidden) return;

  const selectedItems = inventory.filter((i) => selectedKeys.has(i.normalizedUrl));

  const count = document.createElement('span');
  count.className = 'selection-count';
  count.textContent = t('selectedCount', { n: selectedItems.length });
  bar.appendChild(count);

  if (activeView === 'pc') {
    bar.appendChild(makePcSelectionActions(selectedItems));
  } else {
    const decisions = document.createElement('div');
    decisions.className = 'decision-buttons';
    for (const d of DECISIONS) {
      const btn = document.createElement('button');
      btn.innerHTML = d.icon;
      btn.title = `${d.key.toUpperCase()} — ${decisionLabel(d.id)} — ${decisionOutcome(d.id)}`;
      btn.setAttribute('aria-label', decisionLabel(d.id));
      btn.className = d.id;
      btn.addEventListener('click', () => decideSelection(d.id));
      decisions.appendChild(btn);
    }
    bar.appendChild(decisions);
  }

  const copyBtn = document.createElement('button');
  copyBtn.textContent = t('copyBtn');
  copyBtn.addEventListener('click', () => copyUrls(selectedItems));
  bar.appendChild(copyBtn);

  const mdBtn = document.createElement('button');
  mdBtn.textContent = t('asMarkdownBtn');
  mdBtn.addEventListener('click', () => exportItems(selectedItems, 'markdown'));
  bar.appendChild(mdBtn);

  const bookmarksBtn = document.createElement('button');
  bookmarksBtn.textContent = t('asBookmarksBtn');
  bookmarksBtn.addEventListener('click', () => exportItems(selectedItems, 'bookmarks'));
  bar.appendChild(bookmarksBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'ghost-btn';
  clearBtn.textContent = t('clearSelectionBtn');
  clearBtn.addEventListener('click', () => { selectedKeys.clear(); render(); });
  bar.appendChild(clearBtn);
}

// Runde-3-Befund #3/#4: "Erledigt" loeschte bisher sofort und ohne jede
// Rueckmeldung - kein Toast, kein Rueckgaengig. "Zurueck aufs Telefon"
// (harmlos, oeffnet nur erneut einen Tab) fragte dagegen vorher nach - die
// Rueckfragen sassen an der falschen Stelle. Jetzt: kein zusaetzliches
// confirm() (das waere bei der Haeufigkeit dieser Aktion nur Reibung ohne
// Wert - 283 von 295 Eintraegen im echten Bestand liegen in "Am PC"),
// stattdessen ein Toast mit Rueckgaengig-Aktion, gleiches Muster wie
// setDomainDecision/decideSelection.
async function undoPcDone(normalizedUrls) {
  try {
    const results = await Promise.allSettled(
      normalizedUrls.map((normalizedUrl) =>
        fetch('/api/pc/undo-done', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ normalizedUrl }),
        }).then(async (res) => {
          if (!res.ok) throw new Error((await res.json()).error || t('genericFailed'));
        })
      )
    );
    const firstRejected = results.find((r) => r.status === 'rejected');
    if (firstRejected) throw firstRejected.reason instanceof Error ? firstRejected.reason : new Error(t('genericFailed'));
  } catch (e) {
    toast(t('undoFailedPrefix') + friendlyFetchError(e), { error: true });
  } finally {
    await loadInventory();
  }
}

async function pcDone(item) {
  await flushNoteSave(item.normalizedUrl);
  try {
    const res = await fetch('/api/pc/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: item.normalizedUrl }),
    });
    if (!res.ok) throw new Error((await res.json()).error || t('genericFailed'));
    toast(t('pcDoneToast'), { actionLabel: t('undoAction'), onAction: () => undoPcDone([item.normalizedUrl]) });
    await loadInventory();
  } catch (e) {
    toast(t('errorPrefix') + friendlyFetchError(e), { error: true });
  }
}

async function pcReturn(item) {
  await flushNoteSave(item.normalizedUrl);
  try {
    const res = await fetch('/api/pc/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: item.normalizedUrl }),
    });
    if (!res.ok) throw new Error((await res.json()).error || t('genericFailed'));
    toast(t('reopenedOnPhone'));
    await loadInventory();
  } catch (e) {
    toast(t('errorPrefix') + friendlyFetchError(e), { error: true });
  }
}

async function saveNote(item, note) {
  item.note = note || null; // optimistisch, wie setState/setSnooze - kein render() noetig
  try {
    const res = await fetch('/api/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: item.normalizedUrl, note }),
    });
    if (!res.ok) throw new Error((await res.json()).error || t('genericFailed'));
  } catch (e) {
    toast(t('noteSaveFailedPrefix') + friendlyFetchError(e), { error: true });
  }
}

// codemouseai-Review-Folgefund: saveNote feuerte bisher nur auf 'change'
// (Feld verlassen) - wechselte man die Ablage waehrend des Tippens (die
// Zeile wird bei jedem render() neu gebaut), war die Notiz weg, ohne dass
// je gespeichert wurde. Ein Timer pro Item statt einem globalen, sonst
// wuerde das Tippen in einer zweiten Notiz den Speicher-Timer der ersten
// canceln. Map haelt zusaetzlich item+note fest (nicht nur den Timer),
// damit flushNoteSave() unten sofort speichern kann, ohne auf den DOM
// angewiesen zu sein.
const noteSaveTimers = new Map();
function scheduleSaveNote(item, note) {
  clearTimeout(noteSaveTimers.get(item.normalizedUrl)?.timer);
  const timer = setTimeout(() => {
    noteSaveTimers.delete(item.normalizedUrl);
    saveNote(item, note);
  }, 500);
  noteSaveTimers.set(item.normalizedUrl, { timer, item, note });
}

// codemouseai-Review auf PR #18: eine noch ausstehende, per Debounce
// zurueckgehaltene Notiz kam nie an, wenn direkt danach eine Aktion lief,
// die das Item aus dem Store nimmt oder inventory komplett ersetzt
// (pcDone/pcReturn -> loadInventory()) - der 500ms-Timer feuerte dann erst,
// nachdem das Item schon archiviert bzw. neu geladen war. Vor solchen
// Uebergaengen wird eine noch offene Notiz darum sofort gespeichert.
async function flushNoteSave(normalizedUrl) {
  const pending = noteSaveTimers.get(normalizedUrl);
  if (!pending) return;
  clearTimeout(pending.timer);
  noteSaveTimers.delete(normalizedUrl);
  await saveNote(pending.item, pending.note);
}

// snoozeUntil ist ein reiner YYYY-MM-DD-String aus <input type=date> - ein
// leerer Wert (Feld geleert bzw. "Jetzt anzeigen") setzt zurueck auf null.
//
// Zustandsmodell (siehe Plan): Wiedervorlage ist kein eigener state, sondern
// "Nur PC" + Datum. Ein Datum bringt den state 'pc' nur dann mit, wenn das
// Item noch UNENTSCHIEDEN ist ('open') - sonst haette man ein Datum ohne
// zugehoerige Aufgabenliste, und der Tab am Handy schliesst nie. Ist schon
// entschieden (state 'pc' oder 'keep'), bleibt genau das unangetastet - das
// ist "Vertagen": eine bestehende PC-Aufgabe verschiebt sich, und ein
// "Handy + PC"-Tab bekommt eine Erinnerung, ohne seinen Zustand zu verlieren.
async function setSnooze(item, snoozeUntil) {
  const value = snoozeUntil || null;
  const bringsPc = Boolean(value) && item.state === 'open';
  try {
    if (bringsPc) await postStates([[item.normalizedUrl, 'pc']]);
    const res = await fetch('/api/snooze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: item.normalizedUrl, snoozeUntil: value }),
    });
    if (!res.ok) throw new Error((await res.json()).error || t('genericFailed'));
    if (bringsPc) item.state = 'pc';
    item.snoozeUntil = value;
    render();
  } catch (e) {
    toast(t('snoozeSaveFailedPrefix') + friendlyFetchError(e), { error: true });
  }
}

// codemouseai-Review auf PR #13: snoozeUntil ist ein LOKALES Datum aus
// <input type=date>, new Date().toISOString() liefert aber den UTC-Tag - in
// den ein bis zwei Stunden um Mitternacht (je nach Zeitzone/Sommerzeit)
// wichen beide voneinander ab, ein Item waere zu frueh/spaet wieder faellig
// geworden. Fix: gegen den lokalen Tag vergleichen, nicht gegen UTC.
function localYmd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Ablagen-Zugehoerigkeit, nicht Faelligkeit: ein gesetztes Datum haelt das
// Item in der Wiedervorlage, AUCH wenn der Tag schon erreicht oder
// ueberschritten ist. Vorher fiel ein faelliges Item hier automatisch
// wieder raus und landete stillschweigend zurueck in Sichten/Am PC - der
// Plan verlangt ausdruecklich, dass es sichtbar bleibt, bis der Nutzer es
// bewusst quittiert (renderSnoozedView "Jetzt anzeigen" -> setSnooze(null)).
// Faellig/ueberfaellig unterscheidet renderSnoozedView selbst beim Anzeigen.
function isSnoozed(item) {
  return Boolean(item.snoozeUntil);
}

// new Date('YYYY-MM-DD') parst als UTC-Mitternacht - toLocaleDateString()
// wuerde das in Zeitzonen westlich von UTC auf den Vortag zurueckdatieren.
// snoozeUntil ist bereits ein lokales Datum, also direkt aus dem String
// formatieren statt ueber Date umzuwandeln.
function formatYmdDe(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

// Grobe Tagesdifferenz gegen lokale Mitternacht, nicht gegen 24h-Vielfache -
// sonst waere "seit gestern" bei einer um 23:50 getroffenen Entscheidung
// schon nach 10 Minuten falsch. Gerundet auf ganze Tage, weil es hier um
// Liegenlassen geht, nicht um Uhrzeiten.
function daysSince(iso) {
  const then = new Date(iso);
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const startOfNow = new Date();
  startOfNow.setHours(0, 0, 0, 0);
  return Math.round((startOfNow - startOfThen) / 864e5);
}

function formatAgeHint(iso) {
  const days = daysSince(iso);
  if (days <= 0) return t('ageToday');
  if (days === 1) return t('ageYesterday');
  return t('ageDays', { n: days });
}

// Eigene Wortwahl statt formatAgeHint() wiederzuverwenden: "seit 12 Tagen"
// (formatAgeHint, fuer eine andauernde Wartezeit in "Am PC") passt
// grammatisch nicht zu einem einmaligen vergangenen Ereignis wie einer
// Archivierung - dort ist "vor 12 Tagen" die richtige Praeposition.
function formatAgoHint(iso) {
  const days = daysSince(iso);
  if (days <= 0) return t('seenBeforeToday');
  if (days === 1) return t('seenBeforeYesterday');
  return t('seenBeforeDaysAgo', { n: days });
}

const filterSidebarEl = document.getElementById('filterSidebar');
const filterToggleBtn = document.getElementById('filterToggleBtn');
const crossTrayHintEl = document.getElementById('crossTrayHint');
const filterStateListEl = document.getElementById('filterStateList');
const filterDomainListEl = document.getElementById('filterDomainList');
const filterHiddenElsewhereNoteEl = document.getElementById('filterHiddenElsewhereNote');

// Persistiert beide Filter-Dimensionen und haelt den Zeige-Zustand des
// Werkzeugleisten-Knopfs synchron - "aktiv gefiltert" heisst jetzt "Zustand
// ODER Domain eingeschraenkt", nicht mehr nur Zustand.
function saveHiddenFilters() {
  localStorage.setItem('hiddenStates', JSON.stringify([...hiddenStates]));
  localStorage.setItem('hiddenDomains', JSON.stringify([...hiddenDomains]));
  filterToggleBtn.dataset.active = String(hiddenStates.size > 0 || hiddenDomains.size > 0);
}

function setFilterSidebarOpen(open) {
  filterSidebarEl.classList.toggle('open', open);
  filterSidebarEl.inert = !open;
  filterToggleBtn.setAttribute('aria-expanded', String(open));
  if (open) filterSidebarEl.querySelector('input, button')?.focus();
}

// Generische Checkbox-Liste fuer beide Filter-Dimensionen - Zustand und
// Domain unterscheiden sich nur in der Optionsliste, dem Dot und welche
// Menge sie umschalten. Ein gemeinsamer Aufbau statt zweier fast identischer
// Kopien (siehe frueherer renderFilterSidebar).
function renderFilterChecklist(container, options, hiddenSet) {
  container.innerHTML = '';
  for (const opt of options) {
    const label = document.createElement('label');
    label.className = 'filter-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !hiddenSet.has(opt.id);
    input.addEventListener('change', () => {
      if (input.checked) hiddenSet.delete(opt.id);
      else hiddenSet.add(opt.id);
      saveHiddenFilters();
      render();
    });
    const dot = document.createElement('span');
    dot.className = 'dot' + (opt.dotClass ? ' ' + opt.dotClass : '');
    const text = document.createElement('span');
    text.textContent = opt.label;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(opt.count);
    label.append(input, dot, text, count);
    container.appendChild(label);
  }
}

// wb-audit-Fund W3: Filtern war nur nach Zustand moeglich - Quelle/Domain
// fehlte komplett. Zweite Checkbox-Liste in derselben Seitenleiste statt
// eines eigenen Bauteils: gleiche Bedienung (Mehrfachauswahl, Live-Zaehler,
// Persistenz), nur eine zweite Dimension. Beide Listen zaehlen bewusst gegen
// dasselbe listable (nicht gegenseitig gefiltert) - einfacher vorherzusagen
// als ein vollstaendiger Facetten-Filter, und fuer den Anwendungsfall
// ("zeig mir nur X" statt komplexer Kombinationen) ausreichend.
function renderFilterSidebar(listable) {
  const stateCounts = {};
  for (const opt of STATE_FILTER_OPTIONS) stateCounts[opt.id] = 0;
  const domainCounts = new Map();
  for (const item of listable) {
    stateCounts[item.state] = (stateCounts[item.state] || 0) + 1;
    domainCounts.set(item.domain, (domainCounts.get(item.domain) || 0) + 1);
  }

  renderFilterChecklist(
    filterStateListEl,
    STATE_FILTER_OPTIONS.map((opt) => ({ id: opt.id, label: filterOptionLabel(opt.id), dotClass: opt.id, count: stateCounts[opt.id] || 0 })),
    hiddenStates
  );

  const domainOptions = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1]) // groesste Quelle zuerst, wie die Standard-Domain-Sortierung der Hauptliste
    .map(([domain, count]) => ({ id: domain, label: domain, dotClass: null, count }));
  renderFilterChecklist(filterDomainListEl, domainOptions, hiddenDomains);

  // Runde-3-Befund #13: hiddenDomains ist global, diese Liste aber je Ablage
  // (siehe Kommentar an der render()-Aufrufstelle) - eine anderswo
  // ausgeblendete Domain, die hier nicht vorkommt, war bisher unsichtbar und
  // nur ueber den globalen "Alle anzeigen"-Reset erreichbar.
  const visibleDomainIds = new Set(domainOptions.map((o) => o.id));
  const hiddenElsewhereCount = [...hiddenDomains].filter((d) => !visibleDomainIds.has(d)).length;
  filterHiddenElsewhereNoteEl.hidden = hiddenElsewhereCount === 0;
  if (hiddenElsewhereCount > 0) {
    filterHiddenElsewhereNoteEl.textContent = t('filterHiddenElsewhereNote', { n: hiddenElsewhereCount });
  }
}

filterToggleBtn.addEventListener('click', () => setFilterSidebarOpen(!filterSidebarEl.classList.contains('open')));
document.getElementById('filterSidebarClose').addEventListener('click', () => setFilterSidebarOpen(false));
document.getElementById('filterResetBtn').addEventListener('click', () => {
  hiddenStates.clear();
  hiddenDomains.clear();
  saveHiddenFilters();
  render(); // render() ruft renderFilterSidebar() mit der korrekten Partition selbst auf
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && filterSidebarEl.classList.contains('open')) setFilterSidebarOpen(false);
});
saveHiddenFilters(); // Anfangszustand des Filter-Knopfs setzen (aus localStorage geladen)
// codemouseai-Review auf PR #15: die Seitenleiste stand beim Laden nur per
// CSS-transform ausserhalb des sichtbaren Bereichs, inert wurde aber erst
// bei der ersten Oeffnen/Schliessen-Interaktion gesetzt - bis dahin waren
// ihre Checkboxen/Knoepfe per Tab erreichbar, obwohl unsichtbar.
setFilterSidebarOpen(false);

// Legende, Sortierleiste und Sortier-Legende werden einmalig aus DECISIONS
// generiert (index.html liefert dafuer nur noch leere Container) - ein
// weiterer Zustand braucht hier keine Zeile mehr, nur einen Eintrag in
// shared/decisions.mjs.
// Die Erklaerung der vier Zustaende stand dauerhaft als vierspaltige Textwand
// oben auf der Seite - man liest sie einmal und danach ist sie Rauschen.
// Zugeklappt in einem nativen <details>, damit sie erreichbar bleibt, ohne
// dauerhaft Platz zu belegen. wb-audit-Fund W2: kollabiert UND ganz unten
// unter der kompletten Liste platziert war faktisch unsichtbar fuer einen
// neuen Nutzer. Jetzt oben (siehe index.html), UND beim allerersten Besuch
// einmalig automatisch offen - danach merkt sich localStorage, dass sie
// schon gesehen wurde, und sie bleibt wie gewohnt kollabiert.
function renderLegend() {
  const panel = document.getElementById('legendPanel');
  panel.innerHTML = '';
  const LEGEND_SEEN_KEY = 'legendSeen';
  if (!localStorage.getItem(LEGEND_SEEN_KEY)) {
    panel.open = true;
    localStorage.setItem(LEGEND_SEEN_KEY, '1');
  }

  const summary = document.createElement('summary');
  summary.textContent = t('legendSummary');
  panel.appendChild(summary);

  const grid = document.createElement('div');
  grid.className = 'legend-grid';
  for (const d of DECISIONS) {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = d.key.toUpperCase();
    const desc = document.createElement('span');
    desc.className = 'legend-text';
    const b = document.createElement('b');
    b.textContent = decisionLabel(d.id);
    desc.appendChild(b);
    desc.append(' — ' + decisionOutcome(d.id));
    item.appendChild(key);
    item.appendChild(desc);
    grid.appendChild(item);
  }

  const snooze = document.createElement('div');
  snooze.className = 'legend-item';
  const sKey = document.createElement('span');
  sKey.className = 'key';
  sKey.textContent = 'W';
  const sDesc = document.createElement('span');
  sDesc.className = 'legend-text';
  const sB = document.createElement('b');
  sB.textContent = t('legendSnoozeLabel');
  sDesc.appendChild(sB);
  sDesc.append(' — ' + t('legendSnoozeDesc'));
  snooze.appendChild(sKey);
  snooze.appendChild(sDesc);
  grid.appendChild(snooze);

  panel.appendChild(grid);
}

function renderSortStripSkeleton() {
  const strip = document.getElementById('sortStrip');
  strip.innerHTML = '';
  for (const d of DECISIONS) {
    const seg = document.createElement('span');
    seg.className = 's-' + d.id;
    seg.id = 'seg-' + d.id;
    strip.appendChild(seg);
  }
  const undecided = document.createElement('span');
  undecided.className = 's-undecided';
  undecided.id = 'seg-undecided';
  strip.appendChild(undecided);

  // Zahl vor dem Wort: beim Ueberfliegen sucht man den Wert, nicht das Label.
  const legend = document.getElementById('sortLegend');
  legend.innerHTML = '';
  const addEntry = (dotClass, label, countId) => {
    const span = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = 'dot ' + dotClass;
    span.appendChild(dot);
    const b = document.createElement('b');
    b.id = countId;
    b.textContent = '0';
    span.appendChild(b);
    span.append(label);
    legend.appendChild(span);
  };
  addEntry('undecided', t('stateOpenLegendLabel'), 'c-undecided');
  for (const d of DECISIONS) addEntry(d.id, decisionStateLabel(d.id), 'c-' + d.id);
}

function renderSortStrip() {
  const total = inventory.length || 1;
  const counts = { undecided: 0 };
  for (const d of DECISIONS) counts[d.id] = 0;
  for (const item of inventory) {
    counts[item.state === 'open' ? 'undecided' : item.state]++;
  }
  // transform statt flex-basis animieren (GPU-beschleunigt, kein Reflow) -
  // Segmente liegen absolut uebereinander, translateX schiebt an die
  // richtige Stelle, scaleX zieht sie auf die richtige Breite (Prozentwerte
  // beziehen sich dabei auf die unskalierte Box, daher in dieser Reihenfolge
  // korrekt kombinierbar).
  let offset = 0;
  for (const d of DECISIONS) {
    const fraction = counts[d.id] / total;
    document.getElementById('seg-' + d.id).style.transform = `translateX(${offset * 100}%) scaleX(${fraction})`;
    offset += fraction;
    document.getElementById('c-' + d.id).textContent = counts[d.id];
  }
  document.getElementById('seg-undecided').style.transform = `translateX(${offset * 100}%) scaleX(${counts.undecided / total})`;
  document.getElementById('c-undecided').textContent = counts.undecided;

}

function renderRowState(item) {
  const row = document.querySelector(`.tab-row[data-key="${CSS.escape(item.normalizedUrl)}"]`);
  if (!row) return;
  row.className = 'tab-row' + (item.state !== 'open' ? ` decision-${item.state}` : '');
  row.querySelectorAll('.decision-buttons button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.decision === item.state);
  });

  // Domain-Kopfzeile zeigt "entschieden/gesamt" - bei Einzelentscheidungen
  // (Klick/Tastenkuerzel, der haeufigste Fall) ohne vollen render() sonst
  // veraltet. Zaehlung direkt aus dem DOM statt erneuter Filterlogik.
  const group = row.closest('.domain-group');
  const countEl = group?.querySelector('.domain-header .count');
  if (countEl) {
    const total = group.querySelectorAll('.tab-row').length;
    const decided = group.querySelectorAll('.tab-row[class*="decision-"]').length;
    countEl.textContent = decided ? `${decided}/${total}` : `${total}`;
    countEl.classList.toggle('decided', decided === total);
  }
}

// Wiedervorlage ist selten, Entscheiden ist staendig. Vorher stand in jeder
// Zeile dauerhaft ein Datumsfeld, breiter als die vier Entscheidungsknoepfe
// zusammen - die seltene Aktion hatte mehr Gewicht als die eigentliche
// Arbeit. Jetzt: ein schmaler Knopf, der erst bei Absicht sichtbar wird
// (Zeige-/Fokuszustand, siehe style.css) und das native Datumsfeld an
// derselben Stelle einblendet. Ist bereits ein Datum gesetzt, bleibt der
// Knopf dauerhaft sichtbar - dann ist es ja eine Eigenschaft der Zeile.
// wb-audit-Fund W1: die Aktionszone (Wiedervorlage + Entscheidungsknoepfe,
// bzw. Hinweistext bei "Verschwunden") fasst sich hier zu EINEM Element mit
// einer festen Breitenbasis zusammen (siehe .row-actions in style.css) -
// das ist die reservierte ~30%-Zone, gegen die der Link-Titel (~70%) sich
// abgrenzt. Ein Trenner (border-left) sitzt direkt auf diesem Container.
function makeRowActions(...children) {
  const el = document.createElement('div');
  el.className = 'row-actions';
  el.append(...children);
  return el;
}

function makeSnoozeSlot(item) {
  const slot = document.createElement('div');
  slot.className = 'snooze-slot';
  slot.appendChild(makeSnoozeButton(item, slot));
  return slot;
}

function makeSnoozeButton(item, slot) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'snooze-btn';
  btn.textContent = '⏲';
  btn.title = item.snoozeUntil
    ? t('snoozeSetTitle', { date: formatYmdDe(item.snoozeUntil) })
    : t('snoozeSetBtnTitle');
  if (item.snoozeUntil) btn.dataset.set = 'true';
  btn.addEventListener('click', (e) => { e.stopPropagation(); openSnoozeMenu(slot, item); });
  return btn;
}

// Datums-Schnellmenue statt direkt des nackten Datumsfelds (wb-audit-Folge-
// Wunsch: die drei haeufigsten Faelle - morgen/naechste Woche/in einem Monat
// - sollen einen Klick kosten, nicht Tippen im Kalender). "Datum waehlen"
// fuehrt weiterhin zum nativen <input type=date> fuer den Rest.
function snoozeQuickOptions(todayYmd) {
  const base = new Date(`${todayYmd}T00:00:00`);
  const plus = (days) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return localYmd(d);
  };
  return [
    { label: t('snoozeTomorrow'), value: plus(1) },
    { label: t('snoozeNextWeek'), value: plus(7) },
    { label: t('snoozeInMonth'), value: plus(30) },
  ];
}

function openSnoozeMenu(slot, item) {
  if (!item) return;
  const menu = document.createElement('div');
  menu.className = 'snooze-menu';

  // Aufraeumen an jedem Ausgang (Option gewaehlt, Aussen-Klick, Escape) -
  // sonst haeuften sich bei jedem Oeffnen weitere globale Listener an.
  const cleanup = () => {
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onEscape, true);
  };
  const revert = () => { cleanup(); slot.replaceChildren(makeSnoozeButton(item, slot)); };
  const onOutside = (e) => { if (!menu.contains(e.target)) revert(); };
  const onEscape = (e) => { if (e.key === 'Escape') revert(); };

  const addOption = (label, onPick, className) => {
    const opt = document.createElement('button');
    opt.type = 'button';
    if (className) opt.className = className;
    opt.textContent = label;
    opt.addEventListener('click', (e) => { e.stopPropagation(); cleanup(); onPick(); });
    menu.appendChild(opt);
  };

  for (const { label, value } of snoozeQuickOptions(localYmd())) {
    addOption(label, () => setSnooze(item, value));
  }
  addOption(t('snoozePickDate'), () => openSnoozeDateInput(slot, item));
  if (item.snoozeUntil) addOption(t('snoozeShowNow'), () => setSnooze(item, null), 'snooze-clear');

  document.addEventListener('click', onOutside, true);
  document.addEventListener('keydown', onEscape, true);
  slot.replaceChildren(menu);
}

// Natives <input type=date> statt eines Picker-Widgets - jedes Betriebssystem
// bringt das schon mit, keine zusaetzliche Abhaengigkeit. click stoppt die
// Propagation wie die Entscheidungsknoepfe (sonst wuerde ein Klick ins Feld
// die Zeile fokussieren und ggf. Tastaturkuerzel-Ziel werden).
function openSnoozeDateInput(slot, item) {
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'snooze-input';
  input.title = t('snoozeDateInputTitle');
  input.value = item.snoozeUntil || '';
  const revert = () => slot.replaceChildren(makeSnoozeButton(item, slot));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('change', (e) => { e.stopPropagation(); setSnooze(item, input.value); });
  input.addEventListener('blur', revert);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); revert(); }
  });
  slot.replaceChildren(input);
  input.focus();
  // showPicker() oeffnet den Kalender direkt - spart einen zweiten Klick.
  // Nicht ueberall vorhanden; ohne ihn bleibt das Feld normal bedienbar.
  try { input.showPicker(); } catch { /* kein Picker verfuegbar - Tippen geht weiterhin */ }
}

function makeDecisionButtons(key, currentState, onPick) {
  const cell = document.createElement('div');
  cell.className = 'decision-buttons';
  for (const d of DECISIONS) {
    const btn = document.createElement('button');
    btn.innerHTML = d.icon;
    btn.title = `${d.key.toUpperCase()} — ${decisionLabel(d.id)} — ${decisionOutcome(d.id)}`;
    btn.setAttribute('aria-label', decisionLabel(d.id));
    btn.dataset.decision = d.id;
    btn.className = d.id + (currentState === d.id ? ' active' : '');
    btn.addEventListener('click', (e) => { e.stopPropagation(); onPick(d.id); });
    cell.appendChild(btn);
  }
  return cell;
}

// Domain-Teil optisch betont, Pfad/Query gedimmt - der Domain-Teil hilft beim
// schnellen "wo bin ich"-Scannen, der Pfad ist meist das variable Detail.
// Faellt new URL() auseinander (sollte durch normalizeUrl() nicht passieren),
// einfach den Rohtext anzeigen statt die Zeile leer zu lassen.
function renderUrlLine(url) {
  const el = document.createElement('span');
  el.className = 'url';
  el.title = url;
  try {
    const u = new URL(url);
    const origin = document.createElement('span');
    origin.className = 'url-origin';
    origin.textContent = u.origin;
    const rest = document.createElement('span');
    rest.className = 'url-path';
    rest.textContent = u.pathname + u.search;
    el.appendChild(origin);
    el.appendChild(rest);
  } catch {
    el.textContent = url;
  }
  return el;
}

// "Das hattest du schon mal archiviert/verworfen" - gesetzt vom Server bei
// jedem Scan (mergeScan). Vorschlag 5 der Produktanalyse: der Tooltip nennt
// jetzt Art UND Zeitpunkt der letzten Entscheidung ("vor 12 Tagen bereits
// verworfen") statt nur eines stummen Zeichens - sofort erkennbar beim
// Hovern, ohne erst im Archiv nachschauen zu muessen. seenBeforeKind/At
// kommen aus items.getItems() (Server), koennen theoretisch fehlen, wenn der
// zugehoerige Archiv-Eintrag zwischen Scan und Anzeige geloescht wurde -
// dann faellt der Tooltip auf den alten, generischen Text zurueck.
function renderSeenBeforeBadge(item) {
  if (!item.seenBefore) return null;
  const badge = document.createElement('span');
  badge.className = 'seen-before-badge';
  badge.textContent = '↺';
  badge.title = item.seenBeforeKind
    ? t('seenBeforeTitleDetailed', { kind: archiveKindLabel(item.seenBeforeKind), when: formatAgoHint(item.seenBeforeAt) })
    : t('seenBeforeTitle');
  return badge;
}

function renderTitleBlock(item) {
  const titleBlock = document.createElement('div');
  titleBlock.className = 'title-block';
  // Titel und Wiedervorlage-Zeichen in einer eigenen Zeile: title-block ist
  // eine Spalte (Titel ueber URL), ein direkt angehaengtes Badge landete
  // dadurch faelschlich auf einer eigenen Zeile zwischen Titel und URL.
  const line = document.createElement('div');
  line.className = 'title-line';
  const link = document.createElement('a');
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = item.title;
  link.title = item.title; // voller Text als Tooltip, da Zeilen hart abgeschnitten werden
  line.appendChild(link);
  const badge = renderSeenBeforeBadge(item);
  if (badge) line.appendChild(badge);
  titleBlock.appendChild(line);
  titleBlock.appendChild(renderUrlLine(item.url));
  return titleBlock;
}

// Gemeinsame Bauteile aller Ablagen-Ansichten: Ueberschrift mit Zaehler und
// einem Satz, der sagt, was hier liegt - und ein Leerzustand, der nicht nur
// "nichts da" meldet, sondern wie etwas hier hineinkommt.
function renderSectionHead(container, title, count, sub) {
  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.textContent = title;
  head.appendChild(h);
  if (count != null) {
    const pill = document.createElement('span');
    pill.className = 'count-pill';
    pill.textContent = String(count);
    head.appendChild(pill);
  }
  if (sub) {
    const p = document.createElement('p');
    p.textContent = sub;
    head.appendChild(p);
  }
  container.appendChild(head);
}

function renderEmptyState(container, title, body) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const t = document.createElement('span');
  t.className = 'empty-title';
  t.textContent = title;
  const b = document.createElement('span');
  b.className = 'empty-body';
  b.textContent = body;
  empty.appendChild(t);
  empty.appendChild(b);
  container.appendChild(empty);
}

function makeFlatList(container) {
  const list = document.createElement('div');
  list.className = 'flat-list';
  container.appendChild(list);
  return list;
}

// Notiz ist Inhalt, nicht Aktion - wird darum vor den eigentlichen
// Aktions-Knoepfen platziert (siehe renderPcView/renderSnoozedView).
// 'input' statt 'change' + Entprellung (scheduleSaveNote), damit ein
// Ablagenwechsel waehrend des Tippens nichts mehr verwirft.
function makeNoteInput(item) {
  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.className = 'note-input';
  noteInput.placeholder = t('notePlaceholder');
  noteInput.value = item.note || '';
  noteInput.addEventListener('click', (e) => e.stopPropagation());
  noteInput.addEventListener('input', () => scheduleSaveNote(item, noteInput.value));
  return noteInput;
}

// "Am PC erledigen": Items, deren Tab am Telefon schon geschlossen wurde
// (state 'pc' + closedAt), aber die als Arbeitsliste hier bestehen bleiben.
// Nach Domain gruppiert wie Sichten (wird im echten Betrieb genauso gross),
// keine Entscheidungs-Knoepfe (die Entscheidung ist ja schon gefallen),
// stattdessen erledigt/zurueck/Notiz.
function renderPcView(items) {
  pcSectionEl.innerHTML = '';
  if (!items.length) {
    renderSectionHead(pcSectionEl, t('pcSectionTitle'), 0, t('pcSectionSub'));
    renderEmptyState(pcSectionEl, t('pcEmptyTitle'), t('pcEmptyBody'));
    return;
  }

  // codemouseai-Review auf PR #28: der Knopf oeffnete immer alle Items,
  // auch die per Text-/Domainfilter gerade ausgeblendeten - bei aktivem
  // Filter waeren das ueberraschend mehr Tabs als sichtbar. Zaehler und
  // Aktion haengen jetzt beide an der gefilterten Menge.
  //
  // Runde-3-Befund #14: derselbe Grundsatz galt bisher NICHT fuer den
  // Zaehler in der Kopfzeile - der zeigte immer items.length (Ablage
  // insgesamt), auch wenn ein Filter die sichtbare Liste auf wenige Zeilen
  // reduzierte. "283" in der Kopfzeile ueber einer Liste mit 5 sichtbaren
  // Treffern widersprach sich selbst. Kopfzeile jetzt mit derselben
  // gefilterten Menge wie die Liste darunter - der Gesamtwert der Ablage
  // bleibt ueber den Ablagen-Reiter (trayCount) weiterhin einen Blick
  // entfernt.
  const filtered = visibleItems(items);
  renderSectionHead(pcSectionEl, t('pcSectionTitle'), filtered.length, t('pcSectionSub'));
  if (!filtered.length) return renderNoFilterMatch(pcSectionEl);

  // Vorschlag 7 der Produktanalyse: zuschaltbarer Fokus-Modus, standardmaessig
  // aus. Reine Anzeigefilterung - keine Zeile hier veraendert Daten, Zustand
  // oder Reihenfolge auf der Platte, sie entscheidet nur, wie viel von der
  // bereits sortierten/gefilterten Menge gerendert wird. Absichtlich KEIN
  // eigener "Portion"-Zustand: einfach immer die ersten
  // PC_FOCUS_BATCH_SIZE der aktuellen Sortierung zeigen - sobald Items die
  // Ablage verlassen (erledigt/zurueck), ruecken die naechsten beim
  // naechsten render() automatisch nach, ohne dass irgendwo mitgezaehlt
  // werden muesste, was schon "dran war".
  const sortedFlat = groupByDomain(filtered).flatMap(([, group]) => group);
  const focusApplies = pcFocusMode && sortedFlat.length > PC_FOCUS_BATCH_SIZE;
  const shown = focusApplies ? sortedFlat.slice(0, PC_FOCUS_BATCH_SIZE) : sortedFlat;

  const focusToggle = document.createElement('label');
  focusToggle.className = 'pc-focus-toggle';
  const focusCb = document.createElement('input');
  focusCb.type = 'checkbox';
  focusCb.checked = pcFocusMode;
  focusCb.addEventListener('change', () => {
    pcFocusMode = focusCb.checked;
    localStorage.setItem('pcFocusMode', pcFocusMode ? '1' : '0');
    render();
  });
  focusToggle.appendChild(focusCb);
  focusToggle.append(t('pcFocusToggleLabel', { n: PC_FOCUS_BATCH_SIZE }));
  pcSectionEl.appendChild(focusToggle);
  if (focusApplies) {
    const focusHint = document.createElement('p');
    focusHint.className = 'hint';
    focusHint.textContent = t('pcFocusHint', { shown: shown.length, total: sortedFlat.length });
    pcSectionEl.appendChild(focusHint);
  }

  const selectAllToggle = document.createElement('label');
  selectAllToggle.className = 'select-all-toggle';
  selectAllToggle.appendChild(makeSelectAllCheckbox(shown.map((i) => i.normalizedUrl)));
  selectAllToggle.append(t('selectAllVisibleLabel'));
  pcSectionEl.appendChild(selectAllToggle);

  const openAllBtn = document.createElement('button');
  openAllBtn.className = 'ghost-btn';
  openAllBtn.textContent = t('openAllInBrowserBtn', { n: shown.length });
  openAllBtn.title = t('openAllInBrowserTitle');
  openAllBtn.addEventListener('click', () => openAllInBrowser(shown));
  pcSectionEl.appendChild(openAllBtn);

  // Eigener Hinweistext statt des #keyboardHint-Absatzes: der lebt fest in
  // view-triage's Markup (index.html), diese Ablage baut ihren Inhalt
  // komplett aus JS auf. D/R ergaenzen hier die Pfeiltasten-Navigation, die
  // bereits laenger funktioniert (siehe keydown-Handler weiter unten).
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = t('pcKeyboardHintText');
  pcSectionEl.appendChild(hint);

  for (const [domain, group] of groupByDomain(shown)) {
    const list = renderDomainGroup(pcSectionEl, domain, group, { selectable: true });
    for (const item of group) {
      const row = document.createElement('div');
      row.className = 'tab-row';
      row.tabIndex = 0;
      row.dataset.key = item.normalizedUrl;

      // Gleiche Checkbox+selectedKeys-Mechanik wie in Sichten (siehe render()
      // weiter unten) - 283 von 295 Items im echten Bestand liegen hier,
      // ohne Mehrfachauswahl war jede Aufraeumaktion ein Einzelklick pro Tab.
      const selectCb = document.createElement('input');
      selectCb.type = 'checkbox';
      selectCb.className = 'row-select';
      selectCb.checked = selectedKeys.has(item.normalizedUrl);
      selectCb.addEventListener('click', (e) => e.stopPropagation());
      selectCb.addEventListener('change', () => {
        if (selectCb.checked) selectedKeys.add(item.normalizedUrl);
        else selectedKeys.delete(item.normalizedUrl);
        render();
      });
      row.appendChild(selectCb);

      const swatch = document.createElement('span');
      swatch.className = 'swatch pc';
      row.appendChild(swatch);
      row.appendChild(renderTitleBlock(item));

      // Ohne das sieht eine Zeile von gestern genauso aus wie eine von vor
      // zwei Wochen - bei median 7 Tagen Liegezeit im echten Bestand war das
      // der Kern des Problems, nicht nur ein fehlendes Detail. Schwelle 5
      // Tage matcht das bestehende .urgent-Muster aus Verschwunden/Wieder-
      // vorlage, keine neue Zahl erfunden.
      const age = document.createElement('span');
      age.className = 'missing-hint' + (daysSince(item.stateChangedAt) > 5 ? ' urgent' : '');
      age.textContent = formatAgeHint(item.stateChangedAt);
      row.appendChild(age);

      const actions = document.createElement('div');
      actions.className = 'side-actions';
      actions.appendChild(makeNoteInput(item));
      actions.appendChild(makeSnoozeSlot(item));

      const doneBtn = document.createElement('button');
      doneBtn.textContent = t('doneBtn');
      doneBtn.title = t('doneBtnTitle');
      doneBtn.addEventListener('click', () => pcDone(item));
      actions.appendChild(doneBtn);

      const returnBtn = document.createElement('button');
      returnBtn.textContent = t('returnToPhoneBtn');
      returnBtn.addEventListener('click', () => pcReturn(item));
      actions.appendChild(returnBtn);

      row.appendChild(actions);
      list.appendChild(row);
    }
  }
}

// "Wiedervorlage": alle Items mit gesetztem snoozeUntil - verschwinden aus
// allen anderen Ablagen (siehe isSnoozed()/render()), bleiben aber hier
// sichtbar mit Zieldatum, statt spurlos zu verschwinden. Faellige (heute
// oder ueberfaellig) bleiben bewusst stehen, statt automatisch wieder in
// Sichten/Am PC zurueckzufallen - "Jetzt anzeigen" ist die einzige Art, sie
// hier herauszunehmen. Nach Datum sortiert, Faellige/Ueberfaellige zuerst.
// Runde-3-Befund #14: Kopfzeilen-Zaehler folgt jetzt der gefilterten Menge
// wie die Liste darunter, statt immer die Gesamtzahl der Ablage zu zeigen
// (siehe renderPcView fuer die ausfuehrliche Begruendung).
function renderSnoozedView(items) {
  snoozedSectionEl.innerHTML = '';
  if (!items.length) {
    renderSectionHead(snoozedSectionEl, t('viewSnoozed'), 0, t('snoozedSectionSub'));
    renderEmptyState(snoozedSectionEl, t('snoozedEmptyTitle'), t('snoozedEmptyBody'));
    return;
  }

  const shown = visibleItems(items);
  renderSectionHead(snoozedSectionEl, t('viewSnoozed'), shown.length, t('snoozedSectionSub'));
  if (!shown.length) return renderNoFilterMatch(snoozedSectionEl);

  // Runde-3-Befund #18: einzige Ablage mit Pfeiltasten-Navigation, aber
  // ohne jede Aktionstaste UND ohne Hinweis darauf.
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = t('snoozedKeyboardHintText');
  snoozedSectionEl.appendChild(hint);

  const todayYmd = localYmd();
  const sorted = [...shown].sort((a, b) => a.snoozeUntil.localeCompare(b.snoozeUntil));

  const list = makeFlatList(snoozedSectionEl);
  for (const item of sorted) {
    const due = item.snoozeUntil <= todayYmd;
    const row = document.createElement('div');
    row.className = 'tab-row';
    row.tabIndex = 0;
    row.dataset.key = item.normalizedUrl;

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    row.appendChild(swatch);
    row.appendChild(renderTitleBlock(item));

    const hint = document.createElement('span');
    hint.className = 'missing-hint' + (due ? ' urgent' : '');
    hint.textContent = due
      ? (item.snoozeUntil === todayYmd ? t('dueToday') : t('overdueSince', { date: formatYmdDe(item.snoozeUntil) }))
      : t('dueUntil', { date: formatYmdDe(item.snoozeUntil) });
    row.appendChild(hint);

    const actions = document.createElement('div');
    actions.className = 'side-actions';
    actions.appendChild(makeNoteInput(item));
    actions.appendChild(makeSnoozeSlot(item));
    const showBtn = document.createElement('button');
    showBtn.textContent = t('snoozeShowNow');
    showBtn.addEventListener('click', () => setSnooze(item, null));
    actions.appendChild(showBtn);
    row.appendChild(actions);

    list.appendChild(row);
  }
}

// "Verschwunden": NUR unentschiedene Items (state 'open') mit missingSince -
// eine bereits getroffene Entscheidung schuetzt vor diesem Signal (siehe
// mergeScan in lib/items.mjs), genau weil hier noch keine Entscheidung
// getroffen wurde. Macht das Fehlen sichtbar statt (wie vor dem Merge-Scan-
// Umbau) stillschweigend aus dem Bestand verschwinden zu lassen. Bietet
// nach 3 Fehlversuchen eine Empfehlung an, handelt aber nie automatisch -
// die Entscheidungs-Knoepfe bleiben die einzige Aktion.
// Runde-3-Befund #14: Kopfzeilen-Zaehler folgt der gefilterten Menge (siehe
// renderPcView fuer die Begruendung).
function renderMissingView(items) {
  missingSectionEl.innerHTML = '';
  if (!items.length) {
    renderSectionHead(missingSectionEl, t('viewMissing'), 0, t('missingSectionSub'));
    renderEmptyState(missingSectionEl, t('missingEmptyTitle'), t('missingEmptyBody'));
    return;
  }

  const shown = visibleItems(items);
  renderSectionHead(missingSectionEl, t('viewMissing'), shown.length, t('missingSectionSub'));
  if (!shown.length) return renderNoFilterMatch(missingSectionEl);

  for (const [domain, group] of groupByDomain(shown)) {
    const list = renderDomainGroup(missingSectionEl, domain, group);
    for (const item of group) {
      const row = document.createElement('div');
      row.className = 'tab-row' + (item.state !== 'open' ? ` decision-${item.state}` : '');
      row.tabIndex = 0;
      row.dataset.key = item.normalizedUrl;

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      row.appendChild(swatch);
      row.appendChild(renderTitleBlock(item));

      const hint = document.createElement('span');
      hint.className = 'missing-hint' + (item.missedScans >= 3 ? ' urgent' : '');
      hint.textContent =
        item.missedScans >= 3
          ? t('missingUrgent', { n: item.missedScans })
          : item.missedScans === 1 ? t('missingSingle') : t('missingMulti', { n: item.missedScans });

      row.appendChild(
        makeRowActions(hint, makeSnoozeSlot(item), makeDecisionButtons(item.normalizedUrl, item.state, (d) => setState(item.normalizedUrl, d)))
      );
      list.appendChild(row);
    }
  }
}

// "Vorgemerkt": Items, deren Entscheidung den Tab am Handy schliessen soll,
// aber der Tab dort noch lebt (siehe isPending()). Nach Entscheidung
// gruppiert statt nach Domain - hier interessiert "was passiert gleich am
// Handy", nicht "wo kommt es her". pendingConnected/pendingTransferPossible
// werden von refreshPendingHealth() bzw. hier gesetzt und steuern zusammen,
// ob der Uebertragen-Knopf aktiv ist.
let pendingConnected = false;
let pendingTransferPossible = false;

function groupByState(list) {
  const byId = new Map(DECISIONS.map((d) => [d.id, []]));
  for (const item of list) {
    if (!byId.has(item.state)) byId.set(item.state, []);
    byId.get(item.state).push(item);
  }
  return [...byId.entries()].filter(([, group]) => group.length);
}

function updateTransferBtnState() {
  const btn = document.getElementById('transferBtn');
  if (!btn) return;
  btn.disabled = !pendingConnected || !pendingTransferPossible;
}

// Runde-3-Befund #11: der Verbindungsstatus war bisher nur sichtbar, wenn
// man zufaellig in "Vorgemerkt" war (der einzigen Ablage, die
// pendingHealthStatus rendert) - der frueh-Ausstieg oben liess die Pruefung
// sonst komplett ins Leere laufen. Aktualisiert jetzt zusaetzlich einen
// persistenten Indikator im Header (#connectionStatus), sichtbar in JEDER
// Ablage - ohne zusaetzliches Dauer-Polling: nur der zuletzt bekannte Stand,
// aktualisiert bei jeder ohnehin schon stattfindenden Pruefung.
function renderConnectionStatus(label, { urgent = false } = {}) {
  connectionStatusEl.hidden = false;
  connectionStatusEl.textContent = label;
  connectionStatusEl.classList.toggle('urgent', urgent);
  const pendingStatusEl = document.getElementById('pendingHealthStatus');
  if (pendingStatusEl) {
    pendingStatusEl.textContent = label;
    pendingStatusEl.classList.toggle('urgent', urgent);
  }
}

async function refreshPendingHealth() {
  renderConnectionStatus(t('checkingConnection'));
  try {
    const res = await fetch('/api/health', { method: 'POST' });
    const health = await res.json();
    pendingConnected = Boolean(health.device && health.chrome?.ok);
    renderConnectionStatus(pendingConnected ? t('phoneConnected') : t('phoneNotConnected'), { urgent: !pendingConnected });
  } catch {
    pendingConnected = false;
    renderConnectionStatus(t('connectionStatusUnknown'), { urgent: true });
  }
  updateTransferBtnState();
}

// Runde-3-Befund #14: Kopfzeilen-Zaehler folgt der gefilterten Menge wie die
// Liste darunter (siehe renderPcView) - NICHT zu verwechseln mit
// pendingTransferPossible weiter unten, das bewusst an der ungefilterten
// Menge haengt, weil der Uebertragen-Knopf am echten Bestand handelt, nicht
// an der Anzeige.
function renderPendingView(items) {
  pendingSectionEl.innerHTML = '';
  const filtered = visibleItems(items);
  renderSectionHead(pendingSectionEl, t('viewPending'), filtered.length, t('pendingSectionSub'));

  const headBar = document.createElement('div');
  headBar.className = 'commit-group';
  const status = document.createElement('span');
  status.id = 'pendingHealthStatus';
  status.className = 'pending-status';
  status.textContent = t('checkingConnection');
  const transferBtn = document.createElement('button');
  transferBtn.id = 'transferBtn';
  transferBtn.className = 'primary';
  transferBtn.textContent = t('transferBtn');
  transferBtn.title = t('transferBtnTitle');
  transferBtn.disabled = true;
  transferBtn.addEventListener('click', runTransfer);
  headBar.appendChild(transferBtn);
  headBar.appendChild(status);
  pendingSectionEl.appendChild(headBar);

  pendingTransferPossible = items.length > 0 || inventory.some((i) => i.state === 'keep');
  updateTransferBtnState();

  if (!items.length) {
    renderEmptyState(pendingSectionEl, t('pendingEmptyTitle'), t('pendingEmptyBody'));
    return;
  }

  // pendingTransferPossible bleibt bewusst gegen die ungefilterte Menge oben -
  // der Uebertragen-Knopf handelt am echten Bestand, nicht an der Anzeige.
  if (!filtered.length) return renderNoFilterMatch(pendingSectionEl);

  for (const [state, group] of groupByState(filtered)) {
    const heading = document.createElement('p');
    heading.className = 'state-group-heading';
    heading.textContent = `${decisionLabel(state)} (${group.length})`;
    pendingSectionEl.appendChild(heading);

    const list = makeFlatList(pendingSectionEl);
    for (const item of group) {
      const row = document.createElement('div');
      row.className = `tab-row decision-${item.state}`;
      row.tabIndex = 0;
      row.dataset.key = item.normalizedUrl;

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      row.appendChild(swatch);
      row.appendChild(renderTitleBlock(item));
      row.appendChild(
        makeRowActions(makeDecisionButtons(item.normalizedUrl, item.state, (d) => setState(item.normalizedUrl, d)))
      );
      list.appendChild(row);
    }
  }
}

// Eine Archiv-Zeile, gemeinsam fuer Such- und Blaetteransicht - Notiz reist
// seit Stufe D mit ins Archiv (lib/items.mjs) und ist durchsuchbar, hier als
// Tooltip sichtbar, damit ein Treffer per Notiztext nicht wie ein Zufallsfund
// wirkt. Keine Entscheidungsknoepfe: Archiveintraege sind Historie, keine
// offene Entscheidung.
function makeArchiveRow(item) {
  const row = document.createElement('div');
  row.className = 'tab-row';
  if (item.note) row.title = item.note;
  const swatch = document.createElement('span');
  swatch.className = 'swatch ' + (ARCHIVE_KIND_SWATCH[item.kind] || '');
  row.appendChild(swatch);
  row.appendChild(renderTitleBlock(item));
  const tag = document.createElement('span');
  tag.className = 'kind-tag ' + item.kind;
  tag.textContent = archiveKindLabel(item.kind);
  const when = document.createElement('span');
  when.className = 'missing-hint';
  when.textContent = new Date(item.at).toLocaleDateString(dateLocale());
  row.appendChild(makeRowActions(tag, when));
  return row;
}

// Archiv-Suche: eigener Datenpfad (archive.jsonl statt items.json), aber
// dieselben Bauteile (groupByDomain, renderTitleBlock) wie die Hauptliste -
// kein zweiter Renderpfad. Nach Domain gruppiert, wie die uebrigen Ablagen.
function renderArchiveResults(results, query) {
  archiveResultsEl.innerHTML = '';
  renderSectionHead(archiveResultsEl, t('viewArchive'), results.length, t('archiveSearchResultsSub', { query }));

  if (!results.length) {
    renderEmptyState(archiveResultsEl, t('noFilterMatchTitle'), t('archiveNoResultsBody', { query }));
    return;
  }

  for (const [domain, items] of groupByDomain(results)) {
    const group = document.createElement('div');
    group.className = 'domain-group';

    const header = document.createElement('div');
    header.className = 'domain-header';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = domain;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(items.length);
    header.appendChild(name);
    header.appendChild(count);
    group.appendChild(header);

    const rows = document.createElement('div');
    rows.className = 'domain-rows';
    for (const item of items) rows.appendChild(makeArchiveRow(item));
    group.appendChild(rows);
    archiveResultsEl.appendChild(group);
  }
}

// Vorschlag 4 der Produktanalyse: ohne Suchbegriff durchblaettern statt einer
// leeren Ablage. Bewusst FLACH und chronologisch statt nach Domain gruppiert
// wie renderArchiveResults oben - eine Domain-Gruppierung wuerde die
// Datumssortierung genau in dem Fall aufheben, in dem "neueste zuerst" der
// ganze Witz der Ansicht ist. Seitenweise nachladbar (ARCHIVE_PAGE_SIZE),
// haengt bei reset:false nur an, statt komplett neu zu rendern.
const ARCHIVE_PAGE_SIZE = 50;
let archiveBrowseOffset = 0;
// codemouseai-Review auf PR #56: ein schneller Doppelklick auf "Mehr laden"
// las denselben archiveBrowseOffset zweimal, bevor die erste Anfrage
// zurueckkam - beide haengten dieselbe Seite an, sichtbar als doppelte
// Zeilen. requestId macht nur die JEWEILS LETZTE laufende Anfrage
// massgeblich; jede aeltere wird beim Zurueckkommen stillschweigend
// verworfen statt gerendert zu werden.
let archiveBrowseRequestId = 0;

function renderArchiveBrowse(results, { reset, hasMore }) {
  const existingMoreBtn = archiveResultsEl.querySelector('.archive-load-more');
  if (existingMoreBtn) existingMoreBtn.remove();

  if (reset) {
    archiveResultsEl.innerHTML = '';
    renderSectionHead(archiveResultsEl, t('viewArchive'), null, t('archiveSectionSub'));
    if (!results.length) {
      renderEmptyState(archiveResultsEl, t('archiveSearchEmptyTitle'), t('archiveSearchEmptyBody'));
      return;
    }
  }

  const list = archiveResultsEl.querySelector('.flat-list') || makeFlatList(archiveResultsEl);
  for (const item of results) list.appendChild(makeArchiveRow(item));

  if (hasMore) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'ghost-btn archive-load-more';
    moreBtn.textContent = t('archiveLoadMoreBtn');
    moreBtn.addEventListener('click', () => loadArchiveBrowsePage({ reset: false }));
    archiveResultsEl.appendChild(moreBtn);
  }
}

async function loadArchiveBrowsePage({ reset }) {
  if (reset) archiveBrowseOffset = 0;
  const requestId = ++archiveBrowseRequestId;
  const moreBtn = archiveResultsEl.querySelector('.archive-load-more');
  if (moreBtn) moreBtn.disabled = true;
  try {
    const includeDropped = document.getElementById('archiveIncludeDropped').checked;
    const params = new URLSearchParams({ limit: String(ARCHIVE_PAGE_SIZE), offset: String(archiveBrowseOffset) });
    if (includeDropped) params.set('includeDropped', '1');
    const res = await fetch(`/api/search?${params}`);
    if (!res.ok) throw new Error((await res.json()).error || t('searchFailedGeneric'));
    const { results } = await res.json();
    if (requestId !== archiveBrowseRequestId) return; // eine neuere Anfrage ist schon unterwegs oder fertig
    renderArchiveBrowse(results, { reset, hasMore: results.length === ARCHIVE_PAGE_SIZE });
    archiveBrowseOffset += results.length;
  } catch (e) {
    if (requestId !== archiveBrowseRequestId) return;
    toast(t('archiveSearchFailedPrefix') + friendlyFetchError(e), { error: true });
    if (moreBtn) moreBtn.disabled = false;
  }
}

async function runArchiveSearch(query) {
  const q = query.trim();
  if (!q) return loadArchiveBrowsePage({ reset: true });
  try {
    const includeDropped = document.getElementById('archiveIncludeDropped').checked;
    const params = new URLSearchParams({ q });
    if (includeDropped) params.set('includeDropped', '1');
    const res = await fetch(`/api/search?${params}`);
    if (!res.ok) throw new Error((await res.json()).error || t('searchFailedGeneric'));
    const { results } = await res.json();
    renderArchiveResults(results, q);
  } catch (e) {
    toast(t('archiveSearchFailedPrefix') + friendlyFetchError(e), { error: true });
  }
}

// Echter Debounce statt rAF-Coalescing (anders als der lokale Filter oben):
// jede Anfrage ist ein Netzwerk-Roundtrip mit Festplattenzugriff auf dem
// Server, kein reines DOM-Rebuild - das rechtfertigt hier die zusaetzliche
// Wartezeit, die render() bewusst vermeidet.
let archiveSearchTimer = null;
function scheduleArchiveSearch(query) {
  clearTimeout(archiveSearchTimer);
  archiveSearchTimer = setTimeout(() => runArchiveSearch(query), 300);
}

// Ein Item gehoert in genau eine Ablage - die Reihenfolge der Pruefungen ist
// die Rangfolge: zurueckgestellt schlaegt alles (es soll ja gerade nicht
// auftauchen), danach die PC-Arbeitsliste, danach verschwunden, dann
// vorgemerkt, der Rest wird gesichtet.
//
// Zustandsmodell-Umbau (Plan "Optimierung nach Nutzungs-Audit"): Sichten
// zeigt nur noch, was tatsaechlich noch eine Entscheidung braucht ODER am
// Handy weiterhin sichtbar bleiben soll (state 'open'/'keep' - 'keep' ist ja
// gerade der Zustand "bleibt offen, bleibt hier"). Alles, wofuer eine
// Entscheidung getroffen wurde, die den Tab am Handy schliessen SOLL
// (closesTab:true), verschwindet sofort aus Sichten in die neue "Vorgemerkt"-
// Ablage, solange der Tab dort noch lebt (duplicateIds.length>0). Ist er
// geschlossen, uebernehmen die bestehenden Ablagen (pc -> "Am PC", archive/
// drop -> verlassen items.json direkt Richtung Archiv).
function isPending(item) {
  return item.state !== 'open' && item.state !== 'keep' && BY_ID[item.state]?.closesTab && item.duplicateIds.length > 0;
}

// "Verschwunden" gilt nur fuer unentschiedene Items (state 'open') - eine
// Entscheidung schuetzt vor dem Verschwinden-Signal (siehe mergeScan in
// lib/items.mjs). Das state==='open'-Kriterium hier zusaetzlich zum bereits
// serverseitig aufgeraeumten missingSince ist bewusst redundant: bestehende
// items.json-Bestaende koennen bis zum naechsten Scan noch missingSince auf
// einem laengst entschiedenen Item stehen haben (unter der alten Regel
// gesetzt) - ohne diese Absicherung wuerde ein solches Item bis dahin
// weiterhin faelschlich in "Verschwunden" auftauchen.
function partition() {
  return {
    snoozedItems: inventory.filter(isSnoozed),
    pendingItems: inventory.filter((i) => isPending(i) && !isSnoozed(i)),
    pcItems: inventory.filter((i) => isPcDone(i) && !isSnoozed(i)),
    missingItems: inventory.filter((i) => i.missingSince && i.state === 'open' && !isSnoozed(i)),
    listable: inventory.filter(
      (i) => (i.state === 'open' || i.state === 'keep') && !i.missingSince && !isSnoozed(i)
    ),
  };
}

const CROSS_TRAY_VIEW_IDS = ['triage', 'pending', 'pc', 'snoozed', 'missing'];

// Runde-3-Befund #12: die Textsuche galt bisher nur je Ablage - ein
// bestimmter Tab liess sich nur finden, indem man den Suchbegriff durch bis
// zu 5 Ablagen einzeln durchprobiert. Eine vollstaendige bestandsweite
// Suchansicht waere ein groesserer Umbau fuer diesen schmalen Anwendungsfall
// ("wo liegt mein Tab gerade") - stattdessen ein Hinweis unter dem Suchfeld,
// der zeigt, wo SONST noch etwas passt, mit einem Klick dorthin (Suchbegriff
// bleibt erhalten, da filterText modulweit ist). Nur matchesFilter (Text),
// nicht State-/Domain-Filter: die Frage ist "wo ist mein Tab", nicht "was
// zeigt meine aktuelle Feineinstellung in einer anderen Ablage".
function renderCrossTrayHint(p) {
  if (!filterText.trim()) {
    crossTrayHintEl.hidden = true;
    return;
  }
  const setsByView = { triage: p.listable, pending: p.pendingItems, pc: p.pcItems, snoozed: p.snoozedItems, missing: p.missingItems };
  const hits = CROSS_TRAY_VIEW_IDS.filter((id) => id !== activeView)
    .map((id) => ({ id, count: setsByView[id].filter(matchesFilter).length }))
    .filter((h) => h.count > 0);
  if (!hits.length) {
    crossTrayHintEl.hidden = true;
    return;
  }
  crossTrayHintEl.hidden = false;
  crossTrayHintEl.innerHTML = '';
  crossTrayHintEl.append(t('crossTrayHintPrefix'));
  hits.forEach((hit, i) => {
    if (i > 0) crossTrayHintEl.append(', ');
    const view = VIEWS.find((v) => v.id === hit.id);
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'cross-tray-link';
    link.textContent = `${t(view.labelKey)} (${hit.count})`;
    link.addEventListener('click', () => setView(hit.id));
    crossTrayHintEl.appendChild(link);
  });
}

function trayCount(viewId, p) {
  if (viewId === 'triage') return p.listable.filter((i) => i.state === 'open').length;
  if (viewId === 'pending') return p.pendingItems.length;
  if (viewId === 'pc') return p.pcItems.length;
  if (viewId === 'snoozed') return p.snoozedItems.length;
  if (viewId === 'missing') return p.missingItems.length;
  return null; // Archiv hat keine offene Menge - es ist Gedaechtnis, kein Stapel
}

// Faelligkeit war bisher nur ein einmaliger Toast beim Start
// (checkDueSnoozeBanner) - wird der weggeklickt oder wird eine Wiedervorlage
// waehrend einer offenen Sitzung faellig, gab es danach kein Signal mehr
// ausser dem Klick in genau diese Ablage. Diese Zahl bleibt dauerhaft
// sichtbar, solange etwas faellig ist.
function dueSnoozeCount(p) {
  const todayYmd = localYmd();
  return p.snoozedItems.filter((i) => i.snoozeUntil <= todayYmd).length;
}

function renderTrays(p) {
  traysEl.innerHTML = '';
  const dueCount = dueSnoozeCount(p);
  for (const view of VIEWS) {
    const count = trayCount(view.id, p);
    const btn = document.createElement('button');
    btn.className = 'tray';
    btn.type = 'button';
    btn.setAttribute('aria-selected', String(view.id === activeView));
    if (view.accent) btn.dataset.accent = view.accent;
    if (count === 0) btn.dataset.empty = 'true';
    btn.append(t(view.labelKey));
    if (count != null) {
      const c = document.createElement('span');
      c.className = 'tray-count';
      c.textContent = String(count);
      btn.appendChild(c);
    }
    if (view.id === 'snoozed' && dueCount > 0) {
      const due = document.createElement('span');
      due.className = 'tray-due';
      due.textContent = String(dueCount);
      due.title = dueCount === 1 ? t('dueSnoozeOne') : t('dueSnoozeMany', { n: dueCount });
      btn.appendChild(due);
    }
    btn.addEventListener('click', () => setView(view.id));
    traysEl.appendChild(btn);
  }
}

function setView(id) {
  activeView = id;
  // codemouseai-Review auf PR #14: focusedKey ueberlebte einen Ablagenwechsel
  // unveraendert. Ohne das haette B/P/A/V nach einem Wechsel z.B. ins Archiv
  // weiterhin auf der zuletzt fokussierten Sichten-Zeile geschrieben - eine
  // unsichtbare Zustandsaenderung, ausgeloest aus einer Ablage ohne
  // Entscheidungsknoepfe.
  focusedKey = null;
  // Gleicher Grund wie beim focusedKey-Reset direkt darueber: die
  // Auswahlleiste zeigt je Ablage unterschiedliche Aktionen (siehe
  // renderSelectionBar). Eine Auswahl, die einen Ablagenwechsel ueberlebt,
  // koennte sonst Items aus Sichten UND "Am PC" gleichzeitig enthalten -
  // fuer welche Aktionsleiste waere dann unklar, was "richtig" ist.
  selectedKeys.clear();
  for (const view of VIEWS) {
    document.getElementById(`view-${view.id}`).hidden = view.id !== id;
  }
  // Die Werkzeugleiste gehoert zur Ansicht: das Archiv-Suchfeld stand vorher
  // dauerhaft neben dem Listenfilter - zwei fast identische Textfelder
  // nebeneinander, die Verwechslung war eingebaut. Jetzt sieht man immer nur
  // das Feld, das zur aktuellen Ablage gehoert.
  for (const bar of document.querySelectorAll('.workbar-view')) {
    bar.hidden = !bar.dataset.for.split(' ').includes(id);
  }
  render();
  if (id === 'archive') {
    document.getElementById('archiveSearchInput').focus();
    // Vorschlag 4: beim Betreten sofort blaettern/erneut suchen statt der
    // alten "Wonach suchst du?"-Aufforderung - deckt auch den Fall ab, dass
    // seit dem letzten Besuch etwas Neues archiviert wurde (z.B. per "Am
    // PC"-Erledigt-Kuerzel).
    runArchiveSearch(document.getElementById('archiveSearchInput').value);
  }
  if (id === 'pending') refreshPendingHealth();
}

function render() {
  const p = partition();
  renderTrays(p);
  renderPendingView(p.pendingItems);
  renderPcView(p.pcItems);
  renderSnoozedView(p.snoozedItems);
  renderMissingView(p.missingItems);
  renderCrossTrayHint(p);

  const listable = p.listable;
  // Die Filter-Seitenleiste zeigt jetzt in jeder Ablage deren eigene Zustands-
  // /Domainoptionen, statt immer die aus Sichten - sonst stuenden dort Domains,
  // die z.B. in "Am PC" gar nicht vorkommen.
  const activeItemsById = {
    triage: listable,
    pending: p.pendingItems,
    pc: p.pcItems,
    snoozed: p.snoozedItems,
    missing: p.missingItems,
  };
  renderFilterSidebar(activeItemsById[activeView] || listable);
  renderSelectionBar();
  const filtered = listable.filter(matchesFilter).filter(matchesStateFilter).filter(matchesDomainFilter);
  const groups = groupByDomain(filtered);
  appEl.innerHTML = '';

  if (!inventory.length) {
    keyboardHint.textContent = '';
    renderEmptyState(appEl, t('inventoryEmptyTitle'), t('inventoryEmptyBody'));
    renderSortStrip();
    return;
  }

  if (!listable.length) {
    keyboardHint.textContent = '';
    renderEmptyState(appEl, t('allDecidedTitle'), t('allDecidedBody'));
    renderSortStrip();
    return;
  }

  if (!filtered.length) {
    keyboardHint.textContent = '';
    // filterText kommt direkt aus dem Eingabefeld - roh in innerHTML waere
    // das ein reflektierter XSS-Sink. renderEmptyState setzt textContent.
    const body = filterText
      ? t('noMatchFilterTextBody', { filterText })
      : t('noMatchFilterStateBody');
    renderEmptyState(appEl, t('noFilterMatchTitle'), body);
    renderSortStrip();
    return;
  }

  keyboardHint.textContent = t('keyboardHintText');

  const selectAllToggle = document.createElement('label');
  selectAllToggle.className = 'select-all-toggle';
  selectAllToggle.appendChild(makeSelectAllCheckbox(filtered.map((i) => i.normalizedUrl)));
  selectAllToggle.append(t('selectAllVisibleLabel'));
  appEl.appendChild(selectAllToggle);

  groups.forEach(([domain, items], groupIndex) => {
    const group = document.createElement('div');
    group.id = `dom-${groupIndex}`;
    group.className = 'domain-group' + (collapsedDomains.has(domain) ? ' collapsed' : '');

    const header = document.createElement('div');
    header.className = 'domain-header';

    const groupKeys = items.map((i) => i.normalizedUrl);
    const selectedInGroup = groupKeys.filter((k) => selectedKeys.has(k)).length;
    const groupCb = document.createElement('input');
    groupCb.type = 'checkbox';
    groupCb.className = 'group-select';
    groupCb.title = t('selectGroupTitle');
    groupCb.checked = selectedInGroup > 0 && selectedInGroup === groupKeys.length;
    groupCb.indeterminate = selectedInGroup > 0 && selectedInGroup < groupKeys.length;
    groupCb.addEventListener('click', (e) => e.stopPropagation());
    groupCb.addEventListener('change', () => {
      for (const k of groupKeys) (groupCb.checked ? selectedKeys.add(k) : selectedKeys.delete(k));
      render();
    });
    header.appendChild(groupCb);

    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '▾';
    const favicon = document.createElement('img');
    favicon.className = 'favicon';
    if (isSafeFaviconDomain(domain)) favicon.src = `https://${domain}/favicon.ico`;
    favicon.alt = '';
    favicon.addEventListener('error', () => favicon.remove());
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = domain;
    const decidedCount = items.filter((i) => i.state !== 'open').length;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = decidedCount ? `${decidedCount}/${items.length}` : `${items.length}`;
    if (decidedCount === items.length) count.classList.add('decided');

    header.appendChild(chevron);
    header.appendChild(favicon);
    header.appendChild(name);
    header.appendChild(count);
    header.addEventListener('click', () => {
      if (collapsedDomains.has(domain)) collapsedDomains.delete(domain);
      else collapsedDomains.add(domain);
      render();
    });

    const actions = document.createElement('div');
    actions.className = 'group-actions';
    for (const d of DECISIONS) {
      const btn = document.createElement('button');
      btn.textContent = t('allPrefix') + decisionLabel(d.id);
      btn.title = `${decisionLabel(d.id)} — ${decisionOutcome(d.id)}`;
      btn.addEventListener('click', (e) => { e.stopPropagation(); setDomainDecision(items, d.id); });
      actions.appendChild(btn);
    }
    header.appendChild(actions);
    group.appendChild(header);

    const rows = document.createElement('div');
    rows.className = 'domain-rows';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'tab-row' + (item.state !== 'open' ? ` decision-${item.state}` : '');
      row.dataset.key = item.normalizedUrl;
      row.tabIndex = 0;

      const selectCb = document.createElement('input');
      selectCb.type = 'checkbox';
      selectCb.className = 'row-select';
      selectCb.checked = selectedKeys.has(item.normalizedUrl);
      selectCb.addEventListener('click', (e) => e.stopPropagation());
      selectCb.addEventListener('change', () => {
        if (selectCb.checked) selectedKeys.add(item.normalizedUrl);
        else selectedKeys.delete(item.normalizedUrl);
        render();
      });
      row.appendChild(selectCb);

      const swatch = document.createElement('span');
      swatch.className = 'swatch';

      row.appendChild(swatch);
      row.appendChild(renderTitleBlock(item));

      if (item.duplicateCount > 1) {
        const badge = document.createElement('span');
        badge.className = 'dup-badge';
        badge.textContent = `${item.duplicateCount}×`;
        row.appendChild(badge);
      }

      row.appendChild(
        makeRowActions(
          makeCopyButton(item),
          makeSnoozeSlot(item),
          makeDecisionButtons(item.normalizedUrl, item.state, (d) => setState(item.normalizedUrl, d))
        )
      );

      rows.appendChild(row);
    }
    group.appendChild(rows);
    appEl.appendChild(group);
  });

  renderSortStrip();
}

// "Aktuelle Zeile" fuer Tastaturkuerzel tracken - unabhaengig davon, ob per
// Maus (auch auf einen Decision-Button, der stopPropagation ruft - deshalb
// Capture-Phase, die vor jedem stopPropagation im Kind laeuft) oder per
// echter Tab-Fokussierung (focusin, blubbert im Gegensatz zu focus) erreicht.
// Auf #app-main statt nur auf der Sichtliste, damit die Kuerzel auch in den
// anderen Ablagen greifen (z.B. W auf einem verschwundenen Tab).
appMain.addEventListener('click', (e) => {
  const row = e.target.closest('.tab-row');
  if (row) focusedKey = row.dataset.key;
}, true);
appMain.addEventListener('focusin', (e) => {
  const row = e.target.closest('.tab-row');
  if (row) focusedKey = row.dataset.key;
});

// Tastaturkuerzel: B/P/A/V entscheidet die fokussierte Zeile, W stellt sie
// zurueck, Pfeiltasten wandern.
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const key = e.key.toLowerCase();
  // Zweite Absicherung neben dem focusedKey-Reset in setView(): nur die
  // beiden Ablagen mit sichtbaren Entscheidungsknoepfen duerfen B/P/A/V
  // ueberhaupt auswerten (renderPcView/renderSnoozedView/Archiv zeigen keine).
  const canDecide = activeView === 'triage' || activeView === 'missing';
  // Codemouse-Review PR #66: KEYMAP kommt unveraendert aus decisions.mjs (der
  // volle, ungefilterte Satz) - anders als DECISIONS, das applyBoardVisibility()
  // beim Laden auf 'board' kuerzt, wenn Bookmarks nicht installiert ist. Ohne
  // diese Pruefung waere die Taste O weiter aktiv, obwohl die zugehoerige
  // Kachel gar nicht angezeigt wird. BY_ID bleibt bewusst UNGEFILTERT (siehe
  // Zeile ~2284 BY_ID[item.state]?.closesTab) - ein Item, das VOR einer
  // Bookmarks-Deinstallation schon im Zustand 'board' war, muss weiterhin
  // korrekt als "schliesst den Tab" erkannt werden. Nur das AUSLOESEN einer
  // NEUEN, aktuell verborgenen Entscheidung wird hier verhindert.
  const decisionId = KEYMAP[key];
  if (canDecide && decisionId && focusedKey && DECISIONS.some((d) => d.id === decisionId)) {
    e.preventDefault();
    setState(focusedKey, decisionId);
    return;
  }
  // "Am PC" hat keine B/P/A/V-Entscheidungsknoepfe (die Entscheidung ist ja
  // bereits gefallen), aber Erledigt/Zurueck aufs Handy - bislang nur per
  // Maus erreichbar, obwohl Pfeiltasten-Navigation hier laengst funktioniert
  // (siehe ArrowDown/Up unten). 283 von 295 Eintraegen im echten Bestand
  // liegen in genau dieser Ablage.
  if (activeView === 'pc' && focusedKey) {
    const item = inventory.find((i) => i.normalizedUrl === focusedKey);
    if (item && key === 'd') { e.preventDefault(); pcDone(item); return; }
    if (item && key === 'r') { e.preventDefault(); pcReturn(item); return; }
  }
  // Runde-3-Befund #18: Tastaturbedienung deckte nur "Sichten"/"Verschwunden"
  // (B/P/A/V) und "Am PC" (D/R) ab - "Wiedervorlage" hatte trotz
  // funktionierender Pfeiltasten-Navigation keine einzige Aktionstaste.
  if (activeView === 'snoozed' && focusedKey) {
    const item = inventory.find((i) => i.normalizedUrl === focusedKey);
    if (item && key === 's') { e.preventDefault(); setSnooze(item, null); return; }
  }
  if (key === 'w' && focusedKey) {
    const slot = document.querySelector(`.tab-row[data-key="${CSS.escape(focusedKey)}"] .snooze-slot`);
    if (slot) {
      e.preventDefault();
      openSnoozeMenu(slot, inventory.find((i) => i.normalizedUrl === focusedKey));
    }
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const rows = [...document.querySelectorAll(`#view-${activeView} .tab-row`)];
    const idx = rows.findIndex((r) => r.dataset.key === focusedKey);
    const next = e.key === 'ArrowDown' ? rows[idx + 1] : rows[idx - 1];
    if (next) { e.preventDefault(); next.focus(); }
  }
});

// NDJSON-Zeilen einzeln parsen und an onEvent geben - von runStep() fuer
// jeden der beiden Uebertragen-Schritte (schliessen/oeffnen) genutzt.
async function streamNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line));
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

// Ein Schritt einer Uebertragen-Operation (schliessen ODER oeffnen). Wirft
// bei einer Fehlerantwort, sonst { total, failed, archivedCount } aus dem
// abschliessenden "done"-Event. body optional (bulkPcReturn braucht die
// ausgewaehlten normalizedUrls, runTransfer weiterhin keinen Body).
//
// Runde-3-Befund #5: signal an fetch() durchgereicht, onCancel bei JEDEM
// internen setProgress()-Aufruf mitgegeben - sonst wuerde schon das erste
// "start"/"progress"-Ereignis den Abbrechen-Knopf wieder verstecken (siehe
// setProgress(), das onCancel bei jedem Aufruf ersetzt).
async function runStep(url, label, body, { signal, onCancel } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    signal,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    // Fehlerantworten (z.B. CSRF-Ablehnung, 500) sind einzelnes JSON ohne
    // abschliessendes Newline, kein NDJSON-Stream - sonst wuerde die letzte
    // Zeile unten stillschweigend verworfen und die Operation wirkt
    // faelschlich abgeschlossen.
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* Antwort kein JSON */ }
    throw new Error(msg);
  }
  let total = 0;
  let failed = 0;
  let archivedCount = 0;
  let boardForward = null;
  await streamNdjson(res, (evt) => {
    if (evt.phase === 'start') {
      total = evt.total;
      setProgress(true, { label, done: 0, total, onCancel });
      if (evt.backupFile) toast(t('backupSavedPrefix') + evt.backupFile);
    } else if (evt.phase === 'progress') {
      setProgress(true, { label, done: evt.done, total: evt.total, onCancel });
    } else if (evt.phase === 'done') {
      failed = evt.results.filter((r) => r.success === false).length;
      archivedCount = evt.archivedCount || 0;
      boardForward = evt.boardForward || null;
    } else if (evt.phase === 'error') {
      // Runde-3-Befund #1: hier nur zu toasten und weiterzulaufen liess
      // runStep() normal zurueckkehren - der Aufrufer sah `total` aus dem
      // fruehen "start"-Ereignis und `failed: 0` (kein "done" kam je an) und
      // meldete faelschlich Erfolg, obendrein NACH diesem Fehler-Toast. Jeder
      // Aufrufer von runStep() hat bereits einen eigenen catch mit derselben
      // Setup-Pruefen-Aktion (runTransfer, bulkPcReturn) - kein Toast hier,
      // sonst doppelt.
      throw new Error(evt.message);
    }
  });
  // Eigener, sofortiger Toast direkt hier in runStep() statt erst im
  // Rueckgabewert von runTransfer() ausgewertet: boardForward existiert nur
  // im 'done'-Ereignis von /api/close-decided, andere runStep()-Aufrufer
  // (z.B. /api/restore, /api/pc/bulk-return) liefern es einfach nicht mit -
  // die Bedingung unten greift dort automatisch nicht. Nur bei tatsaechlich
  // versuchten Board-Weiterleitungen - sonst wuerde jeder normale "Auf Handy
  // uebertragen"-Vorgang ohne Board-Entscheidungen einen leeren Toast zeigen.
  if (boardForward?.attempted) {
    if (boardForward.ok) toast(t('boardForwardOkToast', { n: boardForward.count }));
    else toast(t('boardForwardFailedToast'), { error: true });
  }
  return { total, failed, archivedCount };
}

// "Auf Handy übertragen" fasst die beiden frueheren Einzelknoepfe (Behaltene
// oeffnen / Vorgemerkte schliessen) zu einem Schritt zusammen - der Nutzer
// entscheidet einmal in Sichten, "uebertragen" erledigt am Handy alles
// Faellige auf einmal statt zweimal fragen zu muessen.
async function runTransfer() {
  const btn = document.getElementById('transferBtn');
  if (!(await showConfirmDialog(t('transferConfirm')))) return;
  btn.disabled = true;
  // Runde-3-Befund #5: EIN Controller fuer beide Schritte (schliessen UND
  // oeffnen) - der Abbrechen-Knopf soll den ganzen "Uebertragen"-Vorgang
  // stoppen, egal in welchem der zwei Schritte er gedrueckt wird. abort()
  // waehrend Schritt 1 laesst runStep() fuer Schritt 2 gar nicht erst
  // starten (die zweite fetch() sieht sofort ein bereits abgebrochenes
  // Signal).
  const controller = new AbortController();
  const opts = { signal: controller.signal, onCancel: () => controller.abort() };
  setProgress(true, { label: t('closingTabsLabel'), done: 0, total: 0, onCancel: opts.onCancel });
  try {
    const closeResult = await runStep('/api/close-decided', t('closingTabsLabel'), undefined, opts);
    setProgress(true, { label: t('openingTabsLabel'), done: 0, total: 0, onCancel: opts.onCancel });
    const openResult = await runStep('/api/restore', t('openingTabsLabel'), undefined, opts);
    setProgress(false);
    const parts = [];
    if (closeResult.total) parts.push(t('closedCountText', { n: closeResult.total }) + (closeResult.failed ? t('failedSuffixText', { n: closeResult.failed }) : ''));
    if (openResult.total) parts.push(t('openedCountText', { n: openResult.total }) + (openResult.failed ? t('failedSuffixText', { n: openResult.failed }) : ''));
    if (closeResult.archivedCount) parts.push(t('archivedExtraText', { n: closeResult.archivedCount }));
    toast(parts.length ? parts.join(' · ') : t('nothingToTransfer'), {
      error: closeResult.failed > 0 || openResult.failed > 0,
    });
  } catch (e) {
    setProgress(false);
    if (isAbortError(e)) {
      toast(t('operationCancelledToast'));
    } else {
      toast(t('transferFailedPrefix') + friendlyFetchError(e), {
        error: true,
        actionLabel: t('checkSetupAction'),
        onAction: checkAndOpenWizard,
      });
    }
  } finally {
    // Wie bulkPcReturn: auch nach einem Fehler neu laden, nicht nur beim
    // Erfolg - der erste der beiden Schritte kann bereits Tabs geschlossen
    // und archiviert haben, bevor der zweite (oeffnen) mitten drin
    // abbricht. Ohne das zeigte die Oberflaeche bis zum naechsten Scan
    // einen Stand, der nicht mehr dem echten Bestand entsprach.
    await loadInventory();
    btn.disabled = false;
    updateTransferBtnState();
  }
}

// rAF-Coalescing statt Debounce: render() baut bei jedem Tastendruck im
// Filter das komplette DOM neu auf (~250 Zeilen). Debounce wuerde spuerbare
// Eingabeverzoegerung hinzufuegen, um etwas zu loesen, das der Browser
// zwischen zwei Frames ohnehin gratis erledigt - mehrere Aenderungen
// innerhalb eines Frames sammeln sich zu einem einzigen echten Rebuild.
let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    render();
  });
}

document.getElementById('scanBtn').addEventListener('click', scan);
document.getElementById('filterInput').addEventListener('input', (e) => {
  filterText = e.target.value;
  scheduleRender();
});
document.getElementById('archiveSearchInput').addEventListener('input', (e) => scheduleArchiveSearch(e.target.value));
document.getElementById('archiveIncludeDropped').addEventListener('change', () =>
  runArchiveSearch(document.getElementById('archiveSearchInput').value)
);
document.querySelectorAll('#themeSwitch button').forEach((btn) => {
  btn.addEventListener('click', () => {
    localStorage.setItem('theme', btn.dataset.themeValue);
    applyTheme(btn.dataset.themeValue);
  });
});

function applySortModeButtons() {
  document.querySelectorAll('#sortModeSwitch button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sortValue === domainSortMode);
  });
}
applySortModeButtons();
document.querySelectorAll('#sortModeSwitch button').forEach((btn) => {
  btn.addEventListener('click', () => {
    domainSortMode = btn.dataset.sortValue;
    localStorage.setItem('domainSortMode', domainSortMode);
    applySortModeButtons();
    render();
  });
});

document.getElementById('setupBtn').addEventListener('click', () => openWizard(0));
document.getElementById('quitBtn').addEventListener('click', async () => {
  if (!(await showConfirmDialog(t('quitConfirm')))) return;
  try {
    await fetch('/api/shutdown', { method: 'POST' });
  } catch {
    // Server ist bereits weg (Shutdown laeuft, bevor die Antwort ankommt) - kein Fehlerfall
  }
  // Schliesst NUR das eigene App-Fenster (Chrome erlaubt das fuer per --app
  // geoeffnete Fenster) - der Server-Prozess selbst beendet sich schon
  // eigenstaendig ueber den obigen /api/shutdown-Aufruf.
  window.close();
});

// Umschalter bleibt versteckt, solange nur ein Geraet (oder gar keins)
// verbunden ist - der uebliche Fall braucht keinen zusaetzlichen Bedienschritt.
// "eine Session zur Zeit" (siehe server.mjs) heisst auch: Auswahl gilt nur bis
// zum naechsten Neustart, hier also einfach den zuletzt bekannten Stand vom
// Server abfragen statt selbst etwas zu merken.
async function loadDevices() {
  try {
    const res = await fetch('/api/devices', { method: 'POST' });
    if (!res.ok) throw new Error();
    const { devices, active } = await res.json();
    devicesCache = devices;
    const show = devices.length > 1;
    deviceSwitchEl.hidden = !show;
    deviceRenameBtn.hidden = !show;
    if (!show) return;
    deviceSwitchEl.innerHTML = '';
    for (const d of devices) {
      const opt = document.createElement('option');
      opt.value = d.serial;
      opt.textContent = d.label || d.model || d.serial;
      opt.selected = d.serial === active;
      deviceSwitchEl.appendChild(opt);
    }
  } catch {
    // Kein adb/kein Geraet erreichbar - Umschalter bleibt einfach versteckt,
    // kein Blocker fuer den Rest der Seite (gleiches Muster wie maybeAutoOpenWizard).
    deviceSwitchEl.hidden = true;
    deviceRenameBtn.hidden = true;
  }
}

deviceSwitchEl.addEventListener('change', async () => {
  try {
    const res = await fetch('/api/devices/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial: deviceSwitchEl.value }),
    });
    if (!res.ok) throw new Error((await res.json()).error || t('genericFailed'));
    toast(t('deviceSwitchedToast'));
    await loadInventory();
  } catch (e) {
    toast(t('deviceSwitchFailedPrefix') + friendlyFetchError(e), { error: true });
  }
});

deviceRenameBtn.addEventListener('click', async () => {
  const serial = deviceSwitchEl.value;
  const current = devicesCache.find((d) => d.serial === serial);
  const label = await showConfirmDialog(t('deviceRenamePrompt'), { withInput: true, defaultValue: current?.label || '' });
  if (label === null) return; // Dialog abgebrochen
  try {
    const res = await fetch('/api/devices/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial, label }),
    });
    if (!res.ok) throw new Error((await res.json()).error || t('genericFailed'));
    await loadDevices();
  } catch (e) {
    toast(t('deviceRenameFailedPrefix') + friendlyFetchError(e), { error: true });
  }
});

// Oeffnet automatisch, wenn die Einrichtung noch nie abgeschlossen (oder
// bewusst uebersprungen) wurde - Ueberspringen zaehlt als abgeschlossen,
// damit hier kein Noergeln bei jedem Laden entsteht.
async function maybeAutoOpenWizard() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    if (!settings.setupCompletedAt) openWizard(0);
  } catch {
    // Einstellungen nicht ladbar - kein Blocker fuer den Rest der Seite
  }
}

// "Banner beim Oeffnen bei Faelligem": einmalig beim Start pruefen, nicht bei
// jedem loadInventory()-Aufruf (sonst wuerde z.B. jeder Scan erneut nerven).
function checkDueSnoozeBanner() {
  const todayYmd = localYmd();
  const dueCount = inventory.filter((i) => i.snoozeUntil && i.snoozeUntil <= todayYmd).length;
  if (!dueCount) return;
  toast(dueCount === 1 ? t('dueSnoozeOne') : t('dueSnoozeMany', { n: dueCount }), {
    sticky: true,
    actionLabel: t('showAction'),
    onAction: () => setView('snoozed'),
  });
}

// partition() (und damit "faellig/ueberfaellig") laeuft nur bei render() -
// ein ueber Mitternacht offen gelassenes Fenster wuerde sonst erst beim
// naechsten Klick bemerken, dass eine Wiedervorlage faellig geworden ist.
function scheduleMidnightRerender() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => {
    render();
    scheduleMidnightRerender();
  }, nextMidnight - now);
}

// Filtert DECISIONS auf 'board', BEVOR irgendetwas damit rendert - eine
// eigene, fruehe Anfrage statt auf maybeAutoOpenWizard()s spaeteren
// /api/settings-Aufruf zu warten (der laeuft parallel zu renderLegend() und
// wuerde die fuenfte Kachel sonst kurz aufblitzen lassen, bevor sie beim
// naechsten Render wieder verschwindet).
async function applyBoardVisibility() {
  try {
    const settings = await fetch('/api/settings').then((r) => r.json());
    if (!settings.showBoardDecision) DECISIONS = ALL_DECISIONS.filter((d) => d.id !== 'board');
  } catch {
    // Einstellungen nicht ladbar - Standard-Vokabular (inkl. Board) bleibt
    // bestehen, kein Blocker fuer den Rest der Seite.
  }
}

(async () => {
  await applyBoardVisibility();
  renderLegend();
  renderSortStripSkeleton();
  setView('triage');
  loadInventory().then(checkDueSnoozeBanner);
  loadDevices();
  maybeAutoOpenWizard();
  scheduleMidnightRerender();
  // Runde-3-Befund #11: einmalige Pruefung beim Laden, damit der
  // Verbindungsstatus im Header auch dann einen Wert hat, wenn "Vorgemerkt"
  // in dieser Sitzung nie besucht wird.
  refreshPendingHealth();
})();
