import { DECISIONS, BY_ID, KEYMAP } from './shared/decisions.mjs';
import { openWizard, openWizardAtHint, refreshWizardLanguage } from './wizard.js';
import { t, getLang, setLang, applyStaticTranslations } from './i18n.mjs';

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

// Anzeige-Texte der vier Entscheidungen (frueher direkt in DECISIONS, siehe
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
const toastsEl = document.getElementById('toasts');
const progressPanel = document.getElementById('progressPanel');
const progressLabel = document.getElementById('progressLabel');
const progressCount = document.getElementById('progressCount');
const progressFill = document.getElementById('progressFill');
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

function toast(message, { error = false, sticky = false, actionLabel = null, onAction = null } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '') + (sticky ? ' warning' : '');
  el.textContent = message;
  if (sticky) {
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
  if (!sticky) setTimeout(() => el.remove(), actionLabel ? 8000 : 4200);
}

// fetch() wirft bei einem Netzwerk-/Verbindungsfehler (Server nicht
// erreichbar, abgestuerzt, Rechner im Schlaf) ein TypeError mit dem kryptischen
// "Failed to fetch" - im Unterschied zu unseren eigenen `throw new Error(...)`
// bei einer erhaltenen, aber fehlerhaften Serverantwort. Diese Unterscheidung
// macht daraus eine verstaendliche, umsetzbare Meldung statt Rohtext.
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

function setProgress(active, { label, done = 0, total = 0 } = {}) {
  progressPanel.classList.toggle('active', active);
  if (!active) return;
  progressLabel.textContent = label;
  progressCount.textContent = `${done}/${total}`;
  progressFill.style.transform = `scaleX(${total ? done / total : 0})`;
}

function formatMetaInfo(sourceCount, timestamp) {
  return t('metaInfoText', { n: sourceCount, date: new Date(timestamp).toLocaleString(dateLocale()) });
}

async function loadInventory() {
  const res = await fetch('/api/items');
  inventory = await res.json();
  render();
  showStoreAnomaly();
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
  if (meta) metaInfo.textContent = formatMetaInfo(meta.sourceCount, meta.timestamp);
}

async function scan() {
  const scanBtn = document.getElementById('scanBtn');
  scanBtn.disabled = true;
  scanBtn.textContent = t('scanBtnLoading');
  try {
    const res = await fetch('/api/scan', { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error || t('unknownError'));
    const data = await res.json();
    toast(t('scanToast', { count: data.count, sourceCount: data.sourceCount }));
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

function groupByDomain(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.domain)) groups.set(item.domain, []);
    groups.get(item.domain).push(item);
  }
  const entries = [...groups.entries()];
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

function renderDomainGroup(container, domain, items) {
  const group = document.createElement('div');
  group.className = 'domain-group' + (collapsedDomains.has(domain) ? ' collapsed' : '');

  const header = document.createElement('div');
  header.className = 'domain-header';
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
function renderNoFilterMatch(container) {
  renderEmptyState(container, t('noFilterMatchTitle'), t('noFilterMatchBody'));
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

// Gegenstueck zu "Auf Handy uebertragen" (oeffnet Links AM HANDY): oeffnet
// dieselben URLs stattdessen hier im PC-Browser - fuer die PC-Arbeitsliste,
// wo per Definition kein Handy-Tab mehr existiert. window.open pro Link
// (kein window.open-Array-API) - Popup-Blocker koennten bei sehr vielen
// Links auf einmal eingreifen; fuer die ueblichen wenigen "Am PC"-Eintraege
// unkritisch.
function openAllInBrowser(items) {
  for (const item of items) window.open(item.url, '_blank', 'noopener');
}

// Erscheint nur, wenn etwas ausgewaehlt ist - Sammelaktionen fuer die
// Mehrfachauswahl (siehe .row-select/.group-select in render()).
function renderSelectionBar() {
  const bar = document.getElementById('selectionBar');
  if (!bar) return;
  // Aufraeumen: Keys von Items, die den Bestand verlassen haben (archiviert,
  // verworfen und uebertragen, o.ae.), sonst zaehlt die Leiste sie ewig mit.
  for (const key of selectedKeys) {
    if (!inventory.some((i) => i.normalizedUrl === key)) selectedKeys.delete(key);
  }
  bar.innerHTML = '';
  bar.hidden = selectedKeys.size === 0;
  if (!selectedKeys.size) return;

  const selectedItems = inventory.filter((i) => selectedKeys.has(i.normalizedUrl));

  const count = document.createElement('span');
  count.className = 'selection-count';
  count.textContent = t('selectedCount', { n: selectedItems.length });
  bar.appendChild(count);

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

async function pcDone(item) {
  await flushNoteSave(item.normalizedUrl);
  try {
    const res = await fetch('/api/pc/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizedUrl: item.normalizedUrl }),
    });
    if (!res.ok) throw new Error((await res.json()).error || t('genericFailed'));
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

const filterSidebarEl = document.getElementById('filterSidebar');
const filterToggleBtn = document.getElementById('filterToggleBtn');
const filterStateListEl = document.getElementById('filterStateList');
const filterDomainListEl = document.getElementById('filterDomainList');

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

// "Das hattest du schon mal archiviert/verworfen" - kommt aus archive.jsonl,
// gesetzt vom Server bei jedem Scan (mergeScan) bzw. bei der Migration.
function renderSeenBeforeBadge(item) {
  if (!item.seenBefore) return null;
  const badge = document.createElement('span');
  badge.className = 'seen-before-badge';
  badge.textContent = '↺';
  badge.title = t('seenBeforeTitle');
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
  renderSectionHead(pcSectionEl, t('pcSectionTitle'), items.length, t('pcSectionSub'));
  if (!items.length) {
    renderEmptyState(pcSectionEl, t('pcEmptyTitle'), t('pcEmptyBody'));
    return;
  }

  // codemouseai-Review auf PR #28: der Knopf oeffnete immer alle Items,
  // auch die per Text-/Domainfilter gerade ausgeblendeten - bei aktivem
  // Filter waeren das ueberraschend mehr Tabs als sichtbar. Zaehler und
  // Aktion haengen jetzt beide an der gefilterten Menge.
  const shown = visibleItems(items);
  if (!shown.length) return renderNoFilterMatch(pcSectionEl);

  const openAllBtn = document.createElement('button');
  openAllBtn.className = 'ghost-btn';
  openAllBtn.textContent = t('openAllInBrowserBtn', { n: shown.length });
  openAllBtn.title = t('openAllInBrowserTitle');
  openAllBtn.addEventListener('click', () => openAllInBrowser(shown));
  pcSectionEl.appendChild(openAllBtn);

  for (const [domain, group] of groupByDomain(shown)) {
    const list = renderDomainGroup(pcSectionEl, domain, group);
    for (const item of group) {
      const row = document.createElement('div');
      row.className = 'tab-row';
      row.tabIndex = 0;
      row.dataset.key = item.normalizedUrl;

      const swatch = document.createElement('span');
      swatch.className = 'swatch pc';
      row.appendChild(swatch);
      row.appendChild(renderTitleBlock(item));

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
function renderSnoozedView(items) {
  snoozedSectionEl.innerHTML = '';
  renderSectionHead(snoozedSectionEl, t('viewSnoozed'), items.length, t('snoozedSectionSub'));
  if (!items.length) {
    renderEmptyState(snoozedSectionEl, t('snoozedEmptyTitle'), t('snoozedEmptyBody'));
    return;
  }

  const shown = visibleItems(items);
  if (!shown.length) return renderNoFilterMatch(snoozedSectionEl);

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
function renderMissingView(items) {
  missingSectionEl.innerHTML = '';
  renderSectionHead(missingSectionEl, t('viewMissing'), items.length, t('missingSectionSub'));
  if (!items.length) {
    renderEmptyState(missingSectionEl, t('missingEmptyTitle'), t('missingEmptyBody'));
    return;
  }

  const shown = visibleItems(items);
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

async function refreshPendingHealth() {
  const statusEl = document.getElementById('pendingHealthStatus');
  if (!statusEl) return;
  statusEl.textContent = t('checkingConnection');
  statusEl.classList.remove('urgent');
  try {
    const res = await fetch('/api/health', { method: 'POST' });
    const health = await res.json();
    pendingConnected = Boolean(health.device && health.chrome?.ok);
    statusEl.textContent = pendingConnected ? t('phoneConnected') : t('phoneNotConnected');
    statusEl.classList.toggle('urgent', !pendingConnected);
  } catch {
    pendingConnected = false;
    statusEl.textContent = t('connectionStatusUnknown');
    statusEl.classList.add('urgent');
  }
  updateTransferBtnState();
}

function renderPendingView(items) {
  pendingSectionEl.innerHTML = '';
  renderSectionHead(pendingSectionEl, t('viewPending'), items.length, t('pendingSectionSub'));

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
  const shown = visibleItems(items);
  if (!shown.length) return renderNoFilterMatch(pendingSectionEl);

  for (const [state, group] of groupByState(shown)) {
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

// Archiv-Suche: eigener Datenpfad (archive.jsonl statt items.json), aber
// dieselben Bauteile (groupByDomain, renderTitleBlock) wie die Hauptliste -
// kein zweiter Renderpfad. Ergebnisse sind Historie, keine offenen
// Entscheidungen: keine Entscheidungsknoepfe, nur Art + Datum als Hinweis.
function renderArchiveResults(results, query) {
  archiveResultsEl.innerHTML = '';

  if (!query.trim()) {
    renderSectionHead(archiveResultsEl, t('viewArchive'), null, t('archiveSectionSub'));
    renderEmptyState(archiveResultsEl, t('archiveSearchEmptyTitle'), t('archiveSearchEmptyBody'));
    return;
  }

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
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'tab-row';
      // Notiz reist seit Stufe D mit ins Archiv (lib/items.mjs) und ist
      // durchsuchbar - hier als Tooltip sichtbar, damit ein Treffer per
      // Notiztext nicht wie ein Zufallsfund wirkt.
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
      rows.appendChild(row);
    }
    group.appendChild(rows);
    archiveResultsEl.appendChild(group);
  }
}

async function runArchiveSearch(query) {
  if (!query.trim()) {
    renderArchiveResults([], '');
    return;
  }
  try {
    const includeDropped = document.getElementById('archiveIncludeDropped').checked;
    const params = new URLSearchParams({ q: query });
    if (includeDropped) params.set('includeDropped', '1');
    const res = await fetch(`/api/search?${params}`);
    if (!res.ok) throw new Error((await res.json()).error || t('searchFailedGeneric'));
    const { results } = await res.json();
    renderArchiveResults(results, query);
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

function trayCount(viewId, p) {
  if (viewId === 'triage') return p.listable.filter((i) => i.state === 'open').length;
  if (viewId === 'pending') return p.pendingItems.length;
  if (viewId === 'pc') return p.pcItems.length;
  if (viewId === 'snoozed') return p.snoozedItems.length;
  if (viewId === 'missing') return p.missingItems.length;
  return null; // Archiv hat keine offene Menge - es ist Gedaechtnis, kein Stapel
}

function renderTrays(p) {
  traysEl.innerHTML = '';
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
  if (id === 'archive') document.getElementById('archiveSearchInput').focus();
  if (id === 'pending') refreshPendingHealth();
}

function render() {
  const p = partition();
  renderTrays(p);
  renderPendingView(p.pendingItems);
  renderPcView(p.pcItems);
  renderSnoozedView(p.snoozedItems);
  renderMissingView(p.missingItems);

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
  if (canDecide && KEYMAP[key] && focusedKey) {
    e.preventDefault();
    setState(focusedKey, KEYMAP[key]);
    return;
  }
  if (key === 'w' && focusedKey) {
    const slot = document.querySelector(`.tab-row[data-key="${CSS.escape(focusedKey)}"] .snooze-slot`);
    if (slot) {
      e.preventDefault();
      openSnoozeEditor(slot, inventory.find((i) => i.normalizedUrl === focusedKey));
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
// abschliessenden "done"-Event.
async function runStep(url, label) {
  const res = await fetch(url, { method: 'POST' });
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
  await streamNdjson(res, (evt) => {
    if (evt.phase === 'start') {
      total = evt.total;
      setProgress(true, { label, done: 0, total });
      if (evt.backupFile) toast(t('backupSavedPrefix') + evt.backupFile);
    } else if (evt.phase === 'progress') {
      setProgress(true, { label, done: evt.done, total: evt.total });
    } else if (evt.phase === 'done') {
      failed = evt.results.filter((r) => r.success === false).length;
      archivedCount = evt.archivedCount || 0;
    } else if (evt.phase === 'error') {
      toast(t('errorPrefix') + evt.message, { error: true, actionLabel: t('checkSetupAction'), onAction: checkAndOpenWizard });
    }
  });
  return { total, failed, archivedCount };
}

// "Auf Handy übertragen" fasst die beiden frueheren Einzelknoepfe (Behaltene
// oeffnen / Vorgemerkte schliessen) zu einem Schritt zusammen - der Nutzer
// entscheidet einmal in Sichten, "uebertragen" erledigt am Handy alles
// Faellige auf einmal statt zweimal fragen zu muessen.
async function runTransfer() {
  const btn = document.getElementById('transferBtn');
  if (!confirm(t('transferConfirm'))) return;
  btn.disabled = true;
  setProgress(true, { label: t('closingTabsLabel'), done: 0, total: 0 });
  try {
    const closeResult = await runStep('/api/close-decided', t('closingTabsLabel'));
    setProgress(true, { label: t('openingTabsLabel'), done: 0, total: 0 });
    const openResult = await runStep('/api/restore', t('openingTabsLabel'));
    setProgress(false);
    const parts = [];
    if (closeResult.total) parts.push(t('closedCountText', { n: closeResult.total }) + (closeResult.failed ? t('failedSuffixText', { n: closeResult.failed }) : ''));
    if (openResult.total) parts.push(t('openedCountText', { n: openResult.total }) + (openResult.failed ? t('failedSuffixText', { n: openResult.failed }) : ''));
    if (closeResult.archivedCount) parts.push(t('archivedExtraText', { n: closeResult.archivedCount }));
    toast(parts.length ? parts.join(' · ') : t('nothingToTransfer'), {
      error: closeResult.failed > 0 || openResult.failed > 0,
    });
    await loadInventory();
  } catch (e) {
    toast(t('transferFailedPrefix') + friendlyFetchError(e), {
      error: true,
      actionLabel: t('checkSetupAction'),
      onAction: checkAndOpenWizard,
    });
    setProgress(false);
  } finally {
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
  if (!confirm(t('quitConfirm'))) return;
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
    await Promise.all([loadInventory(), loadScanMeta()]);
  } catch (e) {
    toast(t('deviceSwitchFailedPrefix') + friendlyFetchError(e), { error: true });
  }
});

deviceRenameBtn.addEventListener('click', async () => {
  const serial = deviceSwitchEl.value;
  const current = devicesCache.find((d) => d.serial === serial);
  const label = prompt(t('deviceRenamePrompt'), current?.label || '');
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

renderLegend();
renderSortStripSkeleton();
setView('triage');
loadInventory().then(checkDueSnoozeBanner);
loadScanMeta();
loadDevices();
maybeAutoOpenWizard();
scheduleMidnightRerender();
