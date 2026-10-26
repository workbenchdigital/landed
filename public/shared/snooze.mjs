// Wiedervorlage "Ohne Termin": ein Datum weit in der Zukunft statt eigener
// Spalte. Alle Faelligkeitspruefungen (dueSnoozeCount, renderSnoozedView,
// checkDueSnoozeBanner, SQL in getOpenCounts) vergleichen mit "<= heute", der
// Marker wird dadurch nie faellig, ohne dass eine davon angefasst wird.
// Browser und Server laden dieselbe Datei, kein Build-Schritt.
//
// shortcut: Sonderwert statt eigener Spalte, ersetzen sobald ein zweiter Sonderwert noetig wird.
export const NO_DUE_DATE = '9999-12-31';

export function isNoDueDate(value) {
  return value === NO_DUE_DATE;
}
