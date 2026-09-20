/**
 * @file c-direct-print-runtime.ts
 * @brief Erzeugt typisierte Ausgabehelfer fuer native Direct-C-Arrays und Structwerte.
 * @author Abdul
 */

import type { DirectCArrayRuntimeType } from './c-direct-array-runtime.js';
import type { DirectCStringRuntimeMode } from './c-direct-string-runtime.js';

/** @returns C-sicherer Namensbestandteil fuer einen generierten Deskriptortyp. */
function identifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_');
}

/** @returns Name des internen, streambasierten Array-Schreibhelfers. */
export function directCArrayWriteFunction(type: DirectCArrayRuntimeType): string {
  return `ps2_write_${identifier(type.resultType)}`;
}

/** @returns Name des Array-Ausgabehelfers fuer `print`. */
export function directCArrayPrintFunction(type: DirectCArrayRuntimeType): string {
  return `ps2_print_${identifier(type.resultType)}`;
}

/** @returns Name des abbrechenden Array-Ausgabehelfers fuer `throw`. */
export function directCArrayThrowFunction(type: DirectCArrayRuntimeType): string {
  return `ps2_throw_${identifier(type.resultType)}`;
}

/** Name des generischen Ausgabehelfers fuer einen Struct-Zeiger. */
export const DIRECT_C_STRUCT_PRINT_FUNCTION = 'ps2_print_direct_struct';
/** Name des abbrechenden Ausgabehelfers fuer einen Struct-Zeiger. */
export const DIRECT_C_STRUCT_THROW_FUNCTION = 'ps2_throw_direct_struct';

/** Beschreibt den unveraenderten VeriFast-Besitz eines Arraydeskriptors. */
function ownership(type: DirectCArrayRuntimeType, values: string): string {
  return type.ownershipPredicate
    ? `${type.ownershipPredicate}(value.data, value.length, ${values})`
    : `value.data[0..value.length] |-> ${values}`;
}

/** Erzeugt die Ausgabe eines einzelnen Blattelements auf den angegebenen Stream. */
function leafWrite(type: DirectCArrayRuntimeType, expression: string): string {
  if (type.scalarType === 'bool') return `fputs(${expression} ? "true" : "false", stream);`;
  if (type.scalarType === 'const char *') return `if (${expression} != NULL) fputs(${expression}, stream);`;
  if (type.scalarType.startsWith('struct ')) {
    return `if (${expression} != NULL) fputs("[object Object]", stream);`;
  }
  const format = type.scalarType === 'double' ? '%.15g' : '%d';
  return `fprintf(stream, "${format}", ${expression});`;
}

/** Erzeugt Deklarationen und VeriFast-Vertraege eines Array-Ausgabetyps. */
function contractRuntime(type: DirectCArrayRuntimeType): string[] {
  const print = directCArrayPrintFunction(type);
  const fail = directCArrayThrowFunction(type);
  const arrayOwnership = ownership(type, '?values');
  return [
    `void ${print}(${type.resultType} value);`,
    `//@ requires 0 <= value.length &*& ${arrayOwnership};`,
    `//@ ensures ${ownership(type, 'values')};`,
    '',
    `void ${fail}(${type.resultType} value);`,
    `//@ requires 0 <= value.length &*& ${arrayOwnership};`,
    '//@ ensures false;',
    ''
  ];
}

/** Erzeugt konkrete streambasierte Ausgabehelfer eines Arraytyps. */
function implementationRuntime(type: DirectCArrayRuntimeType, types: DirectCArrayRuntimeType[]): string[] {
  const write = directCArrayWriteFunction(type);
  const print = directCArrayPrintFunction(type);
  const fail = directCArrayThrowFunction(type);
  let elementWrite: string;
  if (type.depth > 1) {
    const child = types.find(candidate => candidate.resultType === type.childDescriptorType);
    if (!child) throw new Error(`Missing Direct-C child array printer for ${type.resultType}.`);
    const childWrite = directCArrayWriteFunction(child);
    elementWrite = `if (value.data[index] != NULL) ${childWrite}(*value.data[index], stream);`;
  } else {
    elementWrite = leafWrite(type, 'value.data[index]');
  }
  return [
    `static void ${write}(${type.resultType} value, FILE *stream) {`,
    '  for (int index = 0; index < value.length; ++index) {',
    '    if (index > 0) fputc(\',\', stream);',
    `    ${elementWrite}`,
    '  }',
    '}',
    '',
    `static void ${print}(${type.resultType} value) {`,
    `  ${write}(value, stdout);`,
    "  fputc('\\n', stdout);",
    '}',
    '',
    `static void ${fail}(${type.resultType} value) {`,
    `  ${write}(value, stderr);`,
    "  fputc('\\n', stderr);",
    '  exit(1);',
    '}',
    ''
  ];
}

/** Erzeugt abstrakte oder konkrete Helfer fuer die Stringdarstellung eines Struct-Zeigers. */
function structRuntime(mode: DirectCStringRuntimeMode): string[] {
  if (mode === 'contracts') {
    return [
      `void ${DIRECT_C_STRUCT_PRINT_FUNCTION}(void *value);`,
      '//@ requires true;',
      '//@ ensures true;',
      '',
      `void ${DIRECT_C_STRUCT_THROW_FUNCTION}(void *value);`,
      '//@ requires true;',
      '//@ ensures false;',
      ''
    ];
  }
  return [
    `static void ${DIRECT_C_STRUCT_PRINT_FUNCTION}(void *value) {`,
    '  puts(value == NULL ? "null" : "[object Object]");',
    '}',
    '',
    `static void ${DIRECT_C_STRUCT_THROW_FUNCTION}(void *value) {`,
    '  fputs(value == NULL ? "null\\n" : "[object Object]\\n", stderr);',
    '  exit(1);',
    '}',
    ''
  ];
}

/**
 * Erzeugt nur die fuer das aktuelle Programm benoetigten Array- und Struct-Ausgabehelfer.
 * Arrayhelfer bewahren im Vertragsmodus den kompletten Slice- beziehungsweise
 * verschachtelten Ownership-Chunk. Im Implementierungsmodus entspricht die
 * Darstellung der JavaScript-Stringkonvertierung: Arrayelemente werden durch
 * Kommata getrennt und Structwerte als `[object Object]` ausgegeben.
 *
 * @param types Arraytypen, die in `print` oder `throw` vorkommen.
 * @param includeStructs Ob mindestens ein direkter Structwert ausgegeben wird.
 * @param mode Abstrakter VeriFast-Vertragsmodus oder ausfuehrbare Implementierung.
 * @returns Vollstaendiger C-Quelltext der benoetigten Helfer.
 */
export function directCPrintRuntime(
  types: DirectCArrayRuntimeType[],
  includeStructs: boolean,
  mode: DirectCStringRuntimeMode
): string {
  const ordered = [...types].sort((left, right) => left.depth - right.depth);
  const lines = ordered.flatMap(type => mode === 'contracts'
    ? contractRuntime(type)
    : implementationRuntime(type, ordered));
  if (includeStructs) lines.push(...structRuntime(mode));
  return lines.join('\n').trimEnd();
}
