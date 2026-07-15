/**
 * @file parsing.test.ts
 * @brief Prüft den grundlegenden Aufbau verschachtelter geklammerter Pseudo2-Blöcke.
 * @author Abdul
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { expandToString as s } from 'langium/generate';
import { parseHelper } from 'langium/test';
import type { Program } from 'pseudo2-language';
import { createPseudo2Services, isBracedBlock, isIndentedBlock, isProgram } from 'pseudo2-language';

/** Gemeinsam genutzte Pseudo2-Dienste der Testsuite. */
let services: ReturnType<typeof createPseudo2Services>;
/** Auf das Pseudo2-Modul gebundene Langium-Parsehilfe. */
let parse: ReturnType<typeof parseHelper<Program>>;
/** Zuletzt geparstes Dokument für AST-Auswertungen. */
let document: LangiumDocument<Program> | undefined;

/** Initialisiert Services und Parser einmalig vor allen Parsing-Tests. */
beforeAll(async () => {
    services = createPseudo2Services(EmptyFileSystem);
    parse = parseHelper<Program>(services.Pseudo2);
});

/** Testgruppe für grundlegende Parsergebnisse und Blockverschachtelung. */
describe('Parsing tests', () => {
    test('parse nested braced blocks', async () => {
        document = await parse(`
            {
                {}
            }
        `);

        expect(
            checkDocumentValid(document) || s`
                Top-level instructions:
                  ${document.parseResult.value.instructions.length}
                Nested instructions:
                  ${document.parseResult.value.instructions
                      .map(instruction => (isBracedBlock(instruction) || isIndentedBlock(instruction))
                          ? instruction.instructions.length
                          : 0)
                      .join('\n  ')}
            `
        ).toBe(s`
            Top-level instructions:
              1
            Nested instructions:
              1
        `);
    });
});

/**
 * Prüft Parserfehler und den erwarteten Program-Wurzeltyp eines Dokuments.
 * @param document Zu untersuchendes Langium-Dokument.
 * @returns Formatierte Fehlermeldung oder `undefined` bei gültigem Parse-Ergebnis.
 */
function checkDocumentValid(document: LangiumDocument): string | undefined {
    return document.parseResult.parserErrors.length && s`
        Parser errors:
          ${document.parseResult.parserErrors.map(e => e.message).join('\n  ')}
    `
        || document.parseResult.value === undefined && `ParseResult is 'undefined'.`
        || !isProgram(document.parseResult.value) && `Root AST object is a ${document.parseResult.value.$type}, expected a 'Program'.`
        || undefined;
}
