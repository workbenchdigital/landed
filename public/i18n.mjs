// Client-only i18n - bewusst NICHT unter shared/, das wird auch von server.mjs
// als Node-Modul importiert (localStorage/navigator gibt es dort nicht).
// Mirrort das Theme-Umschalter-Muster (siehe app.js applyTheme): 'de'/'en'/
// 'auto' in localStorage, 'auto' faellt auf navigator.language zurueck.
//
// Bewusst NICHT uebersetzt (siehe Plan): serverseitige Fehlermeldungen
// (lib/errors.mjs friendlyError(), alles aus {error: "..."} von POST /api/*)
// bleiben deutsch - das ist Scope-Grenze fuer diese erste Version, kein
// Versehen.
export const STRINGS = {
  de: {
    // ---- Kopfzeile / Farbschema- und Sprachumschalter ----
    skipLink: 'Zum Inhalt springen',
    wordmarkSub: 'für Android/Chrome',
    deviceSwitchTitle: 'Aktives Gerät',
    deviceRenameBtnTitle: 'Aktives Gerät umbenennen',
    setupBtn: 'Einrichtung',
    setupBtnTitle: 'Einrichtungsassistent öffnen',
    themeLight: 'Hell',
    themeLightTitle: 'Helles Farbschema erzwingen',
    themeDark: 'Dunkel',
    themeDarkTitle: 'Dunkles Farbschema erzwingen',
    themeAuto: 'Auto',
    themeAutoTitle: 'Farbschema des Systems verwenden',
    quitBtn: 'Beenden',
    quitBtnTitle: 'Landed beenden',
    quitConfirm: 'Landed beenden?',

    // ---- Wireless-ADB-Panel (index.html, statisch) ----
    wirelessSummary: 'Drahtlose Verbindung (Opt-in, standardmäßig aus)',
    wirelessWarn:
      'Nur im eigenen, vertrauenswürdigen WLAN benutzen - nicht in Gäste-, Firmen- oder ' +
      'öffentlichen Netzen. Schalte „Wireless-Debugging" am Telefon wieder aus, sobald du ' +
      'Landed nicht mehr benutzt. Per USB bleibt die Verbindung auf das Kabel begrenzt, ' +
      'drahtlos ist sie das nicht.',
    wirelessEnableLabel: 'Drahtlose Verbindung erlauben',
    wirelessHintPre: 'Am Telefon:',
    wirelessHintCode1: 'Entwickleroptionen → Wireless-Debugging',
    wirelessHintMid: 'aktivieren. Beim ersten Mal dort',
    wirelessHintCode2: 'Gerät mit Kopplungscode koppeln',
    wirelessHintPost:
      'öffnen - IP, Port und 6-stelligen Code von diesem Dialog abtippen. Danach genügt ' +
      'die IP und der Port aus der Wireless-Debugging-Übersicht.',
    wirelessIpLabel: 'IP-Adresse',
    wirelessStepPair: 'Einmalig koppeln',
    wirelessPairPortLabel: 'Pairing-Port',
    wirelessCodeLabel: 'Code',
    wirelessPairBtn: 'Koppeln',
    wirelessStepConnect: 'Verbinden',
    wirelessPortLabel: 'Verbindungsport',
    wirelessConnectBtn: 'Verbinden',

    // ---- Einrichtungsassistent (wizard.js) ----
    wizardSkip: 'Überspringen',
    wizardNext: 'Weiter',
    wizardClose: 'Schließen',
    wizardProgress: 'Schritt {current} von {total}',
    wizardStep0Title: 'Willkommen bei Landed',
    wizardStep0Html:
      '<p>Landed liest Chrome-Tabs von deinem Android-Handy über USB aus und hilft dir, sie ' +
      'aufzuräumen - behalten, archivieren oder verwerfen.</p>' +
      '<p>Alles läuft ausschließlich lokal auf diesem PC: keine Cloud, kein Konto, keine ' +
      'Daten verlassen deinen Rechner. Die Verbindung läuft standardmäßig ausschließlich ' +
      'per USB-Kabel - drahtlos nur, wenn du es unten ausdrücklich einschaltest.</p>',
    wizardStep1Title: 'Entwickleroptionen aktivieren',
    wizardStep1Html:
      '<p>Am Telefon: <code>Einstellungen → Über das Telefon → 7× auf "Build-Nummer" ' +
      'tippen</code> (bei Samsung: <code>Einstellungen → Telefoninfo → ' +
      'Software-Informationen → Build-Nummer</code>).</p>' +
      '<p>Danach: <code>Einstellungen → System → Entwickleroptionen → USB-Debugging</code> ' +
      'aktivieren.</p>' +
      '<p class="wizard-hint">Findest du den Punkt nicht? Suche in den Einstellungen nach ' +
      '„Buildnummer".</p>',
    wizardStep2Title: 'Telefon per USB verbinden',
    wizardStep2Html: '<p>Verbinde dein Telefon jetzt per USB-Kabel mit diesem PC.</p>',
    wizardStep2LiveHint: 'Warte auf Verbindung…',
    wizardStep3Title: 'Verbindung bestätigen',
    wizardStep3Html:
      '<p>Am Telefon erscheint ein Dialog „USB-Debugging zulassen?". Antippen und ' +
      '<b>„Diesem Computer immer erlauben"</b> aktivieren, dann bestätigen.</p>' +
      '<p class="wizard-hint">Kein Dialog zu sehen? USB-Kabel kurz aus- und wieder ' +
      'einstecken.</p>',
    wizardStep3LiveHint: 'Warte auf Bestätigung…',
    wizardStep4Title: 'Chrome öffnen',
    wizardStep4Html:
      '<p>Öffne Chrome am Telefon, mindestens ein Tab sollte offen sein.</p>' +
      '<p>Empfehlung: <code>Chrome-Menü → Einstellungen → Tabs → „Alte Tabs automatisch ' +
      'schließen"</code> auf <b>„Nie"</b> stellen - sonst schließt Chrome selbst Tabs, ' +
      'bevor Landed sie sieht.</p>',
    wizardStep4LiveHint: 'Warte auf Chrome…',
    wizardStep5Title: 'Fertig!',
    wizardFinalWaiting: 'Sobald Chrome erreichbar ist, siehst du hier eine Zusammenfassung.',
    wizardFinalPatchLine: '<p>Sicherheitspatch des Telefons: <code>{patch}</code></p>',
    wizardFinalTabsFound: '<p><b>{n}</b> offene Tabs gefunden - bereit zum Einlesen.</p>',
    wizardFinalNoTabs: '<p>Chrome ist erreichbar, aktuell aber ohne offene Tabs.</p>',
    createShortcutBtn: 'Desktop-Verknüpfung anlegen',
    shortcutCreated: 'Verknüpfung angelegt: {path}',
    connectionInterrupted: 'Verbindung unterbrochen - warte auf Wiederherstellung…',
    runningStatus: 'Läuft…',
    wirelessEnabledMsg:
      'Drahtlose Verbindung erlaubt. Denk daran, Wireless-Debugging am Telefon danach ' +
      'wieder auszuschalten.',
    wirelessDisabledMsg: 'Drahtlose Verbindung ausgeschaltet - Landed nutzt wieder ausschließlich USB.',
    wirelessPairedDefault: 'Gekoppelt. Jetzt mit dem Verbindungsport verbinden.',
    wirelessConnectedDefault: 'Verbunden mit {target}.',

    // ---- Werkzeugleiste / Filter (index.html, statisch) ----
    scanBtn: 'Bestand einlesen',
    scanBtnLoading: 'Lese Bestand...',
    filterInputPlaceholder: 'Titel oder URL filtern',
    crossTrayHintPrefix: 'Auch gefunden in: ',
    sortCountLabel: 'Größte zuerst',
    sortCountTitle: 'Domains mit den meisten Tabs zuerst',
    sortAlphaLabel: 'A–Z',
    sortAlphaTitle: 'Domains alphabetisch sortieren',
    sortAgeLabel: 'Ältestes zuerst',
    sortAgeTitle: 'Älteste Entscheidung zuerst, auch innerhalb einer Domain-Gruppe',
    ageToday: 'heute entschieden',
    ageYesterday: 'seit gestern',
    ageDays: 'seit {n} Tagen',
    filterToggleBtn: 'Filter',
    filterToggleBtnTitle: 'Nach Zustand oder Quelle filtern',
    archiveSearchPlaceholder: 'Archiv durchsuchen – auch alles längst Erledigte',
    archiveIncludeDroppedLabel: 'auch Verworfene zeigen',
    filterSidebarTitle: 'Filtern',
    filterSidebarCloseTitle: 'Schließen',
    filterHeadingState: 'Zustand',
    filterHeadingSource: 'Quelle',
    filterResetBtn: 'Alle anzeigen',
    filterHiddenElsewhereNote: '+{n} weitere Quelle(n) in anderen Ablagen ausgeblendet — „Alle anzeigen" setzt alles zurück.',
    progressLabelInitial: 'Läuft...',
    progressCancelBtn: 'Abbrechen',
    metaInfoInitial: 'noch nicht eingelesen',

    // ---- Ablagen (VIEWS-Beschriftungen) ----
    viewTriage: 'Sichten',
    viewPending: 'Vorgemerkt',
    viewPc: 'Am PC',
    viewSnoozed: 'Wiedervorlage',
    viewMissing: 'Verschwunden',
    viewArchive: 'Archiv',

    // ---- Entscheidungs-Vokabular (frueher in shared/decisions.mjs) ----
    decisionKeepLabel: 'Handy + PC',
    decisionKeepStateLabel: 'auf Handy + PC',
    decisionKeepOutcome: 'Tab bleibt am Handy offen, Link bleibt hier in „Sichten"',
    decisionPcLabel: 'Nur PC',
    decisionPcStateLabel: 'nur am PC',
    decisionPcOutcome: 'Tab wird am Handy geschlossen, bleibt hier als eigene Aufgabenliste',
    decisionArchiveLabel: 'Archiv',
    decisionArchiveStateLabel: 'archiviert',
    decisionArchiveOutcome: 'Tab wird am Handy geschlossen, bleibt hier dauerhaft durchsuchbar',
    decisionDropLabel: 'Verwerfen',
    decisionDropStateLabel: 'verworfen',
    decisionDropOutcome: 'Tab wird am Handy geschlossen, bleibt hier nur zur Wiedererkennung gespeichert',
    stateOpenLabel: 'Unentschieden',
    stateOpenLegendLabel: 'offen',
    allPrefix: 'Alle: ',
    legendSummary: 'Was bewirken die vier Zustände?',
    legendSnoozeLabel: 'Wiedervorlage',
    legendSnoozeDesc: 'verschwindet bis zum gewählten Datum aus allen Listen',

    archiveKindArchived: 'archiviert',
    archiveKindDropped: 'verworfen',
    archiveKindDone: 'erledigt',

    // ---- Allgemeine Fehler-/Status-Bausteine ----
    errServerUnreachable: 'Server nicht erreichbar. Läuft er noch? Seite neu laden und erneut versuchen.',
    checkSetupAction: 'Einrichtung prüfen',
    errorPrefix: 'Fehler: ',
    genericFailed: 'Fehlgeschlagen',
    unknownError: 'unbekannter Fehler',
    saveFailedGeneric: 'Speichern fehlgeschlagen',
    searchFailedGeneric: 'Suche fehlgeschlagen',
    saveErrorPrefix: 'Fehler beim Speichern: ',
    undoAction: 'Rückgängig',
    undoFailedPrefix: 'Rückgängig machen fehlgeschlagen: ',
    copyFailedPrefix: 'Kopieren fehlgeschlagen: ',
    noteSaveFailedPrefix: 'Notiz konnte nicht gespeichert werden: ',
    snoozeSaveFailedPrefix: 'Wiedervorlage konnte nicht gespeichert werden: ',

    // ---- Scan ----
    scanToast: '{count} eindeutige URLs aus {sourceCount} Tabs eingelesen.',
    scanToastWithNew: '{count} eindeutige URLs aus {sourceCount} Tabs eingelesen, davon {newCount} neu.',
    scanFailedPrefix: 'Einlesen fehlgeschlagen: ',
    metaInfoText: '{n} Tabs · zuletzt eingelesen {date}',
    metaInfoTextWithAge: '{n} Tabs · zuletzt eingelesen {date} ({age})',
    ariaLabelTheme: 'Farbschema',
    ariaLabelInventoryStatus: 'Stand des Bestands',
    ariaLabelTrays: 'Ablagen',
    ariaLabelDomainSort: 'Domain-Sortierung',
    ariaLabelFilterSidebar: 'Nach Zustand oder Quelle filtern',
    confirmDialogCancel: 'Abbrechen',
    confirmDialogOk: 'OK',
    doneThisWeek: '{n} diese Woche abgeschlossen',

    // ---- Filter / Leerzustaende (gemeinsam) ----
    noFilterMatchTitle: 'Kein Treffer',
    selectGroupTitle: 'Alle in dieser Gruppe auswählen',
    selectAllVisibleTitle: 'Alle sichtbaren Einträge auswählen',
    selectAllVisibleLabel: 'Alle sichtbaren auswählen',

    // ---- Mehrfachauswahl-Leiste ----
    selectedCount: '{n} ausgewählt',
    copyBtn: 'Kopieren',
    asMarkdownBtn: 'Als Markdown',
    asBookmarksBtn: 'Als Lesezeichen',
    clearSelectionBtn: 'Auswahl aufheben',
    copyBtnTitle: 'Link kopieren',
    copyLinkSingle: 'Link kopiert.',
    copyLinkPlural: '{n} Links kopiert.',
    nothingToExport: 'Nichts zu exportieren.',
    exportedOne: '1 Link exportiert.',
    exportedMany: '{n} Links exportiert.',
    exportHeadingOne: '# Landed-Export — {date} (1 Link)',
    exportHeadingMany: '# Landed-Export — {date} ({n} Links)',
    bulkDecisionToast: '{n} Tabs auf „{label}" gesetzt.',

    // ---- Notiz / Wiedervorlage ----
    notePlaceholder: 'Notiz',
    seenBeforeTitle: 'War schon einmal im Archiv',
    seenBeforeTitleDetailed: 'Zuletzt {when} {kind}',
    seenBeforeToday: 'heute',
    seenBeforeYesterday: 'gestern',
    seenBeforeDaysAgo: 'vor {n} Tagen',
    snoozeSetTitle: 'Wiedervorlage {date} — zum Ändern klicken',
    snoozeSetBtnTitle: 'Wiedervorlage setzen (Taste W)',
    snoozeDateInputTitle: 'Wiedervorlage: ab diesem Datum wieder anzeigen',
    snoozeTomorrow: 'Morgen',
    snoozeNextWeek: 'Nächste Woche',
    snoozeInMonth: 'In einem Monat',
    snoozePickDate: 'Datum wählen…',
    snoozeShowNow: 'Jetzt anzeigen',
    storeAnomalyText:
      'Der Bestand konnte gerade nicht gelesen werden. Es ist nichts verloren, ' +
      'die Daten liegen unveraendert auf der Platte. Landed einmal beenden und neu ' +
      'starten. Bitte diese Zeile melden, sie hilft bei der Ursachensuche: ',
    openExternalFailedPrefix: 'Link konnte nicht geöffnet werden: ',
    storeSwitchedText:
      'Achtung: Landed arbeitet gerade mit einer ANDEREN Datenbank als beim letzten ' +
      'Start. Dein gewohnter Bestand ist nicht verloren, er liegt nur woanders. Ein ' +
      'Neustart hilft hier nicht. Nichts einlesen und nichts entscheiden, solange das ' +
      'so ist, sonst entstehen zwei getrennte Bestaende. Details: ',
    dueToday: 'heute fällig',
    overdueSince: 'überfällig seit {date}',
    dueUntil: 'bis {date}',
    dueSnoozeOne: '1 Wiedervorlage fällig.',
    dueSnoozeMany: '{n} Wiedervorlagen fällig.',
    showAction: 'Zeigen',

    // ---- "Am PC erledigen" ----
    pcSectionTitle: 'Am PC erledigen',
    pcSectionSub: 'Am Telefon geschlossen, hier noch offen.',
    pcEmptyTitle: 'Nichts offen',
    pcEmptyBody: 'Tabs, die du beim Sichten auf „Am PC" setzt, landen hier — sobald sie am Telefon geschlossen wurden.',
    openAllInBrowserBtn: 'Alle {n} im PC-Browser öffnen',
    openAllInBrowserTitle: 'Gegenstück zu „Auf Handy übertragen" - öffnet jeden sichtbaren Link hier am PC in einem neuen Tab',
    openAllInBrowserConfirm: '{n} Tabs im PC-Browser öffnen?',
    pcKeyboardHintText: '↑/↓ bewegt den Fokus · D für Erledigt · R für zurück aufs Handy',
    snoozedKeyboardHintText: '↑/↓ bewegt den Fokus · S für Jetzt anzeigen',
    pcFocusToggleLabel: 'Fokus-Modus ({n} auf einmal)',
    pcFocusHint: '{shown} von {total} — Rest ist ausgeblendet, kommt automatisch nach.',
    doneBtn: 'Erledigt',
    doneBtnTitle: 'Aus der Liste nehmen und ins Archiv übernehmen',
    returnToPhoneBtn: 'Zurück aufs Telefon',
    reopenedOnPhone: 'Wieder aufs Telefon geöffnet.',
    pcDoneToast: 'Als erledigt ins Archiv übernommen.',
    bulkDoneTitle: '{n} ausgewählte Einträge als erledigt ins Archiv übernehmen',
    bulkDoneToast: '{n} als erledigt übernommen.',
    bulkReturnTitle: '{n} ausgewählte Tabs wieder aufs Telefon öffnen',
    bulkReturnConfirm: '{n} Tabs wieder aufs Telefon öffnen?',
    bulkReturnTooManyToast: '{n} Tabs sind zu viele auf einmal (höchstens {max}). Auswahl verkleinern und erneut versuchen.',
    bulkReturnedToast: '{n} wieder aufs Telefon geöffnet.',
    bulkSnoozeTitle: 'Wiedervorlage für {n} ausgewählte Einträge setzen',
    bulkSnoozeToast: 'Wiedervorlage für {n} Einträge gesetzt.',

    // ---- Wiedervorlage-Ablage ----
    snoozedSectionSub: 'Bleibt hier, bis du sie quittierst.',
    snoozedEmptyTitle: 'Nichts zurückgestellt',
    snoozedEmptyBody: 'Mit W auf einer Zeile — oder über das Uhr-Symbol — legst du fest, wann ein Tab wieder auftauchen soll.',

    // ---- "Verschwunden" ----
    missingSectionSub: 'Beim Scan nicht mehr gefunden, noch unentschieden.',
    missingEmptyTitle: 'Alles auffindbar',
    missingEmptyBody: 'Hier landen Tabs, die beim Einlesen gefehlt haben — etwa weil sie am Telefon geschlossen wurden.',
    missingUrgent: 'seit {n} Scans weg — archivieren oder verwerfen?',
    missingSingle: 'seit 1 Scan weg',
    missingMulti: 'seit {n} Scans weg',

    // ---- "Vorgemerkt" ----
    pendingSectionSub: 'Entschieden, aber am Handy noch nicht geschlossen bzw. geöffnet.',
    pendingEmptyTitle: 'Nichts vorgemerkt',
    pendingEmptyBody: 'Entscheidungen, die den Tab am Handy schließen sollen, landen hier — bis „Auf Handy übertragen" sie tatsächlich schließt.',
    checkingConnection: 'Verbindung wird geprüft…',
    phoneConnected: 'Handy verbunden.',
    phoneNotConnected: 'Kein Handy verbunden — zum Übertragen anstecken.',
    connectionStatusUnknown: 'Verbindungsstatus unbekannt.',
    transferBtn: 'Auf Handy übertragen',
    transferBtnTitle: 'Schließt vorgemerkte Tabs und öffnet „Handy + PC"-Tabs, die dort noch fehlen',

    // ---- Archiv ----
    archiveSectionSub: 'Alles Archivierte, Verworfene und Erledigte — dauerhaft durchsuchbar.',
    archiveSearchEmptyTitle: 'Noch nichts im Archiv',
    archiveSearchEmptyBody: 'Erledigte, archivierte und verworfene Tabs landen hier, sobald du sie triagierst.',
    archiveSearchResultsSub: 'Treffer für „{query}"',
    archiveNoResultsBody: 'Zu „{query}" liegt nichts im Archiv. Ein anderer Begriff oder ein Teil der Adresse hilft oft weiter.',
    archiveSearchFailedPrefix: 'Archiv-Suche fehlgeschlagen: ',
    archiveLoadMoreBtn: 'Mehr laden',

    // ---- Hauptliste (Sichten) ----
    inventoryEmptyTitle: 'Noch nichts eingelesen',
    inventoryEmptyBody: 'Telefon per USB anschließen und auf „Bestand einlesen" klicken. Landed holt dann alle offenen Chrome-Tabs herüber.',
    allDecidedTitle: 'Alles gesichtet',
    allDecidedBody: 'Kein Tab wartet mehr auf eine Entscheidung. Die Aktionen oben schreiben sie jetzt aufs Telefon zurück.',
    noMatchFilterTextBody: 'Zu „{filterText}" passt gerade kein Tab. Filter leeren zeigt wieder alle.',
    noMatchFilterStateBody: 'Zustands- oder Domain-Filter blendet gerade alles aus. „Alle anzeigen" in der Seitenleiste setzt beide zurück.',
    keyboardHintText: '↑/↓ bewegt den Fokus · B/P/A/V entscheidet · W stellt zurück',

    // ---- Uebertragen ----
    transferConfirm: 'Vorgemerkte Tabs jetzt am Handy schließen und „Handy + PC"-Tabs dort öffnen?',
    closingTabsLabel: 'Schließe Tabs',
    openingTabsLabel: 'Öffne Tabs',
    closedCountText: '{n} geschlossen',
    openedCountText: '{n} geöffnet',
    failedSuffixText: ', {n} fehlgeschlagen',
    archivedExtraText: '{n} zusätzlich im Archiv gesichert',
    nothingToTransfer: 'Nichts zu übertragen.',
    transferFailedPrefix: 'Übertragen fehlgeschlagen: ',
    operationCancelledToast: 'Abgebrochen. Bereits Erledigtes bleibt gespeichert.',
    backupSavedPrefix: 'Backup gespeichert: ',

    // ---- Geraete ----
    deviceRenamePrompt: 'Name für dieses Gerät:',
    deviceSwitchedToast: 'Aktives Gerät gewechselt.',
    deviceSwitchFailedPrefix: 'Gerätewechsel fehlgeschlagen: ',
    deviceRenameFailedPrefix: 'Umbenennen fehlgeschlagen: ',
  },
  en: {
    skipLink: 'Skip to content',
    wordmarkSub: 'for Android/Chrome',
    deviceSwitchTitle: 'Active device',
    deviceRenameBtnTitle: 'Rename active device',
    setupBtn: 'Setup',
    setupBtnTitle: 'Open setup wizard',
    themeLight: 'Light',
    themeLightTitle: 'Force light color scheme',
    themeDark: 'Dark',
    themeDarkTitle: 'Force dark color scheme',
    themeAuto: 'Auto',
    themeAutoTitle: 'Use system color scheme',
    quitBtn: 'Quit',
    quitBtnTitle: 'Quit Landed',
    quitConfirm: 'Quit Landed?',

    wirelessSummary: 'Wireless connection (opt-in, off by default)',
    wirelessWarn:
      'Only use on your own trusted Wi-Fi - not on guest, corporate, or public networks. ' +
      'Turn "Wireless debugging" back off on the phone once you\'re done using Landed. ' +
      'Over USB the connection is limited to the cable - wireless is not.',
    wirelessEnableLabel: 'Allow wireless connection',
    wirelessHintPre: 'On the phone:',
    wirelessHintCode1: 'Developer options → Wireless debugging',
    wirelessHintMid: 'enable it. The first time, open',
    wirelessHintCode2: 'Pair device with pairing code',
    wirelessHintPost:
      'there - type in the IP, port, and 6-digit code from this dialog. After that, the ' +
      'IP and port from the wireless debugging overview are enough.',
    wirelessIpLabel: 'IP address',
    wirelessStepPair: 'Pair once',
    wirelessPairPortLabel: 'Pairing port',
    wirelessCodeLabel: 'Code',
    wirelessPairBtn: 'Pair',
    wirelessStepConnect: 'Connect',
    wirelessPortLabel: 'Connection port',
    wirelessConnectBtn: 'Connect',

    wizardSkip: 'Skip',
    wizardNext: 'Next',
    wizardClose: 'Close',
    wizardProgress: 'Step {current} of {total}',
    wizardStep0Title: 'Welcome to Landed',
    wizardStep0Html:
      '<p>Landed reads Chrome tabs from your Android phone over USB and helps you clean ' +
      'them up - keep, archive, or discard.</p>' +
      '<p>Everything runs entirely locally on this PC: no cloud, no account, no data ' +
      'leaves your machine. The connection runs exclusively over USB by default - ' +
      'wireless only if you explicitly turn it on below.</p>',
    wizardStep1Title: 'Enable developer options',
    wizardStep1Html:
      '<p>On the phone: <code>Settings → About phone → tap "Build number" 7×</code> (on ' +
      'Samsung: <code>Settings → About phone → Software information → Build number</code>).</p>' +
      '<p>Then enable <code>Settings → System → Developer options → USB debugging</code>.</p>' +
      '<p class="wizard-hint">Can\'t find it? Search Settings for "Build number".</p>',
    wizardStep2Title: 'Connect phone via USB',
    wizardStep2Html: '<p>Connect your phone to this PC with a USB cable now.</p>',
    wizardStep2LiveHint: 'Waiting for connection…',
    wizardStep3Title: 'Confirm connection',
    wizardStep3Html:
      '<p>A dialog "Allow USB debugging?" appears on the phone. Tap it, enable ' +
      '<b>"Always allow from this computer"</b>, then confirm.</p>' +
      '<p class="wizard-hint">Don\'t see a dialog? Unplug and replug the USB cable.</p>',
    wizardStep3LiveHint: 'Waiting for confirmation…',
    wizardStep4Title: 'Open Chrome',
    wizardStep4Html:
      '<p>Open Chrome on the phone, at least one tab should be open.</p>' +
      '<p>Recommended: set <code>Chrome menu → Settings → Tabs → "Auto-close old ' +
      'tabs"</code> to <b>"Never"</b> - otherwise Chrome may close tabs itself before ' +
      'Landed sees them.</p>',
    wizardStep4LiveHint: 'Waiting for Chrome…',
    wizardStep5Title: 'Done!',
    wizardFinalWaiting: "You'll see a summary here as soon as Chrome is reachable.",
    wizardFinalPatchLine: '<p>Phone security patch: <code>{patch}</code></p>',
    wizardFinalTabsFound: '<p><b>{n}</b> open tabs found - ready to scan.</p>',
    wizardFinalNoTabs: '<p>Chrome is reachable, but currently has no open tabs.</p>',
    createShortcutBtn: 'Create desktop shortcut',
    shortcutCreated: 'Shortcut created: {path}',
    connectionInterrupted: 'Connection interrupted - waiting for it to come back…',
    runningStatus: 'Running…',
    wirelessEnabledMsg: 'Wireless connection allowed. Remember to turn wireless debugging back off on the phone afterwards.',
    wirelessDisabledMsg: 'Wireless connection turned off - Landed uses USB only again.',
    wirelessPairedDefault: 'Paired. Now connect using the connection port.',
    wirelessConnectedDefault: 'Connected to {target}.',

    scanBtn: 'Scan tabs',
    scanBtnLoading: 'Scanning...',
    filterInputPlaceholder: 'Filter by title or URL',
    crossTrayHintPrefix: 'Also found in: ',
    sortCountLabel: 'Largest first',
    sortCountTitle: 'Domains with the most tabs first',
    sortAlphaLabel: 'A–Z',
    sortAlphaTitle: 'Sort domains alphabetically',
    sortAgeLabel: 'Oldest first',
    sortAgeTitle: 'Oldest decision first, including within a domain group',
    ageToday: 'decided today',
    ageYesterday: 'since yesterday',
    ageDays: 'for {n} days',
    filterToggleBtn: 'Filter',
    filterToggleBtnTitle: 'Filter by state or source',
    archiveSearchPlaceholder: 'Search archive – including everything long done',
    archiveIncludeDroppedLabel: 'also show discarded',
    filterSidebarTitle: 'Filter',
    filterSidebarCloseTitle: 'Close',
    filterHeadingState: 'State',
    filterHeadingSource: 'Source',
    filterResetBtn: 'Show all',
    filterHiddenElsewhereNote: '+{n} more source(s) hidden in other trays — "Show all" resets everything.',
    progressLabelInitial: 'Running...',
    progressCancelBtn: 'Cancel',
    metaInfoInitial: 'not scanned yet',

    viewTriage: 'Triage',
    viewPending: 'Pending',
    viewPc: 'On PC',
    viewSnoozed: 'Snoozed',
    viewMissing: 'Missing',
    viewArchive: 'Archive',

    decisionKeepLabel: 'Phone + PC',
    decisionKeepStateLabel: 'on phone + PC',
    decisionKeepOutcome: 'Tab stays open on the phone, link stays here in "Triage"',
    decisionPcLabel: 'PC only',
    decisionPcStateLabel: 'PC only',
    decisionPcOutcome: 'Tab closes on the phone, stays here as its own task list',
    decisionArchiveLabel: 'Archive',
    decisionArchiveStateLabel: 'archived',
    decisionArchiveOutcome: 'Tab closes on the phone, stays here permanently searchable',
    decisionDropLabel: 'Discard',
    decisionDropStateLabel: 'discarded',
    decisionDropOutcome: 'Tab closes on the phone, stays here only for recognition',
    stateOpenLabel: 'Undecided',
    stateOpenLegendLabel: 'open',
    allPrefix: 'All: ',
    legendSummary: 'What do the four states do?',
    legendSnoozeLabel: 'Snooze',
    legendSnoozeDesc: 'disappears from every list until the chosen date',

    archiveKindArchived: 'archived',
    archiveKindDropped: 'discarded',
    archiveKindDone: 'done',

    errServerUnreachable: 'Server unreachable. Is it still running? Reload the page and try again.',
    checkSetupAction: 'Check setup',
    errorPrefix: 'Error: ',
    genericFailed: 'Failed',
    unknownError: 'unknown error',
    saveFailedGeneric: 'Save failed',
    searchFailedGeneric: 'Search failed',
    saveErrorPrefix: 'Error while saving: ',
    undoAction: 'Undo',
    undoFailedPrefix: 'Undo failed: ',
    copyFailedPrefix: 'Copy failed: ',
    noteSaveFailedPrefix: 'Note could not be saved: ',
    snoozeSaveFailedPrefix: 'Snooze could not be saved: ',

    scanToast: '{count} unique URLs read from {sourceCount} tabs.',
    scanToastWithNew: '{count} unique URLs read from {sourceCount} tabs, {newCount} of them new.',
    scanFailedPrefix: 'Scan failed: ',
    metaInfoText: '{n} tabs · last scanned {date}',
    metaInfoTextWithAge: '{n} tabs · last scanned {date} ({age})',
    ariaLabelTheme: 'Color scheme',
    ariaLabelInventoryStatus: 'Inventory status',
    ariaLabelTrays: 'Trays',
    ariaLabelDomainSort: 'Domain sorting',
    ariaLabelFilterSidebar: 'Filter by state or source',
    confirmDialogCancel: 'Cancel',
    confirmDialogOk: 'OK',
    doneThisWeek: '{n} done this week',

    noFilterMatchTitle: 'No match',
    selectGroupTitle: 'Select everything in this group',
    selectAllVisibleTitle: 'Select all visible entries',
    selectAllVisibleLabel: 'Select all visible',

    selectedCount: '{n} selected',
    copyBtn: 'Copy',
    asMarkdownBtn: 'As Markdown',
    asBookmarksBtn: 'As bookmarks',
    clearSelectionBtn: 'Clear selection',
    copyBtnTitle: 'Copy link',
    copyLinkSingle: 'Link copied.',
    copyLinkPlural: '{n} links copied.',
    nothingToExport: 'Nothing to export.',
    exportedOne: '1 link exported.',
    exportedMany: '{n} links exported.',
    exportHeadingOne: '# Landed export — {date} (1 link)',
    exportHeadingMany: '# Landed export — {date} ({n} links)',
    bulkDecisionToast: '{n} tabs set to "{label}".',

    notePlaceholder: 'Note',
    seenBeforeTitle: 'Was already in the archive once',
    seenBeforeTitleDetailed: 'Last {kind} {when}',
    seenBeforeToday: 'today',
    seenBeforeYesterday: 'yesterday',
    seenBeforeDaysAgo: '{n} days ago',
    snoozeSetTitle: 'Snoozed until {date} — click to change',
    snoozeSetBtnTitle: 'Set snooze (key W)',
    snoozeDateInputTitle: 'Snooze: show again from this date',
    snoozeTomorrow: 'Tomorrow',
    snoozeNextWeek: 'Next week',
    snoozeInMonth: 'In a month',
    snoozePickDate: 'Pick a date…',
    snoozeShowNow: 'Show now',
    storeAnomalyText:
      'The collection could not be read just now. Nothing is lost, your data is ' +
      'still on disk unchanged. Quit Landed and start it again. Please report this ' +
      'line, it helps track down the cause: ',
    openExternalFailedPrefix: 'Could not open the link: ',
    storeSwitchedText:
      'Warning: Landed is working with a DIFFERENT database than it did on the last ' +
      'start. Your usual collection is not lost, it just lives somewhere else. ' +
      'Restarting will not help here. Do not scan and do not decide anything while ' +
      'this is the case, or you will end up with two separate collections. Details: ',
    dueToday: 'due today',
    overdueSince: 'overdue since {date}',
    dueUntil: 'until {date}',
    dueSnoozeOne: '1 snoozed item due.',
    dueSnoozeMany: '{n} snoozed items due.',
    showAction: 'Show',

    pcSectionTitle: 'To do on PC',
    pcSectionSub: 'Closed on the phone, still open here.',
    pcEmptyTitle: 'Nothing open',
    pcEmptyBody: 'Tabs you set to "On PC" while triaging land here — as soon as they\'ve been closed on the phone.',
    openAllInBrowserBtn: 'Open all {n} in PC browser',
    openAllInBrowserTitle: 'Counterpart to "Transfer to phone" - opens every visible link here on the PC in a new tab',
    openAllInBrowserConfirm: 'Open {n} tabs in the PC browser?',
    pcKeyboardHintText: '↑/↓ moves focus · D marks done · R sends back to phone',
    snoozedKeyboardHintText: '↑/↓ moves focus · S shows it now',
    pcFocusToggleLabel: 'Focus mode ({n} at a time)',
    pcFocusHint: '{shown} of {total} — the rest is hidden, it moves up automatically.',
    doneBtn: 'Done',
    doneBtnTitle: 'Remove from the list and move to the archive',
    returnToPhoneBtn: 'Back to phone',
    reopenedOnPhone: 'Reopened on the phone.',
    pcDoneToast: 'Marked as done and archived.',
    bulkDoneTitle: 'Move {n} selected entries to the archive as done',
    bulkDoneToast: '{n} marked as done.',
    bulkReturnTitle: 'Reopen {n} selected tabs on the phone',
    bulkReturnConfirm: 'Reopen {n} tabs on the phone?',
    bulkReturnTooManyToast: '{n} tabs is too many at once (max {max}). Shrink the selection and try again.',
    bulkReturnedToast: '{n} reopened on the phone.',
    bulkSnoozeTitle: 'Snooze {n} selected entries',
    bulkSnoozeToast: 'Snoozed {n} entries.',

    snoozedSectionSub: 'Stays here until you clear it.',
    snoozedEmptyTitle: 'Nothing snoozed',
    snoozedEmptyBody: 'Press W on a row — or use the clock icon — to set when a tab should show up again.',

    missingSectionSub: 'No longer found while scanning, still undecided.',
    missingEmptyTitle: 'Everything findable',
    missingEmptyBody: 'Tabs that were missing during a scan land here — for example because they were closed on the phone.',
    missingUrgent: 'missing for {n} scans — archive or discard?',
    missingSingle: 'missing for 1 scan',
    missingMulti: 'missing for {n} scans',

    pendingSectionSub: "Decided, but not yet closed or opened on the phone.",
    pendingEmptyTitle: 'Nothing pending',
    pendingEmptyBody: 'Decisions that should close the tab on the phone land here — until "Transfer to phone" actually closes it.',
    checkingConnection: 'Checking connection…',
    phoneConnected: 'Phone connected.',
    phoneNotConnected: 'No phone connected — plug in to transfer.',
    connectionStatusUnknown: 'Connection status unknown.',
    transferBtn: 'Transfer to phone',
    transferBtnTitle: 'Closes pending tabs and opens "Phone + PC" tabs still missing there',

    archiveSectionSub: 'Everything archived, discarded, and done — permanently searchable.',
    archiveSearchEmptyTitle: 'Nothing in the archive yet',
    archiveSearchEmptyBody: 'Done, archived, and dropped tabs land here once you triage them.',
    archiveSearchResultsSub: 'Results for "{query}"',
    archiveNoResultsBody: 'Nothing in the archive for "{query}". A different term or part of the address often helps.',
    archiveSearchFailedPrefix: 'Archive search failed: ',
    archiveLoadMoreBtn: 'Load more',

    inventoryEmptyTitle: 'Nothing scanned yet',
    inventoryEmptyBody: 'Connect the phone via USB and click "Scan tabs". Landed will then pull in every open Chrome tab.',
    allDecidedTitle: 'All triaged',
    allDecidedBody: 'No tab is waiting for a decision anymore. The actions above now write them back to the phone.',
    noMatchFilterTextBody: 'No tab matches "{filterText}" right now. Clearing the filter shows everything again.',
    noMatchFilterStateBody: 'The state or source filter is currently hiding everything. "Show all" in the sidebar resets both.',
    keyboardHintText: '↑/↓ moves focus · B/P/A/V decides · W snoozes',

    transferConfirm: 'Close pending tabs on the phone now and open "Phone + PC" tabs there?',
    closingTabsLabel: 'Closing tabs',
    openingTabsLabel: 'Opening tabs',
    closedCountText: '{n} closed',
    openedCountText: '{n} opened',
    failedSuffixText: ', {n} failed',
    archivedExtraText: '{n} additionally saved to the archive',
    nothingToTransfer: 'Nothing to transfer.',
    transferFailedPrefix: 'Transfer failed: ',
    operationCancelledToast: 'Cancelled. Anything already done stays saved.',
    backupSavedPrefix: 'Backup saved: ',

    deviceRenamePrompt: 'Name for this device:',
    deviceSwitchedToast: 'Active device switched.',
    deviceSwitchFailedPrefix: 'Device switch failed: ',
    deviceRenameFailedPrefix: 'Rename failed: ',
  },
};

export function getLang() {
  const stored = localStorage.getItem('lang') || 'auto';
  if (stored === 'de' || stored === 'en') return stored;
  return navigator.language?.startsWith('de') ? 'de' : 'en';
}

export function setLang(value) {
  localStorage.setItem('lang', value);
}

// Faellt bei fehlendem Key in der aktuellen Sprache auf Deutsch zurueck, und
// falls auch das fehlt auf den Key selbst - nie crashen (siehe Theme-Switch-
// Analogie: robuste Defaults statt Fehlerzustand in der UI).
export function t(key, params) {
  const str = STRINGS[getLang()]?.[key] ?? STRINGS.de[key] ?? key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match));
}

// Runde-3-Befund #22: <html lang="de"> und mehrere aria-label blieben beim
// Sprachumschalten fest deutsch - hier ist der eine Ort, der bei jedem
// Sprachwechsel UND beim Laden laeuft (siehe app.js), also der richtige
// Platz fuer beides.
export function applyStaticTranslations() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
}
