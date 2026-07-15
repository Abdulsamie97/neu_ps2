/**
 * @file validating.test.ts
 * @brief Prüft die Langium-Validierung und grundlegende Syntaxregeln der VeriFast-Annotationen.
 *
 * Abgedeckt sind Parserfehler, der Gültigkeitsbereich von `result` und `vf_*`,
 * Prädikatstelligkeit, Stringinhalte, rationale Nenner und Schleifeniteratoren.
 *
 * @author Abdul
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { expandToString as s } from 'langium/generate';
import { parseHelper } from 'langium/test';
import type { Diagnostic } from 'vscode-languageserver-types';
import type { Program } from 'pseudo2-language';
import { createPseudo2Services, isProgram } from 'pseudo2-language';

/** Gemeinsam genutzte Pseudo2-Dienste der Testsuite. */
let services: ReturnType<typeof createPseudo2Services>;
/** Parsehilfe, die für jedes Dokument die vollständige Validierung aktiviert. */
let parse: ReturnType<typeof parseHelper<Program>>;
/** Zuletzt geparstes und validiertes Dokument. */
let document: LangiumDocument<Program> | undefined;

/** Initialisiert Services und eine validierende Parsefunktion einmalig vor der Suite. */
beforeAll(async () => {
    services = createPseudo2Services(EmptyFileSystem);
    const doParse = parseHelper<Program>(services.Pseudo2);
    parse = (input: string) => doParse(input, { validation: true });
});

/** Testgruppe für Parser- und semantische Validierungsdiagnosen. */
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

    test('reports structured VeriFast helpers outside annotations', async () => {
        document = await parse('print vf_array(1)');

        expect(document.diagnostics?.map(diagnosticToString).join('\n')).toContain(
            "'vf_array' darf nur in VeriFast-Annotationen verwendet werden."
        );
    });

    test('reports structured VeriFast helper arity errors', async () => {
        document = await parse(`
            func f()
              @assert vf_array()
              return 1
        `);

        expect(document.diagnostics?.map(diagnosticToString).join('\n')).toContain(
            "'vf_array' erwartet genau ein Argument."
        );
    });

    test('reports structured VeriFast element helper arity errors', async () => {
        document = await parse(`
            func f()
              @assert vf_elem(result)
              return 1
        `);

        expect(document.diagnostics?.map(diagnosticToString).join('\n')).toContain(
            "'vf_elem' erwartet genau zwei Argumente."
        );
    });

    test('reports structured VeriFast field helper name errors', async () => {
        document = await parse(`
            func f()
              @assert vf_field(result, 1)
              return 1
        `);

        expect(document.diagnostics?.map(diagnosticToString).join('\n')).toContain(
            "'vf_field' erwartet als zweites Argument einen Feldnamen als Stringliteral."
        );
    });

    test('accepts one or two vf_string arguments and requires a literal content value', async () => {
        const valid = await parse(`
            func f()
              @assert vf_string(result)
              @assert vf_string(result, "abc")
              return "abc"
        `);
        expect(valid.diagnostics?.map(diagnosticToString).join('\n') ?? '').not.toContain("'vf_string' erwartet");

        const invalidArity = await parse(`
            func f()
              @assert vf_string()
              return "abc"
        `);
        expect(invalidArity.diagnostics?.map(diagnosticToString).join('\n')).toContain(
            "'vf_string' erwartet genau ein oder zwei Argumente."
        );

        const invalidContent = await parse(`
            func f(x)
              @assert vf_string(result, x)
              return "abc"
        `);
        expect(invalidContent.diagnostics?.map(diagnosticToString).join('\n')).toContain(
            "'vf_string' erwartet als zweites Argument einen konkreten String als Stringliteral."
        );
    });

    test('accepts only non-zero integer literal denominators for vf_ratio', async () => {
        const valid = await parse(`
            @ensures vf_real(result) == vf_ratio(5, 2)
            func halfFive()
              return 5 / 2
        `);
        expect(valid.diagnostics?.map(diagnosticToString).join('\n') ?? '').not.toContain("'vf_ratio' erwartet");

        for (const denominator of ['0', 'result']) {
            const invalid = await parse(`
                @ensures vf_real(result) == vf_ratio(5, ${denominator})
                func invalidRatio()
                  return 5 / 2
            `);
            expect(invalid.diagnostics?.map(diagnosticToString).join('\n')).toContain(
                "'vf_ratio' erwartet als zweites Argument ein von null verschiedenes Ganzzahlliteral."
            );
        }
    });

    test('resolves a for-loop iterator in invariants and verification statements', async () => {
        document = await parse(`
            @invariant vf_integer(i) && vf_int(i) >= 1
            for i = 1 to 3
              @assert vf_int(i) <= 3
        `);

        expect(document.diagnostics?.map(diagnosticToString).join('\n') ?? '').not.toContain("Unbekannte Variable");
        expect(document.diagnostics?.map(diagnosticToString).join('\n') ?? '').not.toContain("Could not resolve reference");
    });
});

/**
 * Prüft Parserfehler und den erwarteten Program-Wurzeltyp.
 * @param document Zu untersuchendes Langium-Dokument.
 * @returns Formatierte Strukturdiagnose oder `undefined` bei gültigem Parse-Ergebnis.
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

/**
 * Formatiert eine LSP-Diagnose einschließlich nullbasierter Start- und Endposition.
 * @param d Zu formatierende Diagnose.
 * @returns Kompakte Zeichenkette für Testvergleiche.
 */
function diagnosticToString(d: Diagnostic) {
    return `[${d.range.start.line}:${d.range.start.character}..${d.range.end.line}:${d.range.end.character}]: ${d.message}`;
}
