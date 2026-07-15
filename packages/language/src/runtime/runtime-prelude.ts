/**
 * @file runtime-prelude.ts
 * @brief Setzt die JavaScript-Runtimebestandteile in ihrer notwendigen Abhängigkeitsreihenfolge zusammen.
 * @author Abdul
 */

import { OBSERVABLE_ARRAY_RUNTIME } from './ObservableArray.js';
import { OBSERVABLE_SCALAR_RUNTIME } from './ObservableScalar.js';
import { OBSERVABLE_STRUCT_RUNTIME } from './ObservableStruct.js';
import { PSEUDO2_RUNTIME_HELPERS } from './RuntimeHelpers.js';

/**
 * @brief Vollständige JavaScript-Präambel für jedes generierte Pseudo2-Programm.
 *
 * Skalar-, Array- und Struct-Klassen werden vor den allgemeinen Hilfsfunktionen
 * eingebettet, weil diese Wrapper zur Laufzeit bereits verfügbar sein müssen.
 * Leerzeilen trennen die Bestandteile in der generierten Ausgabe lesbar voneinander.
 */
export const PSEUDO2_RUNTIME_PRELUDE = [
  OBSERVABLE_SCALAR_RUNTIME,
  OBSERVABLE_ARRAY_RUNTIME,
  OBSERVABLE_STRUCT_RUNTIME,
  PSEUDO2_RUNTIME_HELPERS
].join('\n\n');
