// Gleiche Regel wie der Server beim Oeffnen (server.mjs openExternalHandler):
// nur http und https. URLs stammen aus Tabs des Handys, ein javascript:- oder
// data:-Link in der Liste soll gar nicht erst als Link entstehen.
// new URL() zerlegt wie der Browser (Leerraum, Gross-/Kleinschreibung), eine
// leere oder kaputte URL wirft und gilt als nicht oeffnbar.
export function isHttpUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
