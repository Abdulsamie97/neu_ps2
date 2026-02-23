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

describe('Structure tests', () => {
    test('nested block parent-child relationship', async () => {
        document = await parse(`
            {
                {}
            }
        `);

        const rootBlock = document.parseResult.value.instructions[0];
        const nestedBlock = rootBlock.instructions[0];

        expect(
            checkDocumentValid(document)
                || `${nestedBlock.$container === rootBlock}|${rootBlock.$container === document.parseResult.value}`
        ).toBe(s`
            true|true
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
