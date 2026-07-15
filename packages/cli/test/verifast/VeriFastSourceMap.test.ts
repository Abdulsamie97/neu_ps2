/**
 * @file VeriFastSourceMap.test.ts
 * @brief Prüft VeriFast-Ausführung, Pseudo2-Source-Map-Diagnosen und die konkreten C-Runtimes.
 *
 * Gültige Beispiele müssen beweisbar sein, absichtlich ungültige Beispiele müssen
 * Pseudo2-Zeilen melden. Zusätzlich werden Heap- und Skalar-Runtime separat und als
 * gemeinsames Bundle mit einem generierten Programm verifiziert.
 *
 * @author Abdul
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { generateCAction } from '../../src/main.js';
import {
  applyCSourceMapToVeriFastResult,
  runVeriFast,
  runVeriFastBundle,
  type CSourceMapFile,
  type VeriFastResult
} from '../../src/verifast.js';

/** Absoluter Wurzelpfad des Repositories ausgehend vom Testmodul. */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
/** Verzeichnis der gültigen und ungültigen Pseudo2-VeriFast-Beispiele. */
const examplesRoot = path.join(repoRoot, 'examples', 'verifast');
/** Im Repository erwartete VeriFast-Programmdatei. */
const verifastExe = path.join(repoRoot, 'verifast-26.01', 'bin', 'verifast.exe');
/** Konkret separat verifizierte Array- und Struct-Heap-Runtime. */
const concreteHeapRuntime = path.join(repoRoot, 'runtime', 'c', 'pseudo2_heap_runtime.c');
/** Konkret separat verifizierte Skalar-, String-, I/O- und Disposal-Runtime. */
const concreteScalarRuntime = path.join(repoRoot, 'runtime', 'c', 'pseudo2_scalar_runtime.c');

/** Beispiele, deren generierter C-Code von VeriFast vollständig akzeptiert werden muss. */
const validExamples = [
  'valid_array_parameter_length.pseudo2',
  'valid_array_parameter_dynamic_index.pseudo2',
  'valid_array_parameter_element.pseudo2',
  'valid_assert_true.pseudo2',
  'valid_bool_expression.pseudo2',
  'valid_do_invariant_true.pseudo2',
  'valid_direct_array_access.pseudo2',
  'valid_direct_nested_array_access.pseudo2',
  'valid_for_invariant_true.pseudo2',
  'valid_loop_assert.pseudo2',
  'valid_loop_invariant_true.pseudo2',
  'valid_model_array_element.pseudo2',
  'valid_model_array_fill_elements.pseudo2',
  'valid_model_array_literal_element.pseudo2',
  'valid_model_array_result.pseudo2',
  'valid_model_arithmetic.pseudo2',
  'valid_model_real_division.pseudo2',
  'valid_model_for_invariant.pseudo2',
  'valid_model_for_dynamic_invariant.pseudo2',
  'valid_model_while_invariant.pseudo2',
  'valid_model_bool_string_null.pseudo2',
  'valid_model_comparison.pseudo2',
  'valid_model_equality.pseudo2',
  'valid_model_string_content.pseudo2',
  'valid_model_string_concat.pseudo2',
  'valid_model_struct_default_field.pseudo2',
  'valid_model_struct_field.pseudo2',
  'valid_model_struct_result.pseudo2',
  'valid_model_value_int.pseudo2',
  'valid_model_truthy.pseudo2',
  'valid_multiple_asserts.pseudo2',
  'valid_nested_heap_ownership.pseudo2',
  'valid_nested_container_ownership.pseudo2',
  'valid_nested_arrays.pseudo2',
  'valid_parameter_alias_ownership.pseudo2',
  'valid_replaced_child_ownership.pseudo2',
  'valid_raw_specs.pseudo2',
  'valid_result_ensures_non_null.pseudo2',
  'valid_struct_parameter_field.pseudo2',
  'valid_struct_method.pseudo2',
  'valid_stateful_array_loop.pseudo2',
  'valid_stateful_array_alias.pseudo2',
  'valid_stateful_struct_loop.pseudo2',
  'valid_stateful_struct_alias.pseudo2',
  'valid_terminates_and_assume.pseudo2',
  'valid_top_level_assert.pseudo2'
];

/** Beispiele, die gezielt einen Beweisfehler mit rückgemappter Pseudo2-Zeile erzeugen. */
const invalidExamples = [
  'invalid_assert_false.pseudo2',
  'invalid_assert_expression.pseudo2',
  'invalid_ensures_false.pseudo2',
  'invalid_direct_array_access.pseudo2',
  'invalid_direct_nested_array_access.pseudo2',
  'invalid_loop_assert_false.pseudo2',
  'invalid_loop_invariant_false.pseudo2',
  'invalid_method_assert_false.pseudo2',
  'invalid_array_parameter_element.pseudo2',
  'invalid_model_array_element.pseudo2',
  'invalid_model_array_fill_elements.pseudo2',
  'invalid_model_array_literal_element.pseudo2',
  'invalid_model_array_length.pseudo2',
  'invalid_model_arithmetic.pseudo2',
  'invalid_model_real_division.pseudo2',
  'invalid_model_while_invariant.pseudo2',
  'invalid_model_divide.pseudo2',
  'invalid_model_modulo.pseudo2',
  'invalid_model_multiply.pseudo2',
  'invalid_model_power.pseudo2',
  'invalid_model_subtract.pseudo2',
  'invalid_model_bool_value.pseudo2',
  'invalid_model_comparison.pseudo2',
  'invalid_model_equality.pseudo2',
  'invalid_model_int_value.pseudo2',
  'invalid_model_null_value.pseudo2',
  'invalid_model_string_value.pseudo2',
  'invalid_model_truthy.pseudo2',
  'invalid_model_string_content.pseudo2',
  'invalid_model_string_concat.pseudo2',
  'invalid_model_struct_default_field.pseudo2',
  'invalid_model_struct_field.pseudo2',
  'invalid_nested_heap_ownership.pseudo2',
  'invalid_nested_container_ownership.pseudo2',
  'invalid_parameter_alias_ownership.pseudo2',
  'invalid_replaced_child_ownership.pseudo2',
  'invalid_raw_assert_false.pseudo2',
  'invalid_requires_false_call.pseudo2',
  'invalid_result_ensures_null.pseudo2',
  'invalid_struct_parameter_field.pseudo2',
  'invalid_stateful_array_loop.pseudo2',
  'invalid_stateful_array_alias.pseudo2',
  'invalid_stateful_struct_loop.pseudo2',
  'invalid_stateful_struct_alias.pseudo2',
  'invalid_top_level_assert_false.pseudo2'
];

/** Integrationssuite für Source Maps, Beispiele und konkrete Runtime-Beweise. */
describe('VeriFast source maps', () => {
  test('maps VeriFast C diagnostics back to Pseudo2 source lines', () => {
    const result: VeriFastResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      errors: [
        {
          file: 'generated.c',
          line: 42,
          colFrom: 7,
          colTo: 12,
          kind: 'error',
          message: 'Assertion might not hold.'
        }
      ]
    };

    const mapped = applyCSourceMapToVeriFastResult(result, {
      sourceFile: 'program.pseudo2',
      mappings: [{ generatedLine: 42, sourceLine: 4 }]
    });

    expect(mapped.errors[0]).toMatchObject({
      sourceFile: 'program.pseudo2',
      sourceLine: 4
    });
  });

  /** Verwendet echte Tests nur bei vorhandener Repository-VeriFast-Installation. */
  const testWithVeriFast = fs.existsSync(verifastExe) ? test : test.skip;
  /** Gemeinsames temporäres Zielverzeichnis der datengesteuerten Beispielverifikation. */
  const examplesDestination = fs.existsSync(verifastExe)
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-verifast-examples-'))
    : '';

  testWithVeriFast.each(validExamples)('verifies valid example %s', async example => {
    const result = await generateAndVerify(example, examplesDestination);
    expect(result.ok, formatFailure(example, result)).toBe(true);
  }, 65_000);

  testWithVeriFast.each(invalidExamples)('maps diagnostics for invalid example %s', async example => {
    const result = await generateAndVerify(example, examplesDestination);
    expect(result.ok, `${example} should fail VeriFast`).toBe(false);
    expect(
      result.errors.some(error => typeof error.sourceLine === 'number'),
      `${example} should contain at least one Pseudo2-mapped diagnostic:\n${formatFailure(example, result)}`
    ).toBe(true);
  }, 65_000);

  testWithVeriFast('verifies the concrete C array and Struct heap runtime', async () => {
    const result = await runVeriFast({
      verifastExe,
      file: concreteHeapRuntime,
      compileOnly: true
    });

    expect(result.ok, formatRuntimeFailure(result)).toBe(true);
  });

  testWithVeriFast('verifies the concrete C scalar, string, floating-point, I/O and disposal runtime', async () => {
    const result = await runVeriFast({
      verifastExe,
      file: concreteScalarRuntime,
      compileOnly: true
    });

    expect(result.ok, formatRuntimeFailure(result)).toBe(true);
  });

  testWithVeriFast('verifies runtime kernels and a generated program as one bundle', async () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-verifast-bundle-'));
    const example = 'valid_nested_arrays.pseudo2';
    await generateCAction(path.join(examplesRoot, example), { destination });
    const cPath = path.join(destination, `${generatedBaseName(example)}.c`);
    const result = await runVeriFastBundle({
      verifastExe,
      file: cPath,
      runtimeFiles: [concreteHeapRuntime, concreteScalarRuntime],
      compileOnly: true
    });

    expect(result.ok, formatRuntimeFailure(result)).toBe(true);
    expect(result.runtimeChecks).toHaveLength(2);
    expect(result.runtimeChecks.every(check => check.ok)).toBe(true);
  });
});

/**
 * Generiert C und Source Map eines Beispiels, startet VeriFast und mappt dessen Diagnosen zurück.
 * @param example Dateiname unterhalb des VeriFast-Beispielordners.
 * @param destination Temporäres Zielverzeichnis für C und Map.
 * @returns VeriFast-Ergebnis mit ergänzten Pseudo2-Quellpositionen.
 */
async function generateAndVerify(example: string, destination: string): Promise<VeriFastResult> {
  const sourcePath = path.join(examplesRoot, example);
  await generateCAction(sourcePath, { destination });

  const cPath = path.join(destination, `${generatedBaseName(example)}.c`);
  const sourceMap = JSON.parse(fs.readFileSync(`${cPath}.map.json`, 'utf8')) as CSourceMapFile;
  const result = await runVeriFast({
    verifastExe,
    file: cPath,
    compileOnly: true
  });

  return applyCSourceMapToVeriFastResult(result, sourceMap);
}

/** @param fileName Pseudo2-Dateiname. @returns Für die CLI-Ausgabe bereinigter Basisname. */
function generatedBaseName(fileName: string): string {
  return path.basename(fileName, path.extname(fileName)).replace(/[.-]/g, '');
}

/**
 * Formatiert alle Prozessausgaben und Diagnosen eines fehlgeschlagenen Beispielbeweises.
 * @param example Name des geprüften Beispiels.
 * @param result VeriFast-Ergebnis.
 * @returns Mehrzeilige Vitest-Fehlermeldung.
 */
function formatFailure(example: string, result: VeriFastResult): string {
  return [
    `${example}: exit ${result.exitCode}`,
    result.stdout.trim(),
    result.stderr.trim(),
    JSON.stringify(result.errors, null, 2)
  ].filter(Boolean).join('\n');
}

/**
 * Formatiert Prozessausgaben und Diagnosen einer fehlgeschlagenen Runtime-Verifikation.
 * @param result VeriFast-Ergebnis.
 * @returns Mehrzeilige Vitest-Fehlermeldung.
 */
function formatRuntimeFailure(result: VeriFastResult): string {
  return [
    `concrete heap runtime: exit ${result.exitCode}`,
    result.stdout.trim(),
    result.stderr.trim(),
    JSON.stringify(result.errors, null, 2)
  ].filter(Boolean).join('\n');
}
