# Landed — Gestaltungsentscheidungen

Notiert, damit die Gründe nicht bei der nächsten Änderung neu erraten werden
müssen. Gilt für `public/index.html`, `public/style.css`, `public/app.js`.

## Wofür die Oberfläche da ist

**Eine Aufgabe: die Zahl der unentschiedenen Tabs auf null bringen.** Alles
andere ist nachgelagert. Nach Stufe 2–5 war das aus dem Blick geraten — die
Sichtliste stand hinter drei gleich aussehenden Kästen und war bei realem
Bestand erst nach dem ersten Scrollen erreichbar.

## Aufbau: Ablagen statt Stapel

Der Bestand durchläuft Stationen, und man ist immer nur an genau einer dran:

| Ablage | Verb | Frequenz |
|---|---|---|
| Sichten | entscheiden | ständig, Tastatur |
| Am PC | abarbeiten | eigene Sitzung, Maus |
| Wiedervorlage / Verschwunden | nachsehen | selten |
| Archiv | suchen | selten |

Vorher lagen alle gleichzeitig untereinander. Jetzt trägt jede Ablage ihre
Zahl im Reiter — man sieht, wo Arbeit wartet, ohne sie einblenden zu müssen.

Das löst nebenbei ein Problem, das wie ein Stilproblem aussah: die **zwei fast
identischen Suchfelder** nebeneinander (Listenfilter + Archivsuche) waren kein
Layout-, sondern ein Strukturfehler. Das Archiv ist eine eigene Ablage, also
hat es sein eigenes Feld — sichtbar nur dort.

## Signature: der Kontrollstreifen

Die gestapelte Anteilsleiste war schon vorher das Beste an der Oberfläche und
wurde zur Hauptsache gemacht: ganz oben, ganze Breite, Zahl vor dem Wort.

Die Restarbeit ist **schraffiert**, nicht leer — in technischen Zeichnungen
heißt Schraffur „noch nicht belegt". Die farbigen Segmente wachsen von links
darüber, bis nichts Schraffiertes mehr übrig ist. Das ist der emotionale Kern
des Werkzeugs in einem Element.

Umsetzung: Die Schraffur liegt auf der **Spur**, nicht auf einem eigenen
Segment. `app.js` skaliert Segmente per `transform: scaleX()`, was ein
Streifenmuster verzerren würde.

## Typografie: lokal, kein Webfont

- **Bahnschrift** (DIN-1451-Linie, Variable Font) — Wortmarke, Zähler, Labels
- **Segoe UI Variable** — Fließtext
- **Cascadia Mono** — URLs, Daten, Tastenkürzel

Alle drei liegen auf jedem Windows 10/11 vor. Der `@import` von Google Fonts
ist **entfernt**: eine App, die „läuft ausschließlich lokal, kein Cloud-Dienst"
verspricht, darf nicht bei jedem Laden Google kontaktieren. Nebeneffekt — die
gepackte `.exe` sieht jetzt auch offline so aus wie gestaltet; vorher fiel sie
ohne Netz stillschweigend auf Segoe UI zurück.

Bahnschrift ist der bewusste Griff daneben-am-Naheliegenden: deutsche
Beschriftungsschrift für ein deutsches Werkzeug, das aussehen soll wie ein
Gerät und nicht wie eine Website.

## Farbe

Die vier Entscheidungsfarben sind Chromes eigene Markenwerte und bleiben — sie
sind das semantische System, nicht Dekoration. Geändert wurde der **Untergrund**:
Seite grau, Arbeitsflächen weiß. Vorher war beides reines Weiß, wodurch Karten
nur an ihrer Haarlinie erkennbar waren und gestapelte Abschnitte optisch
verschwammen.

`--on-signal` ist ein eigenes Token: im Dunkelmodus ist `--signal` Googles
helle Variante (#8ab4f8), auf der Weiß nur ~1,9:1 erreicht hätte. Jetzt 8,4:1.

## Was aus der Zeile geflogen ist

**Das Datumsfeld.** Es stand dauerhaft in jeder Zeile, breiter als die vier
Entscheidungsknöpfe zusammen — die seltene Aktion hatte mehr Gewicht als die
ständige. Jetzt: schmaler Knopf, erscheint bei Zeigen/Fokus, blendet das native
Feld an Ort und Stelle ein. Taste **W** auf der fokussierten Zeile. Ist ein
Datum gesetzt, bleibt der Knopf sichtbar — dann ist es eine Eigenschaft der Zeile.

**Die „Alle: X"-Knöpfe** erscheinen erst beim Zeigen auf die Gruppenüberschrift.
Bei dreizehn Gruppen waren das über fünfzig konkurrierende Ziele im Ruhezustand.
Der Platz bleibt reserviert, damit nichts springt.

**Die Domain-Sprungleiste ist ersatzlos entfallen.** Sie wiederholte die
Gruppenüberschriften direkt darunter, das Filterfeld daneben erledigt dasselbe
schneller (drei Buchstaben tippen statt eine Chip-Reihe absuchen), und sie war
nicht sticky — also genau dort nutzlos, wo man sie gebraucht hätte. Wieder
einbauen wäre eine Handvoll Zeilen; der bessere Weg wäre dann ein mitlaufendes
Domain-Register, keine Chip-Reihe.

**Die Zustands-Legende** ist zugeklappt (`<details>`). Man liest sie einmal.

## Zu haltende Kanten

- Leerzustände sagen, wie etwas hineinkommt — nicht nur, dass nichts da ist.
- Beschriftungen benennen die Aktion, nicht die interne Kategorie: „12 Tabs
  schließen" mit Aufschlüsselung im Tooltip, nicht „12 schließen (Am PC +
  Archiviert + Verworfen)".
- Nur **eine** Warnfarbe in der Werkzeugleiste: Schließen ist das Einzige, das
  Tabs endgültig wegnimmt.
- Tastaturbedienung ist der Hauptweg beim Sichten, nicht Zugabe.

## Nachjustiert nach echter Nutzung (2026-08-10)

Erste Iteration war zu zurückhaltend. Konkretes Feedback nach Testen mit
einem realen Bestand:

- **Zeilen wirkten wie Tabellenzeilen, nicht wie einzelne Einträge.** Jetzt
  75 % Breite (`max-width` auf `.domain-group`/`.flat-list`, auf schmalen
  Fenstern wieder 100 %) plus mehr Höhe je Zeile (`padding` verdoppelt,
  Titel- und URL-Schrift leicht größer). Weniger Zeilen passen aufs
  Bildschirm, aber jede ist deutlicher als eigenständiger Eintrag lesbar.
- **Entscheidungsknöpfe wirkten wie neutrale Umrandungen, nicht wie eigene
  Schaltflächen.** Jede trägt jetzt schon im Ruhezustand die Farbe ihres
  Zustands (Rand + Beschriftung, keine Füllfläche — die bleibt der Aktiv-
  Markierung vorbehalten), dazu größer für ein klareres Klickziel.
- **Die Wiedervorlage war zu leicht zu übersehen.** Der Knopf, der vorher nur
  bei Zeigen/Fokus erschien, ist jetzt dauerhaft sichtbar mit eigenem Rahmen.
  Das ist ein bewusster Rückschritt gegenüber der ersten „ruhigen"
  Iteration — die Reduktion ging zu weit, echte Nutzung hat das gezeigt.
- **Ein Zustandsfilter fehlte.** Neu: ausklappbare Seitenleiste
  (`#filterSidebar`) mit einer Checkbox je Zustand (inkl. „Unentschieden"),
  live gezählt, in `localStorage` gemerkt. Bewusst eine Seitenleiste statt
  weiterer Knöpfe in der Werkzeugleiste — die ist schon voll. `inert` statt
  Fokus-Falle, da die App ausschließlich in Chromium läuft.

**Update (2026-08-10, zweite Runde):** Explizit gewünscht — jetzt gebaut.
`cdp.mjs` `listTabs()` versucht bei einem fehlgeschlagenen ersten Zugriff
automatisch, Chrome per `adb shell monkey -p com.android.chrome -c
android.intent.category.LAUNCHER 1` zu öffnen, wartet 1,5 s und versucht es
einmal erneut. `monkey` mit der LAUNCHER-Kategorie statt eines fest
verdrahteten Aktivitätsnamens — robuster gegen Änderungen an der
Aktivitätsklasse zwischen Chrome-Versionen/-Kanälen.

Das ersetzt „Chrome von Hand öffnen" durch „kurz automatisch aufpoppen",
nicht durch „gar nicht öffnen müssen" — das gibt CDP technisch nicht her,
der Debug-Socket existiert nur, während Chromes Prozess lebt. Schlägt auch
der zweite Versuch fehl, läuft der **ursprüngliche** Fehler unverändert
durch (nicht der des Wiederholungsversuchs) — der bestehende Hinweis
„Chrome am Telefon in den Vordergrund holen und erneut versuchen"
(`lib/errors.mjs`) bleibt als Rückfallebene aktiv, unverändert.

Bewusst nur im tatsächlichen Scan/Restore-Pfad (`lib/cdp.mjs`), nicht in der
passiven Health-Sonde (`lib/health.mjs`), die der Einrichtungsassistent alle
1,5 s abfragt — dort würde ein automatischer Launch-Versuch bei jedem Poll
Chrome wiederholt aufpoppen lassen, auch während der Nutzer noch an einem
ganz anderen Schritt arbeitet.

## Zustandsmodell auf Ergebnis statt Aktion umgestellt (2026-08-11)

Nach dem ersten echten Einsatz mit Handy: das Vokabular „Behalten / Am PC /
Archivieren / Verwerfen" beschrieb, was man tut, nicht wo der Link danach
liegt — und genau das ist die Frage beim Sichten. `archive` und `drop` waren
zudem technisch fast identisch (beide landen im durchsuchbaren Archiv), aber
sprachlich wie zwei völlig verschiedene Dinge dargestellt.

**Vokabular:** Labels heißen jetzt „Handy + PC" / „Nur PC" / „Archiv" /
„Verwerfen" — jedes sagt das Ergebnis, nicht das Verb. `outcome` (früher
`hint`, gleiche Rolle, treffenderer Name) ergänzt einen Ein-Satz-Ausblick auf
Handy UND App. Buchstaben-Kürzel auf den Knöpfen selbst erschlossen sich
niemandem, der die App nicht selbst gebaut hat — jetzt Icons (Inline-SVG,
`currentColor`), Kürzel bleiben als Tooltip + Tastaturbedienung (B/P/A/V
unverändert, um bestehende Handgriffe nicht zu brechen).

**Reiter „Vorgemerkt":** neu, zwischen Sichten und Am PC. Sichten zeigt nur
noch `open`/`keep` — eine Entscheidung, die den Tab am Handy schließen soll,
verschwindet sofort dorthin, bis „Auf Handy übertragen" sie tatsächlich
schließt (bzw. „Handy + PC"-Tabs öffnet, die dort fehlen). Ein Knopf statt
der früheren zwei separaten („Behaltene öffnen"/„Vorgemerkte schließen") —
das war ohnehin fast immer dieselbe Aktion in Folge. Verbindungsstatus
davor, Knopf deaktiviert ohne Handy statt Fehlermeldung nach dem Klick.

**Wiedervorlage ist kein fünfter Zustand**, sondern „Nur PC" + Datum
(`snoozeUntil`-Feld) — der ursprüngliche Architekturplan hatte das schon so
entschieden. Ein eigener Zustand bräuchte ein Feld für „was war es vorher"
und müsste am Stichtag in irgendetwas zurückwechseln; als Feld lässt sich
stattdessen auch eine bestehende Aufgabe vertagen, und ein „Handy + PC"-Tab
kann gleichzeitig offen bleiben UND erinnern. Das ⏰-Datumsmenü (Morgen/
Nächste Woche/Monat/wählen) ist deshalb eine eigene Aktion neben den vier
Entscheidungen, kein fünfter Button in derselben Reihe. Fällige Einträge
bleiben jetzt in der Ablage stehen, bis „Jetzt anzeigen" sie quittiert —
vorher fielen sie am Stichtag stillschweigend zurück in ihre alte Ablage.

**Verwerfen behält eine Spur:** komplett löschen hätte das bestehende
`seenBefore`-Wiedererkennungs-Badge (↺ bei erneutem Auftauchen) für genau
die Links entwertet, die am häufigsten zurückkommen. Stattdessen bleiben
verworfene Einträge gespeichert, sind in der Archivsuche aber per Default
ausgeblendet (Schalter „auch Verworfene zeigen"). Archiv = Nachschlagewerk,
Verworfen = Gedächtnis der App, kein zweites Archiv.

**Mehrfachauswahl** (Checkbox je Zeile/Gruppe) erscheint nur als schmale
Auswahl-Leiste, wenn tatsächlich etwas ausgewählt ist — dieselbe
Zurückhaltung wie beim Fortschrittsbalken, kein dauerhaft reservierter
Werkzeugleisten-Platz für eine seltene Aktion.
