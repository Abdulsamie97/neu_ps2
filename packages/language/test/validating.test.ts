import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { expandToString as s } from 'langium/generate';
import { parseHelper } from 'langium/test';
import type { Diagnostic } from 'vscode-languageserver-types';
import type { Program } from 'pseudo2-language';
import { createPseudo2Services, isProgram } from 'pseudo2-language';

let services: ReturnType<typeof createPseudo2Services>;
let parse: ReturnType<typeof parseHelper<Program>>;
let document: LangiumDocument<Program> | undefined;

beforeAll(async () => {
    services = createPseudo2Services(EmptyFileSystem);
    const doParse = parseHelper<Program>(services.Pseudo2);
    parse = (input: string) => doParse(input, { validation: true });
});

describe('Validating', () => {
    test('check no errors for valid block', async () => {
        document = await parse('{}');

        expect(
            checkDocumentValid(document) || document?.diagnostics?.map(diagnosticToString)?.join('\n')
        ).toHaveLength(0);
    });

    test('reports parser error for unclosed block', async () => {
        document = await parse('{');

        expect(
            checkDocumentValid(document) || document?.diagnostics?.map(diagnosticToString)?.join('\n')
        ).toEqual(
            expect.stringContaining('Expecting token of type')
        );
    });

    test('reports result outside VeriFast annotations', async () => {
        document = await parse('print result');

        expect(document.diagnostics?.map(diagnosticToString).join('\n')).toContain(
            "'result' darf nur in VeriFast-Annotationen verwendet werden."
        );
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

function diagnosticToString(d: Diagnostic) {
    return `[${d.range.start.line}:${d.range.start.character}..${d.range.end.line}:${d.range.end.character}]: ${d.message}`;
}
