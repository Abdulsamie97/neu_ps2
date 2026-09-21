/**
 * @file c-direct-string-runtime.ts
 * @brief Liefert die kleine native String-Hilfsschicht des lesbaren C-Generators.
 * @author Abdul
 */

/** Bestimmt, ob nur VeriFast-Vertraege oder die ausfuehrbare Implementierung ausgegeben wird. */
export type DirectCStringRuntimeMode = 'contracts' | 'implementation';

/**
 * Erzeugt die String-Helfer fuer Vergleich, Wahrheitswert, Verkettung und Zahlenkonvertierung.
 *
 * Im Vertragsmodus bleiben die Funktionen abstrakt. Der praezise Nicht-null-Vergleich
 * erhaelt beide gelesenen Zeichenlisten und koppelt das Ergebnis an deren Gleichheit.
 * `ps2_concat_text` beschreibt die exakte Verkettung der beiden Zeichenlisten. Zahlenkonvertierungen
 * garantieren mindestens einen gueltigen, dauerhaft lesbaren C-String, weil deren
 * konkrete Dezimaldarstellung in VeriFast nicht fuer alle C-Zahlen modelliert ist.
 * Die Implementierung verwaltet alle erzeugten Strings in einer kleinen Arena und
 * gibt sie per `atexit` frei. Dadurch bleiben Rueckgaben und Zwischenwerte bis zum
 * Programmende gueltig, wie es die Garbage-Collection der JavaScript-Ausgabe erlaubt.
 *
 * @param mode Gewuenschte Vertrags- oder Implementierungsvariante.
 * @param integerNumbers `true`, wenn Pseudo2-Zahlen als C-`int` erzeugt werden.
 * @returns Vollstaendige C-Deklarationen beziehungsweise Implementierungen.
 */
export function directCStringRuntime(mode: DirectCStringRuntimeMode, integerNumbers: boolean): string {
  if (mode === 'contracts') {
    return [
      'bool ps2_text_equal(const char *left, const char *right);',
      '//@ requires true;',
      '//@ ensures true;',
      '',
      'bool ps2_text_equal_nonnull(const char *left, const char *right);',
      '//@ requires [_]string((char *)left, ?leftChars) &*& [_]string((char *)right, ?rightChars);',
      '//@ ensures [_]string((char *)left, leftChars) &*& [_]string((char *)right, rightChars) &*& result == (leftChars == rightChars);',
      '',
      'bool ps2_text_truthy(const char *value);',
      '//@ requires true;',
      '//@ ensures true;',
      '',
      'char *ps2_concat_text(const char *left, const char *right);',
      '//@ requires [_]string((char *)left, ?leftChars) &*& [_]string((char *)right, ?rightChars);',
      '//@ ensures [_]string((char *)left, leftChars) &*& [_]string((char *)right, rightChars) &*& result != 0 &*& [_]string(result, append(leftChars, rightChars));',
      '',
      integerNumbers ? 'char *ps2_number_to_text(int value);' : 'char *ps2_number_to_text(double value);',
      '//@ requires true;',
      '//@ ensures result != 0 &*& [_]string(result, ?chars);'
    ].join('\n');
  }

  const numberFormat = integerNumbers ? '"%d"' : '"%.15g"';
  return String.raw`typedef struct Ps2DirectStringAllocation {
  char *value;
  struct Ps2DirectStringAllocation *next;
} Ps2DirectStringAllocation;

static Ps2DirectStringAllocation *ps2_direct_strings = NULL;
static bool ps2_direct_string_cleanup_registered = false;

static bool ps2_text_equal(const char *left, const char *right) {
  if (left == NULL || right == NULL) return left == right;
  return strcmp(left, right) == 0;
}

static bool ps2_text_equal_nonnull(const char *left, const char *right) {
  if (left == NULL || right == NULL) return left == right;
  return strcmp(left, right) == 0;
}

static bool ps2_text_truthy(const char *value) {
  return value != NULL && value[0] != '\0';
}

static void ps2_cleanup_strings(void) {
  while (ps2_direct_strings != NULL) {
    Ps2DirectStringAllocation *entry = ps2_direct_strings;
    ps2_direct_strings = entry->next;
    free(entry->value);
    free(entry);
  }
}

static char *ps2_allocate_text(size_t length) {
  if (length == SIZE_MAX) abort();
  char *value = (char *)malloc(length + 1);
  Ps2DirectStringAllocation *entry = (Ps2DirectStringAllocation *)malloc(sizeof(Ps2DirectStringAllocation));
  if (value == NULL || entry == NULL) {
    free(value);
    free(entry);
    abort();
  }
  if (!ps2_direct_string_cleanup_registered) {
    if (atexit(ps2_cleanup_strings) != 0) abort();
    ps2_direct_string_cleanup_registered = true;
  }
  entry->value = value;
  entry->next = ps2_direct_strings;
  ps2_direct_strings = entry;
  return value;
}

static char *ps2_concat_text(const char *left, const char *right) {
  size_t leftLength = strlen((char *)left);
  size_t rightLength = strlen((char *)right);
  if (rightLength == SIZE_MAX) abort();
  size_t remaining = SIZE_MAX - rightLength;
  if (leftLength > remaining - 1) abort();
  char *result = ps2_allocate_text(leftLength + rightLength);
  memcpy(result, left, leftLength);
  memcpy(result + leftLength, right, rightLength);
  result[leftLength + rightLength] = '\0';
  return result;
}

static char *ps2_number_to_text(${integerNumbers ? 'int' : 'double'} value) {
  char buffer[64];
  int length = snprintf(buffer, sizeof(buffer), ${numberFormat}, value);
  if (length < 0 || (size_t)length >= sizeof(buffer)) abort();
  char *result = ps2_allocate_text((size_t)length);
  memcpy(result, buffer, (size_t)length + 1);
  return result;
}`;
}
