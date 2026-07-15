/**
 * @file ObservableScalar.ts
 * @brief Definiert die als JavaScript-Quelltext eingebettete Skalar-Runtime des Pseudo2-Generators.
 * @author Abdul
 */

/**
 * @brief Enthält die vollständige JavaScript-Implementierung des beobachtbaren Skalar-Wrappers.
 *
 * Der Konstruktor übernimmt Zahlen, Strings und boolesche Werte einschließlich ihrer
 * JavaScript-Wrapperobjekte oder kopiert den Wert eines `ObservableScalar`. Null und
 * Undefined erzeugen einen leeren Skalar; inkompatible Objekte lösen einen Fehler aus.
 * `set(value)` führt dieselbe Typprüfung für spätere Zuweisungen durch und normalisiert
 * Null-/Undefined-Werte auf `null`. `get()` liefert den unverpackten gespeicherten Wert.
 *
 * @note Der String wird unverändert vor dem generierten Programm eingebettet.
 */
export const OBSERVABLE_SCALAR_RUNTIME = String.raw`var ObservableScalar = function (val) {
  this.value = null;
  if (val instanceof ObservableScalar) {
    this.value = val.get();
  } else if (
    typeof val === 'number' || val instanceof Number ||
    typeof val === 'string' || val instanceof String ||
    typeof val === 'boolean' || val instanceof Boolean
  ) {
    this.value = val;
  } else if (val !== undefined && val !== null) {
    throw new Error(this.name + " - Constructor: Incompatible type " + val);
  }
};

ObservableScalar.prototype.set = function (val) {
  if (val instanceof ObservableScalar) {
    this.value = val.get();
  } else if (
    typeof val === 'number' || val instanceof Number ||
    typeof val === 'string' || val instanceof String ||
    typeof val === 'boolean' || val instanceof Boolean
  ) {
    this.value = val;
  } else if (val !== undefined && val !== null) {
    throw new Error(this.name + " - Setter: Incompatible type " + JSON.stringify(val));
  } else {
    this.value = null;
  }
};

ObservableScalar.prototype.get = function () {
  return this.value;
};`;
