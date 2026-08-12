// Uebersetzt haeufige ADB/CDP-Fehler in verstaendliche deutsche Meldungen.
// Rohe Node/child_process-Fehlermeldungen (mehrzeilige Stacktraces, interne
// ADB-Begriffe wie $ADB_VENDOR_KEYS) sind fuer einen Alltagsnutzer nicht
// selbsterklaerend - deshalb Muster erkennen, sonst generisch bleiben statt
// den technischen Dump 1:1 durchzureichen.
const PATTERNS = [
  [/device unauthorized/i, 'Das Telefon hat die USB-Debugging-Anfrage noch nicht bestätigt. Am Telefon den Dialog "Diesem Computer erlauben" bestätigen und erneut versuchen.'],
  [/no devices?\/emulators? found/i, 'Kein Gerät gefunden. USB-Kabel prüfen und sicherstellen, dass USB-Debugging aktiviert ist.'],
  [/device offline/i, 'Das Telefon reagiert nicht (offline). USB-Kabel einmal aus- und wieder einstecken.'],
  [/device '.*' not found/i, 'Das Telefon wurde getrennt. USB-Verbindung prüfen und erneut versuchen.'],
  [/ECONNREFUSED|fetch failed/i, 'Chrome antwortet auf dem Telefon nicht. Chrome am Telefon in den Vordergrund holen und erneut versuchen.'],
  [/ENOENT.*adb/i, 'adb wurde nicht gefunden. Pfad zu den Android Platform-Tools prüfen (ADB_PATH).'],
  [/nutzt ausschließlich USB/i, 'Nur drahtlos verbundene Geräte gefunden. Dieses Werkzeug unterstützt aus Sicherheitsgründen ausschließlich USB - bitte per Kabel verbinden.'],
  [/nicht per USB verbunden/i, 'Das über LANDED_DEVICE angegebene Gerät ist gerade nicht per USB verbunden.'],
  [/Mehrere Geräte per USB verbunden/i, 'Mehrere Geräte per USB verbunden. Bitte nur eines anschließen (oder LANDED_DEVICE auf eine Seriennummer setzen).'],
  // Wortlaute aus pickDevice() bei aktiviertem Wireless-Opt-in - ohne diese
  // beiden Muster landeten sie im generischen "Unerwarteter Fehler"-Zweig.
  [/Gerät '.*' nicht verbunden/i, 'Das ausgewählte Gerät ist gerade nicht verbunden. Kabel prüfen bzw. drahtlose Verbindung neu aufbauen.'],
  [/Mehrere Geräte verbunden/i, 'Mehrere Geräte verbunden (USB und/oder drahtlos). Bitte nur eines verbunden lassen oder im Kopf-Umschalter eines auswählen.'],
  [/ADB-Sitzung für Gerät .* läuft bereits/i, 'Für ein anderes Gerät läuft gerade noch eine Operation. Kurz warten, bis sie abgeschlossen ist, und erneut versuchen.'],
];

// Fuer bewusst geworfene HTTP-Fehler (falscher Request, nicht "irgendetwas
// im Server kaputt") - der Dispatcher in server.mjs erkennt die Klasse und
// sendet err.status statt pauschal 500 + friendlyError().
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message) => new HttpError(400, message);

export function friendlyError(err) {
  const message = err?.message || String(err);
  for (const [pattern, friendly] of PATTERNS) {
    if (pattern.test(message)) return friendly;
  }
  // Unbekannter Fehler: erste Zeile statt vollem mehrzeiligem Dump - genug fuer
  // eine Fehlermeldung, ohne Stacktrace-Details in den Toast zu kippen.
  const firstLine = message.split('\n')[0].trim();
  return `Unerwarteter Fehler: ${firstLine || 'siehe server.log im Landed-Datenverzeichnis'}`;
}
