/**
 * @file ExampleOutput.test.ts
 * @brief Führt alle freigegebenen Pseudo2-Beispiele aus und vergleicht ihre dokumentierte Ausgabe.
 *
 * Beispielpfade und erwartete Konsolenausgaben bilden eine Regressionstabelle für
 * Sprachgenerator und JavaScript-Runtime über grundlegende und komplexe Programme.
 *
 * @author Abdul
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { executePseudo2 } from '../helpers/runtime-test-utils.js';

const exampleOutputs: Array<[string, string]> = [
  [
    'serverExamples/arithmetic/fibonacci.pseudo2',
    '0 1 1 2 3 5 8 13 21 34 55 89 144 233 377 610 987 finished'
  ],
  [
    'serverExamples/arithmetic/sieveEratosthenes.pseudo2',
    '2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47 finished'
  ],
  ['serverExamples/basicLanguageConcepts/01_var.pseudo2', '5 10 hello world finished'],
  [
    'serverExamples/basicLanguageConcepts/021_datastructure_primitive.pseudo2',
    '5 1.5 true false hello hello world finished'
  ],
  [
    'serverExamples/basicLanguageConcepts/022_datastructure_array.pseudo2',
    '43 a 6 14 23 24 24 58 58 111 111 3 false 0 true finished'
  ],
  [
    'serverExamples/basicLanguageConcepts/023_datastructure_struct.pseudo2',
    '1 2 3 28 28 28 28 30 30 30 undefined 25 undefined finished'
  ],
  [
    'serverExamples/basicLanguageConcepts/031_loop_for.pseudo2',
    'hello hello hello hello hello hello1 hello1 hello1 1 2 3 4 5 5 4 3 2 1 1 2 3 4 5 finished'
  ],
  [
    'serverExamples/basicLanguageConcepts/032_loop_while.pseudo2',
    '1 2 3 4 5 4 3 2 1 1 2 4 7 do_while false finished'
  ],
  ['serverExamples/basicLanguageConcepts/04_if_then_else.pseudo2', 'x is greater y is smaller 7 finished'],
  [
    'serverExamples/basicLanguageConcepts/05_function.pseudo2',
    '5 120 5 6 5 hej hejjo hej true false true 123 555 123 123 1 5 2 2 finished'
  ],
  [
    'serverExamples/basicLanguageConcepts/06_predefined_operators.pseudo2',
    'helloworld 3 hello false hello 45 hello 9 -3 8 -2 15 0.6 3 truetruefalsefalsefalsetrue truefalsefalsetrue finished'
  ],
  [
    'serverExamples/linkedList/doublyLinkedList.pseudo2',
    '5 8 9 4 1 3 5 8 9 7 3 1 4 4 1 3 7 9 8 5 finished'
  ],
  [
    'serverExamples/linkedList/linkedListCreatedAutomatically.pseudo2',
    '5 8 9 3 1 4 5 8 9 Maximal element has value 9 finished'
  ],
  [
    'serverExamples/linkedList/linkedListCreatedManually.pseudo2',
    '5 8 9 3 1 4 5 8 9 Maximal element has value 9 finished'
  ],
  ['serverExamples/linkedList/stackAsSinglyLinkedList.pseudo2', 'true 8 false 22 4 finished'],
  [
    'serverExamples/queueAndStack/applicationStackForHTMLProcessing.pseudo2',
    "WARNING: Unbalanced document. Expected closing tag 'head' but was 'html' finished"
  ],
  ['serverExamples/queueAndStack/queueAsArray.pseudo2', 'true 3 4 false tail is 3 finished'],
  ['serverExamples/queueAndStack/queueAsArrayImplementedAsADT.pseudo2', 'true 3 4 false tail is 3 finished'],
  [
    'serverExamples/queueAndStack/queueAsArrayWithoutContraction.pseudo2',
    'true 3 4 false head is 3 tail is 5 size is 2 finished'
  ],
  [
    'serverExamples/queueAndStack/queueAsRingBuffer.pseudo2',
    'true 3 false head is 2 tail is 4 size is 2 4 5 finished'
  ],
  ['serverExamples/queueAndStack/stackAsArray.pseudo2', 'true 8 false 22 4 finished'],
  [
    'serverExamples/queueAndStack/stackAsArrayImplementedAsADT.pseudo2',
    'true 8 21 3 true 22 4 finished'
  ],
  ['serverExamples/searching/binarySearch.pseudo2', 'true true false false finished'],
  ['serverExamples/searching/linearSearch.pseudo2', 'true false finished'],
  ['serverExamples/sorting/insertionSort.pseudo2', '2 4 5 6 finished'],
  ['serverExamples/sorting/mergeSort.pseudo2', '2 4 5 6 finished'],
  ['serverExamples/sorting/selectionSort.pseudo2', '2 4 5 6 finished'],
  ['serverExamples/tree/binaryTreeCreatedAutomatically.pseudo2', '5 2 3 6 7 finished']
];

/** Datengesteuerte Integrationssuite für die Ausgabe der mitgelieferten Beispielprogramme. */
describe('ExampleOutput', () => {
  test.each(exampleOutputs)('%s', async (relativePath, expected) => {
    const examplesRoot = fileURLToPath(new URL('../../../../examples/', import.meta.url));
    const text = fs.readFileSync(path.join(examplesRoot, relativePath), 'utf8');

    expect(await executePseudo2(text)).toBe(expected);
  }, 30000);
});
