/**
 * @file dot-utils.ts
 * @brief Gemeinsame Hilfsfunktionen zum Erzeugen syntaktisch gültiger DOT-Fragmente.
 * @author Abdul
 */

/**
 * Erzeugt aus einem Präfix und einem laufenden Index eine stabile DOT-Knoten-ID.
 *
 * @param prefix Präfix zur Unterscheidung verschiedener ID-Räume.
 * @param index Fortlaufende Nummer des Knotens.
 * @returns Verkettete DOT-ID, beispielsweise `n3`.
 */
export function dotId(prefix: string, index: number): string {
  return `${prefix}${index}`;
}

/**
 * Maskiert einen Text als DOT-kompatibles Zeichenkettenliteral.
 *
 * JSON-Quoting wird verwendet, da es Anführungszeichen, Backslashes und
 * Steuerzeichen in einer für DOT geeigneten Form schützt.
 *
 * @param value Zu maskierender Klartext.
 * @returns Quoted String einschließlich äußerer Anführungszeichen.
 */
export function dotString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Rendert eine Attributsammlung als optionale DOT-Attributliste.
 *
 * Nicht gesetzte Werte werden ausgelassen. Zeichenketten werden über
 * {@link dotString} maskiert, während Zahlen und Booleans direkt ausgegeben
 * werden.
 *
 * @param attributes Zu rendernde Schlüssel-Wert-Paare.
 * @returns Eine Zeichenkette der Form ` [key=value]` oder den Leerstring.
 */
export function dotAttributes(attributes: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(attributes).filter((entry): entry is [string, string | number | boolean] => {
    return entry[1] !== undefined;
  });

  if (entries.length === 0) {
    return '';
  }

  const rendered = entries
    .map(([key, value]) => `${key}=${typeof value === 'string' ? dotString(value) : String(value)}`)
    .join(', ');
  return ` [${rendered}]`;
}

/**
 * Normalisiert einen frei gewählten Namen für die Verwendung als DOT-Graph-ID.
 *
 * Alle nicht alphanumerischen Zeichen werden durch Unterstriche ersetzt. Ist
 * danach kein Zeichen mehr vorhanden, wird der sichere Fallback `G` genutzt.
 *
 * @param name Ursprünglicher Graph- oder Clustername.
 * @returns Syntaktisch unkritischer DOT-Bezeichner.
 */
export function graphName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_') || 'G';
}
