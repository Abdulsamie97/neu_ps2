/**
 * @file c-direct-optional-runtime.ts
 * @brief Erzeugt kleine Ausgabehelfer fuer noch nicht initialisierte Struct-Felder.
 * @author Abdul
 */

import type { DirectCStringRuntimeMode } from './c-direct-string-runtime.js';

/** Von Direct C direkt ausgebbare native Feldtypen. */
export type DirectCOptionalPrintKind = 'int' | 'double' | 'bool' | 'string';

/** Liefert den stabilen C-Namen des Ausgabehelfers eines nativen Feldtyps. */
export function directCOptionalPrintFunction(kind: DirectCOptionalPrintKind): string {
  return `ps2_print_optional_${kind}`;
}

/**
 * Erzeugt typisierte Ausgabefunktionen fuer Struct-Felder mit `defined`-Status.
 *
 * Der Vertragsmodus deklariert die seiteneffektbehaftete Ausgabe abstrakt. Dadurch
 * muss VeriFast keinen Zweig als unerreichbar beanstanden, wenn der Beweis bereits
 * kennt, dass ein Feld initialisiert ist. Der Implementierungsmodus prueft den
 * Status konkret und gibt wie JavaScript entweder `undefined` oder den Feldwert aus.
 *
 * @param kinds Tatsaechlich benoetigte, deduplizierte native Feldtypen.
 * @param mode Vertrags- oder ausfuehrbarer Implementierungsmodus.
 * @returns C-Deklarationen beziehungsweise vollstaendige Funktionsdefinitionen.
 */
export function directCOptionalPrintRuntime(
  kinds: DirectCOptionalPrintKind[],
  mode: DirectCStringRuntimeMode
): string {
  return kinds.map(kind => {
    const name = directCOptionalPrintFunction(kind);
    const type = kind === 'string' ? 'const char *' : kind;
    if (mode === 'contracts') {
      return [
        `void ${name}(bool defined, ${type} value);`,
        '//@ requires true;',
        '//@ ensures true;'
      ].join('\n');
    }
    const output = kind === 'string'
      ? '  printf("%s\\n", value == NULL ? "null" : value);'
      : kind === 'bool'
        ? '  puts(value ? "true" : "false");'
        : kind === 'double'
          ? '  printf("%.15g\\n", value);'
          : '  printf("%d\\n", value);';
    return [
      `static void ${name}(bool defined, ${type} value) {`,
      '  if (!defined) {',
      '    puts("undefined");',
      '    return;',
      '  }',
      output,
      '}'
    ].join('\n');
  }).join('\n\n');
}
