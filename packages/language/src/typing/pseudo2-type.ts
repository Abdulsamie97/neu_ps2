// packages/language/src/pseudo2-type.ts

export class Pseudo2Type {
  // name a basic type; if unknown it is ""
  // if struct type, the struct-name is stored here as well
  name = '';

  // array type over what is specified in 'name'
  isArray = false;

  isStruct = false;

  static create(init?: Partial<Pseudo2Type>): Pseudo2Type {
    const t = new Pseudo2Type();
    Object.assign(t, init ?? {});
    return t;
  }

  clone(): Pseudo2Type {
    return Pseudo2Type.create({ name: this.name, isArray: this.isArray, isStruct: this.isStruct });
  }

  /** Returns array-type for this (no nested arrays prevented here; validator may do it) */
  asArrayType(): Pseudo2Type {
    const r = this.clone();
    r.isArray = true;
    return r;
  }

  /** Returns base-type for this (assumes array, but does not check) */
  asBaseType(): Pseudo2Type {
    const r = this.clone();
    r.isArray = false;
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
    return this.isArray === t.isArray && this.isStruct === t.isStruct && this.name === t.name;
  }

  isSameAsIgnoringUnknown(t: Pseudo2Type): boolean {
    return (
      this.isArray === t.isArray &&
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

  /**
   * Returns the name of the type or UNKNOWN; NULL (unknown Struct-type); Array(UNKNOWN)
   */
  asString(): string {
    let name1 = this.name;
    if (name1 === '') name1 = 'UNKNOWN';
    if (this.isStruct && this.name === '') name1 = 'NULL';
    if (this.isArray) name1 = `Array(${name1})`;
    return name1;
  }
}

// literals exactly like Xtext
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
  return (
    t1.isUnknown() ||
    t2.isUnknown() ||
    t1.isSameAs(t2) ||
    (t1.isPartiallyUnknown() && t1.isArray === t2.isArray && t1.isStruct === t2.isStruct)
  );
}