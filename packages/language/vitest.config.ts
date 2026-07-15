/**
 * @file vitest.config.ts
 * @brief Konfiguriert Vitest für Parser-, Validator-, Generator- und Runtime-Tests des Language-Pakets.
 * @author Abdul
 */

/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://vitest.dev/config/
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    /** Einstellungen zur Testsuche und Modulinteroperabilität. */
    test: {
        /** Behandelt CommonJS-Default-Exporte kompatibel zu ESM-Importen. */
        deps: {
            interopDefault: true
        },
        /** Führt alle auf `.test.ts` endenden Dateien im Paket aus. */
        include: ['**/*.test.ts']
    }
});
