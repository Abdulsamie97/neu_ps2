import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { expandToString as s } from 'langium/generate';
import { parseHelper } from 'langium/test';
import type { Program } from 'pseudo2-language';
import { createPseudo2Services, isProgram } from 'pseudo2-language';

let services: ReturnType<typeof createPseudo2Services>;
let parse: ReturnType<typeof parseHelper<Program>>;
let document: LangiumDocument<Program> | undefined;

beforeAll(async () => {
    services = createPseudo2Services(EmptyFileSystem);
    parse = parseHelper<Program>(services.Pseudo2);
});

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
                      .map(instruction => instruction.instructions.length)
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

function checkDocumentValid(document: LangiumDocument): string | undefined {
    return document.parseResult.parserErrors.length && s`
        Parser errors:
          ${document.parseResult.parserErrors.map(e => e.message).join('\n  ')}
    `
        || document.parseResult.value === undefined && `ParseResult is 'undefined'.`
        || !isProgram(document.parseResult.value) && `Root AST object is a ${document.parseResult.value.$type}, expected a 'Program'.`
        || undefined;
}
