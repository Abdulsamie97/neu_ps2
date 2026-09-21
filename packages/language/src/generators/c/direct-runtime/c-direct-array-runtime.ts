/**
 * @file c-direct-array-runtime.ts
 * @brief Erzeugt typisierte Array-Rueckgaben und Kopierhelfer fuer Direct C.
 * @author Abdul
 */

import type { DirectCStringRuntimeMode } from './c-direct-string-runtime.js';

/** Formatiert einen weiteren C-Zeigerstern ohne getrennte `* *`-Schreibweise. */
function pointerTo(type: string): string {
  const normalized = type.trimEnd();
  return normalized.endsWith('*') ? `${normalized}*` : `${normalized} *`;
}

/** Beschreibt einen konkreten nativen Arraytyp, der eine Funktion verlassen darf. */
export interface DirectCArrayRuntimeType {
  /** Name der kleinen C-Struktur aus Datenzeiger und logischer Laenge. */
  resultType: string;
  /** Nativer C-Typ eines einzelnen Arrayelements. */
  elementType: string;
  /** Tiefe des logischen Pseudo2-Arrays. */
  depth: number;
  /** Nativer C-Typ eines skalaren Blattelements. */
  scalarType: string;
  /** Eindeutiger Name des typisierten Kopierhelfers. */
  copyFunction: string;
  /** Eindeutiger Name des Helfers, der Zeiger und Laenge ohne Kopie zusammenfasst. */
  referenceFunction: string;
  /** Eigenes rekursives Ownership-Praedikat fuer Arrays aus C-Struct-Deskriptoren. */
  ownershipPredicate?: string;
  /** Reiner VeriFast-Typ des Inhalts eines einzelnen untergeordneten Arrays. */
  ownershipValueType?: string;
  /** Ownership-Praedikat des untergeordneten Arrays; ohne Namen wird ein nativer Slice verwendet. */
  childOwnershipPredicate?: string;
  /** Deskriptortyp des unmittelbar untergeordneten Arrays. */
  childDescriptorType?: string;
  /** Verifizierter Lesehelfer fuer eine vollstaendige verschachtelte Indexkette. */
  getFunction?: string;
  /** Verifizierter Schreibhelfer fuer eine vollstaendige verschachtelte Indexkette. */
  setFunction?: string;
  /** Lesehelfer des unmittelbar untergeordneten verschachtelten Arraytyps. */
  childGetFunction?: string;
  /** Schreibhelfer des unmittelbar untergeordneten verschachtelten Arraytyps. */
  childSetFunction?: string;
}

/** Baut den reinen Wert einer vollstaendigen verschachtelten Indexkette. */
function nestedSelection(depth: number, root = 'values'): string {
  let result = root;
  for (let index = 1; index <= depth; index++) {
    result = `nth(index_${index} - 1, ${result})`;
  }
  return result;
}

/** Baut alle einsbasierten Bereichsbedingungen einer verschachtelten Indexkette. */
function nestedBounds(depth: number): string[] {
  const result: string[] = [];
  let container = 'values';
  for (let index = 1; index <= depth; index++) {
    result.push(`1 <= index_${index}`);
    result.push(index === 1
      ? 'index_1 <= array.length'
      : `index_${index} <= length(${container})`);
    container = `nth(index_${index} - 1, ${container})`;
  }
  return result;
}

/** Ersetzt das durch eine Indexkette bezeichnete Blatt in einer verschachtelten Ghostliste. */
function nestedUpdate(depth: number, level = 1, container = 'values'): string {
  const index = `index_${level}`;
  if (level === depth) return `update(${index} - 1, value, ${container})`;
  const child = `nth(${index} - 1, ${container})`;
  return `update(${index} - 1, ${nestedUpdate(depth, level + 1, child)}, ${container})`;
}

/** Erzeugt die verifizierten Getter und Setter eines verschachtelten Arraytyps. */
function nestedAccessors(type: DirectCArrayRuntimeType): string[] {
  if (!type.ownershipPredicate || !type.childDescriptorType || !type.getFunction || !type.setFunction) return [];
  const indices = Array.from({ length: type.depth }, (_, index) => `index_${index + 1}`);
  const parameters = indices.map(index => `int ${index}`);
  const bounds = nestedBounds(type.depth);
  const ownership = `${type.ownershipPredicate}(array.data, array.length, ?values)`;
  const restoredOwnership = `${type.ownershipPredicate}(array.data, array.length, values)`;
  const lowerIndices = indices.slice(1);
  const tailIndices = [`${indices[0]} - 1`, ...lowerIndices];
  const child = 'ps2_child';
  const result = 'ps2_result';
  const lowerRead = type.depth === 2
    ? [
        `    int ps2_leaf_index = ps2_checked_index(${indices[1]}, ${child}->length);`,
        `    ${result} = ${child}->data[ps2_leaf_index];`
      ]
    : [
        `    ${type.childDescriptorType} ps2_child_value;`,
        `    ps2_child_value.data = ${child}->data;`,
        `    ps2_child_value.length = ${child}->length;`,
        `    ${result} = ${type.childGetFunction}(ps2_child_value, ${lowerIndices.join(', ')});`
      ];
  const lowerWrite = type.depth === 2
    ? [
        `    int ps2_leaf_index = ps2_checked_index(${indices[1]}, ${child}->length);`,
        `    ${child}->data[ps2_leaf_index] = value;`
      ]
    : [
        `    ${type.childDescriptorType} ps2_child_value;`,
        `    ps2_child_value.data = ${child}->data;`,
        `    ps2_child_value.length = ${child}->length;`,
        `    ${type.childSetFunction}(ps2_child_value, ${lowerIndices.join(', ')}, value);`
      ];
  return [
    `static ${type.scalarType} ${type.getFunction}(${type.resultType} array, ${parameters.join(', ')})`,
    `//@ requires ${ownership} &*& ${bounds.join(' &*& ')};`,
    `//@ ensures ${restoredOwnership} &*& result == ${nestedSelection(type.depth)};`,
    '{',
    `  ps2_checked_index(${indices[0]}, array.length);`,
    `  //@ open ${type.ownershipPredicate}(array.data, array.length, values);`,
    '  int ps2_array_length = array.length;',
    `  ${type.scalarType} ${result};`,
    `  if (${indices[0]} == 1) {`,
    `    ${type.childDescriptorType} *${child} = *array.data;`,
    ...lowerRead,
    '  } else {',
    `    ${type.resultType} ps2_tail;`,
    '    ps2_tail.data = array.data + 1;',
    '    ps2_tail.length = ps2_array_length - 1;',
    `    ${result} = ${type.getFunction}(ps2_tail, ${tailIndices.join(', ')});`,
    '  }',
    `  //@ close ${type.ownershipPredicate}(array.data, array.length, _);`,
    `  return ${result};`,
    '}',
    '',
    `static void ${type.setFunction}(${type.resultType} array, ${parameters.join(', ')}, ${type.scalarType} value)`,
    `//@ requires ${ownership} &*& ${bounds.join(' &*& ')};`,
    `//@ ensures ${type.ownershipPredicate}(array.data, array.length, ${nestedUpdate(type.depth)});`,
    '{',
    `  ps2_checked_index(${indices[0]}, array.length);`,
    `  //@ open ${type.ownershipPredicate}(array.data, array.length, values);`,
    '  int ps2_array_length = array.length;',
    `  if (${indices[0]} == 1) {`,
    `    ${type.childDescriptorType} *${child} = *array.data;`,
    ...lowerWrite,
    '  } else {',
    `    ${type.resultType} ps2_tail;`,
    '    ps2_tail.data = array.data + 1;',
    '    ps2_tail.length = ps2_array_length - 1;',
    `    ${type.setFunction}(ps2_tail, ${tailIndices.join(', ')}, value);`,
    '  }',
    `  //@ close ${type.ownershipPredicate}(array.data, array.length, _);`,
    '}',
    ''
  ];
}

/**
 * Erzeugt fuer jeden verwendeten Elementtyp eine Array-Rueckgabestruktur.
 *
 * Im Vertragsmodus beschreibt der Kopierhelfer exakt, dass die Elementliste
 * erhalten bleibt und in einem neuen, vom Aufrufer besessenen Datenbereich
 * zurueckgegeben wird. Der Implementierungsmodus kopiert die Elemente in einen
 * dauerhaft gueltigen Heapbereich. Damit koennen Arrayliterale eine Funktion
 * verlassen, ohne auf einen bereits zerstoerten C-Stackbereich zu zeigen.
 *
 * @param types Benoetigte, bereits deduplizierte native Arraytypen.
 * @param mode Vertrags- oder ausfuehrbarer Implementierungsmodus.
 * @returns C-Typdefinitionen und passende Helferdeklarationen beziehungsweise -rumpfe.
 */
export function directCArrayRuntime(
  types: DirectCArrayRuntimeType[],
  mode: DirectCStringRuntimeMode
): string {
  return types.flatMap(type => {
    const dataType = pointerTo(type.elementType);
    const ownership = (pointer: string, length: string, values: string) => type.ownershipPredicate
      ? `${type.ownershipPredicate}(${pointer}, ${length}, ${values})`
      : `${pointer}[0..${length}] |-> ${values}`;
    const childOwnership = type.childOwnershipPredicate
      ? `${type.childOwnershipPredicate}(headData, headLength, ?headValues)`
      : 'headData[0..headLength] |-> ?headValues';
    const declaration = [
      `typedef struct ${type.resultType} {`,
      `  ${dataType}data;`,
      '  int length;',
      `} ${type.resultType};`,
      '',
      ...(type.ownershipPredicate ? [
        `/*@ predicate ${type.ownershipPredicate}(${dataType}data, int length; list<${type.ownershipValueType} > values) =`,
        '  0 <= length &*& length <= INT_MAX &*& pointer_within_limits(data) == true &*& pointer_within_limits(data + length) == true &*&',
        '  (length == 0 ?',
        '    values == nil',
        `  : 0 < length &*& pointer_within_limits(data + 1) == true &*& *data |-> ?head &*&`,
        `    head->data |-> ?headData &*& head->length |-> ?headLength &*& malloc_block_${type.childDescriptorType}(head) &*& 0 <= headLength &*&`,
        `    ${childOwnership} &*& ${type.ownershipPredicate}(data + 1, length - 1, ?tail) &*&`,
        '    values == cons(headValues, tail)); @*/',
        ''
      ] : [])
    ];
    if (mode === 'contracts') {
      return [
        ...declaration,
        `${type.resultType} ${type.referenceFunction}(${dataType}data, int length);`,
        `//@ requires 0 <= length &*& ${ownership('data', 'length', '?values')};`,
        `//@ ensures result.data == data &*& result.length == length &*& ${ownership('data', 'length', 'values')};`,
        '',
        ...(type.ownershipPredicate ? [] : [
          `${type.resultType} ${type.copyFunction}(${dataType}source, int length);`,
          `//@ requires 0 <= length &*& ${ownership('source', 'length', '?values')};`,
          `//@ ensures ${ownership('source', 'length', 'values')} &*& result.length == length &*& ${ownership('result.data', 'result.length', 'values')};`,
          ''
        ]),
        ...nestedAccessors(type)
      ];
    }
    return [
      ...declaration,
      `static ${type.resultType} ${type.referenceFunction}(${dataType}data, int length) {`,
      '  if (length < 0) abort();',
      `  ${type.resultType} result = { data, length };`,
      '  return result;',
      '}',
      '',
      `static ${type.resultType} ${type.copyFunction}(${dataType}source, int length) {`,
      '  if (length < 0) abort();',
      `  ${dataType}data = (${dataType})calloc(length > 0 ? (size_t)length : 1, sizeof(${type.elementType}));`,
      '  if (data == NULL) abort();',
      '  for (int index = 0; index < length; ++index) data[index] = source[index];',
      `  ${type.resultType} result = { data, length };`,
      '  return result;',
      '}',
      '',
      ...nestedAccessors(type)
    ];
  }).join('\n').trimEnd();
}
