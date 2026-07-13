// packages/language/src/pseudo2-type.ts

export class Pseudo2Type {
  // name a basic type; if unknown it is ""
  // if struct type, the struct-name is stored here as well
  name = '';

  // array type over what is specified in 'name'
  isArray = false;

  // Number of array wrappers. isArray is kept for compatibility with existing callers.
  arrayDepth = 0;

  isStruct = false;

  static create(init?: Partial<Pseudo2Type>): Pseudo2Type {
    const t = new Pseudo2Type();
    Object.assign(t, init ?? {});
    if (init?.arrayDepth === undefined && init?.isArray === true) {
      t.arrayDepth = 1;
    }
    t.isArray = t.arrayDepth > 0;
    return t;
  }

  clone(): Pseudo2Type {
    return Pseudo2Type.create({
      name: this.name,
      isArray: this.isArray,
      arrayDepth: this.arrayDepth,
      isStruct: this.isStruct
    });
  }

  /** Returns one additional array wrapper around this type. */
  asArrayType(): Pseudo2Type {
    const r = this.clone();
    r.arrayDepth++;
    r.isArray = true;
    return r;
  }

  /** Removes one array wrapper, if present. */
  asBaseType(): Pseudo2Type {
    const r = this.clone();
    r.arrayDepth = Math.max(0, r.arrayDepth - 1);
    r.isArray = r.arrayDepth > 0;
    return r;
  }

  isBaseType(): boolean {
    return !this.isArrayType() && !this.isStructType();
  }

  isArrayType(): boolean {
    return this.isArray;
  }

  isStructType(): boolean {
    return this.isStruct;
  }

  isSameAs(t: Pseudo2Type): boolean {
    return this.arrayDepth === t.arrayDepth && this.isStruct === t.isStruct && this.name === t.name;
  }

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
  isUnknown(): boolean {
    return this.name === '' && !this.isArray && !this.isStruct;
  }

  isPartiallyUnknown(): boolean {
    return this.name === '' && (this.isArray || this.isStruct);
  }

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
   */
  asString(): string {
    let name1 = this.name;
    if (name1 === '') name1 = 'UNKNOWN';
    if (this.isStruct && this.name === '') name1 = 'NULL';
    for (let depth = 0; depth < this.arrayDepth; depth++) name1 = `Array(${name1})`;
    return name1;
  }
}

export const TYPE_STRING = Pseudo2Type.create({ name: 'string' });
export const TYPE_NUM = Pseudo2Type.create({ name: 'num' });
export const TYPE_BOOL = Pseudo2Type.create({ name: 'bool' });

export const TYPE_UNKNOWN = Pseudo2Type.create({ name: '' });

export const TYPE_ARRAY_NUM = Pseudo2Type.create({ name: 'num', isArray: true });
export const TYPE_ARRAY_UNKNOWN = Pseudo2Type.create({ name: '', isArray: true });

export const TYPE_STRUCT_UNKNOWN = Pseudo2Type.create({ name: '', isStruct: true });

export function TYPE_STRUCT(aname: string): Pseudo2Type {
  return Pseudo2Type.create({ name: aname, isStruct: true });
}

export function isConformingTo(t1: Pseudo2Type, t2: Pseudo2Type): boolean {
  return t1.isConformingTo(t2);
}
