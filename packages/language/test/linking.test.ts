/**
 * @file linking.test.ts
 * @brief Prüft AST-Containerbeziehungen nach Parsing und Linking verschachtelter Blöcke.
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
/** Zuletzt geparstes Dokument für strukturelle Assertions. */
let document: LangiumDocument<Program> | undefined;

/** Initialisiert Services und Parser einmalig vor allen Linking-Tests. */
beforeAll(async () => {
    services = createPseudo2Services(EmptyFileSystem);
    parse = parseHelper<Program>(services.Pseudo2);
});

/** Testgruppe für Eltern-Kind-Verknüpfungen des aufgebauten Pseudo2-ASTs. */
describe('Structure tests', () => {
    test('nested block parent-child relationship', async () => {
        document = await parse(`
            {
                {}
            }
        `);

        const rootBlock = document.parseResult.value.instructions[0];
        if (!isBracedBlock(rootBlock) && !isIndentedBlock(rootBlock)) {
            throw new Error(`Expected block, got ${rootBlock.$type}`);
        }

        const nestedBlock = rootBlock.instructions[0];

        expect(
            checkDocumentValid(document)
                || `${nestedBlock.$container === rootBlock}|${rootBlock.$container === document.parseResult.value}`
        ).toBe(s`
            true|true
        `);
    });
});

/**
 * Prüft grundlegende Parserkonsistenz und den erwarteten Program-Wurzeltyp.
 * @param document Zu untersuchendes Langium-Dokument.
 * @returns Formatierte Fehlermeldung oder `undefined` bei gültiger Struktur.
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
