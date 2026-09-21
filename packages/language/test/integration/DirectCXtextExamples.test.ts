/**
 * @file DirectCXtextExamples.test.ts
 * @brief Prueft den portierten Xtext- und regulaeren Beispielkorpus mit Direct C.
 *
 * Jede regulaere Pseudo2-Datei unter `examples` wird isoliert validiert und in die
 * ausfuehrbare native C-Variante uebersetzt. Fuer die VeriFast-Vertragsvariante wird
 * zugleich sichergestellt, dass ausschliesslich die bekannten Division-/Potenzfaelle
 * am noch fehlenden Rationalmodell enden. Neue Direct-C- und spezielle VeriFast-
 * Beispiele besitzen eigene Testsuiten und bleiben hier bewusst getrennt.
 *
 * @author Abdul
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmptyFileSystem, URI } from 'langium';
import { describe, expect, test } from 'vitest';

import { generateDirectCProgram } from '../../src/generators/c/c-generator-direct.js';
import type { Program } from '../../src/generated/ast.js';
import { createPseudo2Services } from '../../src/pseudo2-module.js';

/** Absoluter Pfad des gemeinsamen Beispielverzeichnisses. */
const EXAMPLES_ROOT = fileURLToPath(new URL('../../../../examples', import.meta.url));

/** Regulaere Beispiele ohne die spaeteren Direct-C- und VeriFast-Spezialsuiten. */
const REGULAR_EXAMPLES = collectPseudo2Files(EXAMPLES_ROOT)
  .filter(file => !relativeExamplePath(file).startsWith('verifast/'))
  .filter(file => !path.basename(file).startsWith('direct-c-'))
  .sort((left, right) => left.localeCompare(right));

/** Exakt die drei aus `org.xtext.mua.pseudo2.examples` portierten Verzeichnisbaeume. */
const PORTED_XTEXT_EXAMPLES = REGULAR_EXAMPLES.filter(file =>
  /^(codeSnippets|lectureWS1920|serverExamples)\//.test(relativeExamplePath(file))
);

/** Exakte Xtext-Beispiele mit Division oder Potenz, die ein Rationalmodell benoetigen. */
const FRACTIONAL_CONTRACT_EXAMPLES = [
  'codeSnippets/landingPageDoc/multipleVars_gobalBlock.pseudo2',
  'codeSnippets/landingPageDoc/multipleVars_ifThenBlock.pseudo2',
  'lectureWS1920/lect05/bin_search.pseudo2',
  'lectureWS1920/lect05/merge_sort.pseudo2',
  'lectureWS1920/lect05/merge_sortV2.pseudo2',
  'lectureWS1920/lect09/treeAddElementPrint.pseudo2',
  'lectureWS1920/lect09/visit.pseudo2',
  'serverExamples/arithmetic/sieveEratosthenes.pseudo2',
  'serverExamples/basicLanguageConcepts/021_datastructure_primitive.pseudo2',
  'serverExamples/basicLanguageConcepts/06_predefined_operators.pseudo2',
  'serverExamples/misc/towerOfHanoi.pseudo2',
  'serverExamples/searching/binarySearch.pseudo2',
  'serverExamples/sorting/mergeSort.pseudo2',
  'test.pseudo2',
  'test2.pseudo2'
].sort((left, right) => left.localeCompare(right));

/** Beschreibt einen fehlgeschlagenen Verarbeitungsschritt fuer genau eine Beispieldatei. */
type CorpusFailure = {
  /** Relativer, plattformunabhaengiger Pfad der Beispieldatei. */
  file: string;
  /** Lesbare Parser-, Validierungs- oder Generatorfehlermeldung. */
  message: string;
};

/** Integrationssuite fuer die native Uebersetzung des gesamten Xtext-Beispielbestands. */
describe('Direct C Xtext and regular example corpus', () => {
  test('discovers the complete ported example inventory', () => {
    expect(PORTED_XTEXT_EXAMPLES).toHaveLength(87);
    expect(REGULAR_EXAMPLES).toHaveLength(91);
  });

  test('generates executable native C for every ported example', async () => {
    const failures = await generateCorpus('implementation');
    expect(failures).toEqual([]);
  }, 60_000);

  test('limits native VeriFast contract generation to the exact rational-model boundary', async () => {
    const failures = await generateCorpus('contracts');
    expect(failures.map(failure => failure.file)).toEqual(FRACTIONAL_CONTRACT_EXAMPLES);
    expect(failures.every(failure => failure.message.includes('Gleitkomma-/Rationalmodell'))).toBe(true);
  }, 60_000);
});

/**
 * Validiert und generiert jede portierte Beispieldatei in dem angegebenen Modus.
 *
 * Fehler werden gesammelt, damit ein Testlauf alle betroffenen Dateien gleichzeitig
 * nennt und nicht bereits beim ersten problematischen Beispiel abbricht.
 *
 * @param runtime Gewuenschte konkrete oder abstrakte Direct-C-Runtimevariante.
 * @returns Liste aller Dateien, deren Validierung oder Generierung fehlgeschlagen ist.
 */
async function generateCorpus(runtime: 'contracts' | 'implementation'): Promise<CorpusFailure[]> {
  const failures: CorpusFailure[] = [];

  for (const file of REGULAR_EXAMPLES) {
    try {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.trim()) continue;

      const services = createPseudo2Services(EmptyFileSystem);
      const document = services.shared.workspace.LangiumDocumentFactory.fromString(source, URI.file(file));
      await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
      const errors = (document.diagnostics ?? [])
        .filter(diagnostic => diagnostic.severity === 1)
        .map(diagnostic => diagnostic.message);
      if (errors.length > 0) {
        failures.push({ file: relativeExamplePath(file), message: errors.join(' | ') });
        continue;
      }

      const generated = generateDirectCProgram(document.parseResult.value as Program, { runtime });
      if (!generated.includes('int main(void)')) {
        failures.push({ file: relativeExamplePath(file), message: 'Direct C enthaelt keine main-Funktion.' });
      }
    } catch (error) {
      failures.push({ file: relativeExamplePath(file), message: formatError(error) });
    }
  }

  return failures;
}

/**
 * Sammelt rekursiv alle Pseudo2-Dateien unterhalb eines Verzeichnisses.
 * @param dir Aktuell zu durchsuchendes Verzeichnis.
 * @returns Absolut aufgeloeste Dateipfade einschliesslich der Unterverzeichnisse.
 */
function collectPseudo2Files(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPseudo2Files(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.pseudo2')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Normalisiert einen absoluten Beispielpfad fuer Testdiagnosen.
 * @param file Absoluter Dateipfad innerhalb von `examples`.
 * @returns Relativer Pfad mit plattformunabhaengigen Schraegen.
 */
function relativeExamplePath(file: string): string {
  return path.relative(EXAMPLES_ROOT, file).replace(/\\/g, '/');
}

/**
 * Wandelt beliebige geworfene Werte in eine stabile Testmeldung um.
 * @param error Geworfener Fehler oder sonstiger Wert.
 * @returns Fehlermeldung ohne Stacktrace und temporaere Pfade.
 */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
