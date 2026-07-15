/**
 * @file RuntimeHelpers.ts
 * @brief Definiert die JavaScript-Hilfsfunktionen, über die generierter Pseudo2-Code auf Runtime-Werte zugreift.
 * @author Abdul
 */

/**
 * @brief Enthält die Brücke zwischen generiertem JavaScript und den Observable-Runtimeklassen.
 *
 * `__ps2_array` erzeugt ein Array fester Länge und ruft die Initialisierungsfunktion
 * für jedes Element separat auf. `__ps2_arrayLiteral` übernimmt Literalwerte,
 * `__ps2_arrayIndex` rechnet einsbasierte Pseudo2-Indizes in nullbasierte Runtime-
 * Indizes um, und Get/Set/Length kapseln den Arrayzugriff. `__ps2_struct` und
 * `__ps2_newStruct` erzeugen Structs; StructGet/StructSet lesen und schreiben Felder
 * und verpacken Arrayfelder passend. `__ps2_wrapValue` wählt anhand von Wert und
 * Typkennzeichen den richtigen Wrapper. StructRef, AsArray und AsStruct normalisieren
 * Referenzen beziehungsweise prüfen den erwarteten Runtime-Typ.
 *
 * @note Der String wird nach den Observable-Klassen in die Runtime-Präambel eingebettet.
 */
export const PSEUDO2_RUNTIME_HELPERS = String.raw`function __ps2_array(size, init) {
  return new ObservableArray(Array.from({ length: size }, () => init()));
}

function __ps2_arrayLiteral(values) {
  return values;
}

function __ps2_arrayIndex(index) {
  return index - 1;
}

function __ps2_arrayGet(array, index) {
  return __ps2_asArray(array).get(__ps2_arrayIndex(index));
}

function __ps2_arraySet(array, index, value) {
  __ps2_asArray(array).set(value, __ps2_arrayIndex(index));
  return value;
}

function __ps2_arrayLength(array) {
  return array instanceof ObservableArray ? array.length() : array.length;
}

function __ps2_struct(fields) {
  const object = new ObservableStruct(null);
  object.ref = fields;
  return object;
}

function __ps2_newStruct(factory) {
  return factory();
}

function __ps2_structGet(object, field) {
  return __ps2_asStruct(object).attrVal(field);
}

function __ps2_structSet(object, field, value, kind) {
  const struct = __ps2_asStruct(object);
  if (kind === "array") {
    struct.setAttr(new ObservableArray(value), field);
  } else {
    struct.setAttr(value, field);
  }
  return value;
}

function __ps2_wrapValue(value, kind) {
  if (kind === "array" || value instanceof ObservableArray || value instanceof Array) {
    return new ObservableArray(value);
  }
  if (kind === "struct" || value instanceof ObservableStruct) {
    const wrapped = new ObservableStruct(null);
    wrapped.set(value);
    return wrapped;
  }
  return new ObservableScalar(value);
}

function __ps2_structRef(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof ObservableStruct ? value.getRef() : value;
}

function __ps2_asArray(value) {
  return value instanceof ObservableArray ? value : new ObservableArray(value);
}

function __ps2_asStruct(value) {
  if (value instanceof ObservableStruct) {
    return value;
  }
  throw new Error("ObservableStruct expected");
}`;
