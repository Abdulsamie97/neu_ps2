/**
 * @file ObservableStruct.ts
 * @brief Definiert die als JavaScript-Quelltext eingebettete Struct-Runtime des Pseudo2-Generators.
 * @author Abdul
 */

/**
 * @brief Enthält die JavaScript-Implementierung für Struct-Referenzen und Attributzugriffe.
 *
 * Der Konstruktor erzeugt eine leere Attributtabelle oder übernimmt die Referenz eines
 * vorhandenen `ObservableStruct`. `get()` liefert den Wrapper, `getRef()` seine interne
 * Referenz. `attrVal` und `setAttr` lesen beziehungsweise schreiben Attribute mit
 * expliziter Nullreferenzprüfung; Nullwerte werden als null gesetzte Struct-Wrapper
 * gespeichert. `setAttrIndex` und `attrValIndex` delegieren indexierte Attribute an
 * `ObservableArray`. `set` setzt die Referenz auf null, kopiert eine Struct-Referenz
 * oder verwirft inkompatible Werte mit einem Fehler.
 *
 * @note Der String wird unverändert vor dem generierten Programm eingebettet.
 */
export const OBSERVABLE_STRUCT_RUNTIME = String.raw`var ObservableStruct = function (val) {
  this.ref = new Object();
  if (val instanceof ObservableStruct) {
    this.ref = val.ref;
  } else if (val !== undefined && val !== null) {
    throw new Error(this.name + " - Constructor: Incompatible type " + val);
  }
};

ObservableStruct.prototype.get = function () {
  return this;
};

ObservableStruct.prototype.getRef = function () {
  return this.ref;
};

ObservableStruct.prototype.attrVal = function (attrName) {
  if (this.ref === null) {
    throw new Error("NullPointerException: Cannot access of attribute '" + attrName + "' on a null object");
  }
  return this.ref[attrName];
};

ObservableStruct.prototype.setAttr = function (val, attrName) {
  if (this.ref === null) {
    throw new Error("NullPointerException: Cannot set attribute '" + attrName + "' on a null object");
  }
  if (val === null) {
    const newVal = new ObservableStruct(null);
    newVal.set(null);
    this.ref[attrName] = newVal;
  } else {
    this.ref[attrName] = val;
  }
};

ObservableStruct.prototype.setAttrIndex = function (val, index, attrName) {
  if (this.ref === null) {
    throw new Error("NullPointerException: Cannot set attribute '" + attrName + "' on a null object");
  }
  this.ref[attrName].set(val, index);
};

ObservableStruct.prototype.attrValIndex = function (attrName, index) {
  if (this.ref === null) {
    throw new Error("NullPointerException: Cannot access of attribute '" + attrName + "' on a null object");
  }
  if (this.ref[attrName] instanceof ObservableArray) {
    return this.ref[attrName].get(index);
  }
  throw new Error("ObservableStruct.attrValIndex: Cannot find ObservableArray for attribute '" + attrName + "'");
};

ObservableStruct.prototype.set = function (val) {
  if (val === null) {
    this.ref = null;
    return;
  }
  this.ref = new Object();
  if (val instanceof ObservableStruct) {
    this.ref = val.ref;
  } else if (val !== undefined && val !== null) {
    throw new Error(this.name + " - Constructor: Incompatible type " + val);
  }
};`;
