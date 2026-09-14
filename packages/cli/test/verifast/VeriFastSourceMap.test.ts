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
  buildPseudo2VerificationTrees,
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
  'valid_bounded_multiply.pseudo2',
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
  'valid_natural_scalar_annotations.pseudo2',
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
  'invalid_mult_by_add_overflow.pseudo2',
  'invalid_mult_by_add_postcondition.pseudo2',
  'invalid_multiple_functions.pseudo2',
  'invalid_natural_scalar_annotations.pseudo2',
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
  test('covers every VeriFast example and keeps annotations in direct Pseudo2 syntax', () => {
    const files = fs.readdirSync(examplesRoot).filter(name => name.endsWith('.pseudo2')).sort();
    expect([...validExamples, ...invalidExamples].sort()).toEqual(files);
    for (const file of files) {
      expect(fs.readFileSync(path.join(examplesRoot, file), 'utf8'), file)
        .not.toMatch(/\b(?:vf_[A-Za-z0-9_]+|isValue|isNumber|isInteger|isArray|isStruct|intValue|realValue|ratio|booleanValue|isTruthy|isString|isNull|isUndefined|element|field|inBounds|same)\s*\(/);
    }
  });

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
    expectAllGlobalFunctionsHaveTrees(example, result);
  }, 65_000);

  testWithVeriFast.each(invalidExamples)('maps diagnostics for invalid example %s', async example => {
    const result = await generateAndVerify(example, examplesDestination);
    expect(result.ok, `${example} should fail VeriFast`).toBe(false);
    expect(
      result.errors.some(error => typeof error.sourceLine === 'number'),
      `${example} should contain at least one Pseudo2-mapped diagnostic:\n${formatFailure(example, result)}`
    ).toBe(true);
    expectAllGlobalFunctionsHaveTrees(example, result);
  }, 65_000);

  testWithVeriFast('captures VeriFast execution forests without exposing the full JSON report', async () => {
    const result = await runVeriFast({
      verifastExe,
      file: path.join(repoRoot, 'verifast-26.01', 'pass.c'),
      compileOnly: true,
      captureExecutionForest: true
    });

    expect(result.ok, formatRuntimeFailure(result)).toBe(true);
    expect(result.stdout).toContain('errors found');
    expect(result.stdout).not.toContain('VeriFast-Json');
    expect(result.executionForest?.messages.length).toBeGreaterThan(0);
    expect(result.executionForest?.forest).toMatch(/^#/);
  });

  testWithVeriFast('keeps JSON-mode proof failures as structured diagnostics and failed tree leaves', async () => {
    const result = await runVeriFast({
      verifastExe,
      file: path.join(repoRoot, 'verifast-26.01', 'fail.c'),
      compileOnly: true,
      captureExecutionForest: true
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({
      kind: 'error',
      line: 5,
      message: expect.stringContaining('Cannot prove')
    });
    expect(result.executionForest?.forest).toContain('E[]');
  });

  testWithVeriFast('returns a compact Pseudo2-only verification tree for arithmetic overflow', async () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-verifast-source-tree-'));
    const example = 'invalid_mult_by_add_overflow.pseudo2';
    const sourcePath = path.join(examplesRoot, example);
    await generateCAction(sourcePath, { destination });
    const cPath = path.join(destination, `${generatedBaseName(example)}.c`);
    const sourceMap = JSON.parse(fs.readFileSync(`${cPath}.map.json`, 'utf8')) as CSourceMapFile;

    const result = applyCSourceMapToVeriFastResult(await runVeriFast({
      verifastExe,
      file: cPath,
      compileOnly: true,
      pseudo2Trace: {
        sourceCode: fs.readFileSync(sourcePath, 'utf8'),
        sourceMap
      }
    }), sourceMap);

    expect(result.ok).toBe(false);
    expect(result.executionForest).toBeUndefined();
    expect(result.errors[0]).toMatchObject({
      sourceLine: 8,
      message: expect.stringContaining('Potential arithmetic overflow')
    });
    expect(result.verificationTrees).toHaveLength(1);
    expect(result.verificationTrees?.[0].label).toBe('Function: multByAdd');
    const root = result.verificationTrees?.[0].root;
    const loopBranch = root?.children[0];
    expect(root?.sourceLine).toBe(3);
    expect(loopBranch).toMatchObject({
      kind: 'step',
      sourceLine: 7
    });
    expect(loopBranch?.children.map(child => child.kind)).toEqual(['step', 'pending']);
    expect(loopBranch?.children[0]).toMatchObject({
      kind: 'step',
      sourceLine: 8
    });
    expect(loopBranch?.children[0].children[0]).toMatchObject({
      kind: 'failure',
      sourceLine: 8
    });
    const serializedTree = JSON.stringify(result.verificationTrees);
    expect(serializedTree).toContain('Line 8: res = res + b');
    expect(serializedTree).not.toContain('ps2_');
    expect(serializedTree).not.toContain('main');
    expect(countVerificationNodes(root)).toBe(5);
  }, 65_000);

  test('preserves nested Pseudo2 control-flow branches without generated helper nodes', () => {
    const trees = buildPseudo2VerificationTrees({
      sourceCode: [
        'func nested(a)',
        '  while a > 0',
        '    if a == 2',
        '      @assert false',
        '    a = a - 1',
        '  return a'
      ].join('\n'),
      sourceMap: {
        mappings: [{ generatedLine: 40, sourceLine: 4 }]
      },
      traceFrames: [],
      errors: [{
        file: 'generated.c',
        line: 40,
        colFrom: 1,
        colTo: 6,
        kind: 'error',
        message: 'Cannot prove false.'
      }],
      ok: false
    });

    const root = trees[0]?.root;
    const whileBranch = root?.children[0];
    const ifBranch = whileBranch?.children[0];
    expect(whileBranch).toMatchObject({ kind: 'step', sourceLine: 2 });
    expect(whileBranch?.children[1]).toMatchObject({ kind: 'pending', sourceLine: 2 });
    expect(ifBranch).toMatchObject({ kind: 'step', sourceLine: 3 });
    expect(ifBranch?.children[1]).toMatchObject({ kind: 'pending', sourceLine: 3 });
    expect(ifBranch?.children[0]).toMatchObject({ kind: 'step', sourceLine: 4 });
    expect(ifBranch?.children[0].children[0]).toMatchObject({
      kind: 'failure',
      sourceLine: 4
    });
    expect(JSON.stringify(root)).not.toContain('generated.c');
    expect(countVerificationNodes(root)).toBe(7);
  });

  test('creates a separate source tree for every function after an early proof failure', () => {
    const trees = buildPseudo2VerificationTrees({
      sourceCode: [
        'func first()',
        '  return 1',
        'func second()',
        '  @assert false',
        '  return 2',
        'func third()',
        '  return 3'
      ].join('\n'),
      sourceMap: { mappings: [{ generatedLine: 44, sourceLine: 4 }] },
      traceFrames: [],
      errors: [{
        file: 'generated.c',
        line: 44,
        colFrom: 1,
        colTo: 6,
        kind: 'error',
        message: 'Assertion might not hold.'
      }],
      ok: false
    });

    expect(trees.map(tree => tree.label)).toEqual([
      'Function: first', 'Function: second', 'Function: third'
    ]);
    expect(trees.map(tree => tree.root.children[0]?.kind)).toEqual([
      'pending', 'step', 'pending'
    ]);
    expect(trees[1].root.children[0]?.children[0]?.kind).toBe('failure');
  });

  testWithVeriFast('shows every function of a multi-function proof in the web tree model', async () => {
    const valid = await generateAndVerify('valid_model_arithmetic.pseudo2', examplesDestination);
    expect(valid.ok).toBe(true);
    expect(valid.verificationTrees?.map(tree => tree.label)).toEqual([
      'Function: add', 'Function: subtract', 'Function: multiply',
      'Function: divide', 'Function: modulo', 'Function: power',
      'Function: addParameters'
    ]);
    expect(valid.verificationTrees?.every(tree => tree.root.children[0]?.kind === 'success')).toBe(true);

    const invalid = await generateAndVerify('invalid_multiple_functions.pseudo2', examplesDestination);
    expect(invalid.ok).toBe(false);
    expect(invalid.verificationTrees?.map(tree => tree.label)).toEqual([
      'Function: first', 'Function: second', 'Function: third'
    ]);
    expect(invalid.verificationTrees?.map(tree => tree.root.children[0]?.kind)).toEqual([
      'pending', 'failure', 'pending'
    ]);
    expect(invalid.errors[0].sourceLine).toBe(7);
  }, 65_000);

  testWithVeriFast('includes struct methods in the separate Pseudo2 tree selection', async () => {
    const valid = await generateAndVerify('valid_struct_method.pseudo2', examplesDestination);
    expect(valid.ok).toBe(true);
    expect(valid.verificationTrees?.find(tree => tree.label === 'Function: read')?.root.children[0]?.kind)
      .toBe('success');

    const invalid = await generateAndVerify('invalid_method_assert_false.pseudo2', examplesDestination);
    expect(invalid.ok).toBe(false);
    expect(invalid.verificationTrees?.find(tree => tree.label === 'Function: read')?.root.children[0]?.kind)
      .toBe('step');
  }, 65_000);

  testWithVeriFast('reaches the direct result equals product postcondition without the overflow bound', async () => {
    const result = await generateAndVerify('invalid_mult_by_add_postcondition.pseudo2', examplesDestination);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({
      sourceLine: 2,
      message: expect.stringContaining('ps2_model_int')
    });
    expect(result.errors[0].message).toContain('Cannot prove condition');
  }, 65_000);

  testWithVeriFast('reports overflow or postcondition on Pseudo2 lines according to the check option', async () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-verifast-option-overflow-'));
    const example = 'invalid_mult_by_add_postcondition.pseudo2';
    const sourcePath = path.join(examplesRoot, example);
    await generateCAction(sourcePath, { destination, checkOverflow: true });
    const cPath = path.join(destination, `${generatedBaseName(example)}.c`);
    const sourceMap = JSON.parse(fs.readFileSync(`${cPath}.map.json`, 'utf8')) as CSourceMapFile;
    const sourceCode = fs.readFileSync(sourcePath, 'utf8');

    for (const [overflowEnabled, expectedLine, expectedMessage] of [
      [true, 8, 'Potential arithmetic overflow'],
      [false, 2, 'Cannot prove condition']
    ] as const) {
      const result = applyCSourceMapToVeriFastResult(await runVeriFast({
        verifastExe,
        file: cPath,
        compileOnly: true,
        extraArgs: overflowEnabled ? [] : ['-disable_overflow_check'],
        pseudo2Trace: { sourceCode, sourceMap }
      }), sourceMap);

      expect(result.ok).toBe(false);
      expect(result.errors[0]).toMatchObject({
        sourceLine: expectedLine,
        message: expect.stringContaining(expectedMessage)
      });
      expect(result.verificationTrees?.[0].label).toBe('Function: multByAdd');
    }
  }, 65_000);

  testWithVeriFast('shows the loop split at a postcondition failure when overflow checking is disabled', async () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-verifast-no-overflow-'));
    const example = 'invalid_mult_by_add_overflow.pseudo2';
    const sourcePath = path.join(examplesRoot, example);
    await generateCAction(sourcePath, { destination });
    const cPath = path.join(destination, `${generatedBaseName(example)}.c`);
    const sourceMap = JSON.parse(fs.readFileSync(`${cPath}.map.json`, 'utf8')) as CSourceMapFile;

    const result = applyCSourceMapToVeriFastResult(await runVeriFast({
      verifastExe,
      file: cPath,
      extraArgs: ['-disable_overflow_check'],
      pseudo2Trace: {
        sourceCode: fs.readFileSync(sourcePath, 'utf8'),
        sourceMap
      }
    }), sourceMap);

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({
      sourceLine: 2,
      message: expect.stringContaining('Cannot prove condition')
    });
    const root = result.verificationTrees?.[0].root;
    const loopBranch = root?.children[0];
    expect(loopBranch).toMatchObject({ kind: 'step', sourceLine: 7 });
    expect(loopBranch?.children).toMatchObject([
      { kind: 'failure', sourceLine: 2 },
      { kind: 'pending', sourceLine: 7 }
    ]);
    expect(countVerificationNodes(root)).toBe(4);
    expect(JSON.stringify(root)).not.toContain('ps2_copy_value');
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

/** Zählt einen kompakten Pseudo2-Verifikationsbaum rekursiv für Größenregressionen. */
function countVerificationNodes(
  node: import('../../src/verifast.js').Pseudo2VerificationNode | undefined
): number {
  return node ? 1 + node.children.reduce((sum, child) => sum + countVerificationNodes(child), 0) : 0;
}

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
    compileOnly: true,
    pseudo2Trace: {
      sourceCode: fs.readFileSync(sourcePath, 'utf8'),
      sourceMap
    }
  });

  return applyCSourceMapToVeriFastResult(result, sourceMap);
}

/** Prüft bei jedem echten VeriFast-Beispiel einen eigenen Baum pro globaler Pseudo2-Funktion. */
function expectAllGlobalFunctionsHaveTrees(example: string, result: VeriFastResult): void {
  const source = fs.readFileSync(path.join(examplesRoot, example), 'utf8');
  const functionNames = [...source.matchAll(/^func\s+([A-Za-z_]\w*)\s*\(/gm)].map(match => match[1]);
  const treeLabels = result.verificationTrees?.map(tree => tree.label) ?? [];
  for (const name of functionNames) {
    expect(treeLabels, `${example}: missing verification tree for ${name}`)
      .toContain(`Function: ${name}`);
  }
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
