// Zentrale Entscheidungs-Vokabular-Tabelle: eine Quelle fuer Server und
// Client. Server importiert sie direkt als Node-Modul, der Browser laedt
// sie als normales <script type="module">-Import - dieselbe Datei, kein
// Build-Schritt.
//
// closesTab ist der eigentliche Sinn dieser Datentabelle: sie verlagert das
// Vokabular in den Server, der bisher die Zustands-Strings 'archive'/'drop'
// fest verdrahtet hatte (server.mjs closeDecidedHandler). Ein weiterer
// Zustand braucht dadurch null Server-Aenderungen - nur einen weiteren
// Eintrag hier. (Ein fruehers archives-Flag stand hier auch, wurde aber nie
// gelesen - lib/items.mjs ARCHIVE_KIND_BY_STATE ist die einzig echte Quelle
// dafuer, welche Zustaende ins Archiv wandern.)
//
// wb-audit: das alte Vokabular (Behalten/Am PC/Archivieren/Verwerfen)
// beschrieb die Aktion, nicht das Ergebnis - fuer jemanden, der die App
// nicht selbst gebaut hat, war der Unterschied zwischen "Archivieren" und
// "Verwerfen" nicht erschliessbar (beide landen technisch im selben
// durchsuchbaren Archiv). Anzeige-Texte (label/stateLabel/outcome) lebten
// frueher direkt hier, sind fuer den Sprachumschalter aber nach i18n.mjs
// gewandert (decisionKeepLabel usw.) - diese Datei bleibt rein strukturell
// und sprachunabhaengig, DECISIONS.id ist der Schluessel dorthin.
export const DECISIONS = [
  {
    id: 'keep',
    key: 'b',
    icon: '<svg viewBox="0 0 20 16" width="20" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="1.5" width="11" height="8" rx="1"/><path d="M4.5 12.5h4M6.5 9.5v3" stroke-linecap="round"/><rect x="14" y="3.5" width="5" height="10.5" rx="1.2"/><path d="M16.5 12h.01" stroke-linecap="round"/></svg>',
    closesTab: false,
  },
  {
    id: 'phone',
    // b/p/a/v/o sind belegt - h fuer "Handy".
    key: 'h',
    // Nutzerbefund 26.10.2026: fuer "bleibt am Handy offen, soll aber NICHT
    // auf den PC" gab es keinen Zustand. 'keep' kam dem am naechsten, liess
    // den Link aber in "Sichten" stehen (siehe partition() in app.js) - die
    // Entscheidung war damit faktisch folgenlos und der Link blieb liegen.
    // Dieser Zustand ist das fehlende Gegenstueck: wie 'keep' closesTab:false
    // (der Tab am Handy wird nie angefasst), aber aus "Sichten" heraus.
    //
    // Nachtrag 26.10.2026 nach dem ersten echten Einsatz: der Zustand hatte
    // zuerst eine eigene Ablage "Nur am Handy". Die ist auf Nutzerwunsch
    // wieder entfallen - diese Links sollen am Telefon offen bleiben "und
    // sonst nichts", also auch keine Liste am PC fuellen. Sichtbar bleibt
    // nur die Zahl in der Zaehlerzeile. Folge, bewusst in Kauf genommen:
    // die Entscheidung laesst sich in der Oberflaeche nicht mehr zuruecknehmen.
    //
    // Bewusst NICHT in ARCHIVE_KIND_BY_STATE (lib/items.mjs): das Item bleibt
    // ein aktives Item, sonst wuerde der naechste Scan den am Handy weiterhin
    // offenen Tab als neu einlesen und er stuende wieder in "Sichten".
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M8 12.2h.01" stroke-linecap="round"/></svg>',
    closesTab: false,
  },
  {
    id: 'pc',
    key: 'p',
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="13" height="8.5" rx="1"/><path d="M5.5 14.5h5M8 11v3.5" stroke-linecap="round"/></svg>',
    closesTab: true,
  },
  {
    id: 'archive',
    key: 'a',
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2" width="13" height="3" rx="0.8"/><path d="M2.3 5v7.5a1 1 0 0 0 1 1h9.4a1 1 0 0 0 1-1V5"/><path d="M6.3 8h3.4" stroke-linecap="round"/></svg>',
    closesTab: true,
  },
  {
    id: 'drop',
    key: 'v',
    // wb-audit: die alte Formulierung "sonst nichts (nur im Backup-Snapshot
    // enthalten)" war schlicht falsch - drop landet wie archive im
    // durchsuchbaren Archiv (lib/items.mjs ARCHIVE_KIND_BY_STATE), nur mit
    // kind:'dropped' und in der Archivsuche per Default ausgeblendet (siehe
    // i18n.mjs decisionDropOutcome).
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3 4.5h10M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4 4.5l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6"/><path d="M6.6 7v4M9.4 7v4"/></svg>',
    closesTab: true,
  },
  {
    id: 'board',
    // b/p/a/v sind belegt - o fuer "bOard", einziger freier naheliegender
    // Buchstabe im Wort.
    key: 'o',
    // Uebergabe an LANDED Bookmarks (server.mjs closeDecidedHandler,
    // lib/bookmarksHandover.mjs): archiviert wie archive/drop (kind:'board'
    // in ARCHIVE_KIND_BY_STATE), zusaetzlich per POST an Bookmarks' Inbox
    // weitergereicht. Fail-soft - laeuft Bookmarks nicht, bleibt der Tab
    // einfach im Archiv stehen, kein Datenverlust.
    icon: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="13" height="13" rx="2"/><circle cx="8" cy="7.7" r="2.6"/><path d="M8 1.5v2.2M8 12.3v1.7"/></svg>',
    closesTab: true,
  },
];

export const BY_ID = Object.fromEntries(DECISIONS.map((d) => [d.id, d]));
export const KEYMAP = Object.fromEntries(DECISIONS.map((d) => [d.key, d.id]));

// Faellt sofort beim Laden auf statt erst beim Testen der Tastatur- oder
// Klick-Bedienung, falls ein neuer Zustand versehentlich ein Kuerzel/eine id
// doppelt vergibt.
if (new Set(DECISIONS.map((d) => d.key)).size !== DECISIONS.length) {
  throw new Error('Doppeltes Tastenkürzel in DECISIONS');
}
if (new Set(DECISIONS.map((d) => d.id)).size !== DECISIONS.length) {
  throw new Error('Doppelte id in DECISIONS');
}
