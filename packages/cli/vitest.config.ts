/**
 * @file vitest.config.ts
 * @brief Konfiguriert die nichtinteraktiven Generator- und VeriFast-Tests des CLI-Pakets.
 * @author Abdul
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  /** Einstellungen für CLI-Testsuche, ESM-Interoperabilität und Watch-Verhalten. */
  test: {
    /** Aktiviert kompatible Default-Imports aus CommonJS-Abhängigkeiten. */
    deps: {
      interopDefault: true
    },
    /** Beschränkt die Suite auf Testdateien unter dem CLI-Testordner. */
    include: ['test/**/*.test.ts'],
    /** Verhindert im automatisierten Lauf einen dauerhaft aktiven Watch-Prozess. */
    watch: false
  }
});
