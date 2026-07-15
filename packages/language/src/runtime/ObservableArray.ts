/**
 * @file ObservableArray.ts
 * @brief Definiert die als JavaScript-Quelltext eingebettete Array-Runtime des Pseudo2-Generators.
 * @author Abdul
 */

/**
 * @brief Enthält die vollständige JavaScript-Implementierung des beobachtbaren Array-Wrappers.
 *
 * Der Konstruktor akzeptiert einen vorhandenen `ObservableArray`, ein natives Array
 * oder einen Null-/Undefined-Ausgangswert. `get(index)` liest ein einzelnes nullbasiertes
 * Runtime-Element und prüft Grenzen; ohne Index liefert es das zugrunde liegende Array.
 * `set(value, index)` ersetzt entweder das gesamte Array oder ein geprüftes Element.
 * `length()` liefert die logische Anzahl gespeicherter Elemente. Die Umrechnung von
 * Pseudo2s einsbasierten Indizes erfolgt bewusst erst in `RuntimeHelpers.ts`.
 *
 * @note Der String wird unverändert vor dem generierten Programm eingebettet.
 */
export const OBSERVABLE_ARRAY_RUNTIME = String.raw`var ObservableArray = function (val) {
  this.ref = new Array();
  if (val instanceof ObservableArray) {
    this.ref = val.get();
  } else if (val instanceof Array) {
    this.ref = val;
  } else if (val === null || val === undefined) {
    this.ref = new Array();
  } else {
    throw new Error("ObservableArray- Constructor: Incompatible type" + val);
  }
};

ObservableArray.prototype.get = function (index) {
  if (index !== undefined && index !== null) {
    if (index > this.ref.length - 1 || index < 0) {
      throw new Error(this.name + " - Getter: Array access out of bounds\nindex = " + (index + 1) + "\narray size = " + this.ref.length);
    }
    return this.ref[index];
  }
  return this.ref;
};

ObservableArray.prototype.set = function (val, index) {
  if (index === undefined || index === null) {
    if (val instanceof ObservableArray) {
      this.ref = val.get();
    } else if (val instanceof Array) {
      this.ref = val;
    } else {
      throw new Error(this.name + " - Setter: Incompatible type");
    }
  } else {
    if (index > this.ref.length - 1 || index < 0) {
      throw new Error(this.name + " - Setter: Array access out of bounds\nindex = " + index + "\narray size = " + this.ref.length);
    }
    this.ref[index] = val;
  }
};

ObservableArray.prototype.length = function () {
  return this.ref === null ? 0 : this.ref.length;
};`;
