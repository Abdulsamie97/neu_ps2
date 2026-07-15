/**
 * @file pseudo2-type.ts
 * @brief Definiert Darstellung, Vergleich und Konformitätsregeln aller statischen Pseudo2-Typen.
 * @author Abdul
 */

// packages/language/src/pseudo2-type.ts

/**
 * @brief Repräsentiert einen skalaren, Struct- oder beliebig tief verschachtelten Arraytyp.
 *
 * Ein leerer Name kennzeichnet einen unbekannten Basistyp. `isStruct` unterscheidet
 * unbekannte Structreferenzen von vollständig unbekannten Werten. `arrayDepth`
 * speichert jede Arraydimension; `isArray` bleibt als abgeleitetes Kompatibilitätsfeld erhalten.
 */
export class Pseudo2Type {
  // name a basic type; if unknown it is ""
  // if struct type, the struct-name is stored here as well
  /** @brief Name des Basistyps oder Structs; ein leerer String kennzeichnet einen unbekannten Namen. */
  name = '';

  // array type over what is specified in 'name'
  /** @brief Kompatibilitätskennzeichen, das genau bei positiver `arrayDepth` gesetzt ist. */
  isArray = false;

  // Number of array wrappers. isArray is kept for compatibility with existing callers.
  /** @brief Anzahl der Arrayhüllen um den zugrunde liegenden Skalar- oder Structtyp. */
  arrayDepth = 0;

  /** @brief Kennzeichnet, dass der Basistyp eine Structreferenz statt eines Skalars ist. */
  isStruct = false;

  /**
   * @brief Erzeugt einen normalisierten Pseudo2-Typ aus optionalen Teilwerten.
   *
   * Für ältere Aufrufer wird `isArray: true` ohne explizite Tiefe als genau eine
   * Arraydimension interpretiert. Danach wird `isArray` immer aus `arrayDepth` abgeleitet.
   *
   * @param init Zu übernehmende Typmerkmale.
   * @return Neue, intern konsistente Typinstanz.
   */
  static create(init?: Partial<Pseudo2Type>): Pseudo2Type {
    const t = new Pseudo2Type();
    Object.assign(t, init ?? {});
    if (init?.arrayDepth === undefined && init?.isArray === true) {
      t.arrayDepth = 1;
    }
    t.isArray = t.arrayDepth > 0;
    return t;
  }

  /**
   * @brief Erstellt eine unabhängige Kopie aller Typmerkmale.
   * @return Neuer Pseudo2-Typ mit identischem Namen, Structstatus und Arraytiefe.
   */
  clone(): Pseudo2Type {
    return Pseudo2Type.create({
      name: this.name,
      isArray: this.isArray,
      arrayDepth: this.arrayDepth,
      isStruct: this.isStruct
    });
  }

  /**
   * Returns one additional array wrapper around this type.
   *
   * @brief Kopiert den Typ und fügt genau eine äußere Arraydimension hinzu.
   * @return Neuer Arraytyp; die ursprüngliche Instanz bleibt unverändert.
   */
  asArrayType(): Pseudo2Type {
    const r = this.clone();
    r.arrayDepth++;
    r.isArray = true;
    return r;
  }

  /**
   * Removes one array wrapper, if present.
   *
   * @brief Kopiert den Typ und entfernt höchstens eine äußere Arraydimension.
   * @return Neuer Typ mit um eins reduzierter, niemals negativer Arraytiefe.
   */
  asBaseType(): Pseudo2Type {
    const r = this.clone();
    r.arrayDepth = Math.max(0, r.arrayDepth - 1);
    r.isArray = r.arrayDepth > 0;
    return r;
  }

  /**
   * @brief Prüft, ob der Typ weder Array noch Struct und damit ein skalarer Basistyp ist.
   * @return `true` für Zahlen-, String-, Bool- und vollständig unbekannte Skalartypen.
   */
  isBaseType(): boolean {
    return !this.isArrayType() && !this.isStructType();
  }

  /**
   * @brief Prüft, ob mindestens eine Arraydimension vorhanden ist.
   * @return Aktueller, aus `arrayDepth` normalisierter Arraystatus.
   */
  isArrayType(): boolean {
    return this.isArray;
  }

  /**
   * @brief Prüft, ob der zugrunde liegende Basistyp eine Structreferenz ist.
   * @return Aktueller Structstatus des Typs.
   */
  isStructType(): boolean {
    return this.isStruct;
  }

  /**
   * @brief Vergleicht zwei Typen einschließlich Name, Structstatus und exakter Arraytiefe.
   * @param t Zu vergleichender Typ.
   * @return `true` nur bei vollständiger struktureller Gleichheit.
   */
  isSameAs(t: Pseudo2Type): boolean {
    return this.arrayDepth === t.arrayDepth && this.isStruct === t.isStruct && this.name === t.name;
  }

  /**
   * @brief Vergleicht zwei Typen, wobei unbekannte Namen als Platzhalter gelten.
   *
   * Unbekannte Array-Basistypen passen zu jedem Array gleicher Tiefe. Außerhalb von
   * Arrays müssen Arraytiefe und Structstatus übereinstimmen; nur der leere Name darf
   * einen konkreten Namen ersetzen.
   *
   * @param t Zu vergleichender konkreter oder teilweise unbekannter Typ.
   * @return `true`, wenn beide Typformen nach den Unknown-Regeln kompatibel sind.
   */
  isSameAsIgnoringUnknown(t: Pseudo2Type): boolean {
    // Array(UNKNOWN) soll zu jedem Array passen,
    // egal ob Basis num/string/bool oder Struct ist
    if (this.arrayDepth === t.arrayDepth && this.isArray && (this.name === '' || t.name === '')) {
      return true;
    }

    return (
      this.arrayDepth === t.arrayDepth &&
      this.isStruct === t.isStruct &&
      (this.name === '' || t.name === '' || this.name === t.name)
    );
  }

  // unknown in the sense of 'cycle detected'
  /**
   * @brief Erkennt einen vollständig unbekannten Typ, etwa nach Zyklenerkennung.
   * @return `true`, wenn Name, Array- und Structinformation vollständig fehlen.
   */
  isUnknown(): boolean {
    return this.name === '' && !this.isArray && !this.isStruct;
  }

  /**
   * @brief Erkennt eine bekannte Typform mit noch unbekanntem Basis- oder Structnamen.
   * @return `true` für Array(UNKNOWN) oder eine unbekannte Structreferenz.
   */
  isPartiallyUnknown(): boolean {
    return this.name === '' && (this.isArray || this.isStruct);
  }

  /**
   * @brief Prüft die symmetrische Typkonformität unter Berücksichtigung unbekannter Informationen.
   *
   * Vollständig unbekannte Typen sind immer konform. Ansonsten werden exakte Gleichheit,
   * unbekannte Namen und teilweise unbekannte Formen gleicher Arraytiefe und Structart akzeptiert.
   *
   * @param t Typ, gegen den die Konformität geprüft wird.
   * @return `true`, wenn kein bekannter Typbestandteil im Widerspruch steht.
   */
  isConformingTo(t: Pseudo2Type): boolean {
    return (
      this.isUnknown() ||
      t.isUnknown() ||
      this.isSameAs(t) ||
      this.isSameAsIgnoringUnknown(t) ||
      (this.isPartiallyUnknown() &&
        this.arrayDepth === t.arrayDepth &&
        this.isStruct === t.isStruct) ||
      (t.isPartiallyUnknown() &&
        this.arrayDepth === t.arrayDepth &&
        this.isStruct === t.isStruct)
    );
  }

  /**
   * Returns the name of the type or UNKNOWN; NULL (unknown Struct-type); Array(UNKNOWN)
   *
   * @brief Erzeugt die kanonische, für Diagnosen geeignete Textdarstellung des Typs.
   * @return Basisname, `UNKNOWN`, `NULL` oder entsprechend der Tiefe verschachtelte `Array(...)`-Ausdrücke.
   */
  asString(): string {
    let name1 = this.name;
    if (name1 === '') name1 = 'UNKNOWN';
    if (this.isStruct && this.name === '') name1 = 'NULL';
    for (let depth = 0; depth < this.arrayDepth; depth++) name1 = `Array(${name1})`;
    return name1;
  }
}

/** @brief Kanonischer Stringtyp der Pseudo2-Sprache. */
export const TYPE_STRING = Pseudo2Type.create({ name: 'string' });
/** @brief Kanonischer numerischer Typ der Pseudo2-Sprache. */
export const TYPE_NUM = Pseudo2Type.create({ name: 'num' });
/** @brief Kanonischer boolescher Typ der Pseudo2-Sprache. */
export const TYPE_BOOL = Pseudo2Type.create({ name: 'bool' });

/** @brief Vollständig unbekannter Typ für fehlende Informationen oder erkannte Zyklen. */
export const TYPE_UNKNOWN = Pseudo2Type.create({ name: '' });

/** @brief Kanonischer eindimensionaler numerischer Arraytyp. */
export const TYPE_ARRAY_NUM = Pseudo2Type.create({ name: 'num', isArray: true });
/** @brief Eindimensionaler Arraytyp mit unbekanntem Elementtyp. */
export const TYPE_ARRAY_UNKNOWN = Pseudo2Type.create({ name: '', isArray: true });

/** @brief Structreferenz mit noch unbekanntem konkreten Structnamen. */
export const TYPE_STRUCT_UNKNOWN = Pseudo2Type.create({ name: '', isStruct: true });

/**
 * @brief Erzeugt den Typ einer konkret benannten Structdeklaration.
 * @param aname Deklarierter Name des Structs.
 * @return Structtyp mit dem angegebenen Namen.
 */
export function TYPE_STRUCT(aname: string): Pseudo2Type {
  return Pseudo2Type.create({ name: aname, isStruct: true });
}

/**
 * @brief Bietet die Typkonformitätsprüfung als freie Hilfsfunktion an.
 * @param t1 Erster zu vergleichender Typ.
 * @param t2 Zweiter zu vergleichender Typ.
 * @return Ergebnis von `t1.isConformingTo(t2)`.
 */
export function isConformingTo(t1: Pseudo2Type, t2: Pseudo2Type): boolean {
  return t1.isConformingTo(t2);
}
