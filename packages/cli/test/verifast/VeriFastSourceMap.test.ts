import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { generateCAction } from '../../src/main.js';
import {
  applyCSourceMapToVeriFastResult,
  runVeriFast,
  type CSourceMapFile,
  type VeriFastResult
} from '../../src/verifast.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const examplesRoot = path.join(repoRoot, 'examples', 'verifast');
const verifastExe = path.join(repoRoot, 'verifast-26.01', 'bin', 'verifast.exe');

const validExamples = [
  'valid_array_parameter_length.pseudo2',
  'valid_array_parameter_dynamic_index.pseudo2',
  'valid_array_parameter_element.pseudo2',
  'valid_assert_true.pseudo2',
  'valid_bool_expression.pseudo2',
  'valid_do_invariant_true.pseudo2',
  'valid_for_invariant_true.pseudo2',
  'valid_loop_assert.pseudo2',
  'valid_loop_invariant_true.pseudo2',
  'valid_model_array_element.pseudo2',
  'valid_model_array_fill_elements.pseudo2',
  'valid_model_array_literal_element.pseudo2',
  'valid_model_array_result.pseudo2',
  'valid_model_bool_string_null.pseudo2',
  'valid_model_struct_default_field.pseudo2',
  'valid_model_struct_field.pseudo2',
  'valid_model_struct_result.pseudo2',
  'valid_model_value_int.pseudo2',
  'valid_multiple_asserts.pseudo2',
  'valid_raw_specs.pseudo2',
  'valid_result_ensures_non_null.pseudo2',
  'valid_struct_parameter_field.pseudo2',
  'valid_struct_method.pseudo2',
  'valid_terminates_and_assume.pseudo2',
  'valid_top_level_assert.pseudo2'
];

const invalidExamples = [
  'invalid_assert_false.pseudo2',
  'invalid_assert_expression.pseudo2',
  'invalid_ensures_false.pseudo2',
  'invalid_loop_assert_false.pseudo2',
  'invalid_loop_invariant_false.pseudo2',
  'invalid_method_assert_false.pseudo2',
  'invalid_array_parameter_element.pseudo2',
  'invalid_model_array_element.pseudo2',
  'invalid_model_array_fill_elements.pseudo2',
  'invalid_model_array_literal_element.pseudo2',
  'invalid_model_array_length.pseudo2',
  'invalid_model_bool_value.pseudo2',
  'invalid_model_int_value.pseudo2',
  'invalid_model_null_value.pseudo2',
  'invalid_model_string_value.pseudo2',
  'invalid_model_struct_default_field.pseudo2',
  'invalid_model_struct_field.pseudo2',
  'invalid_raw_assert_false.pseudo2',
  'invalid_requires_false_call.pseudo2',
  'invalid_result_ensures_null.pseudo2',
  'invalid_struct_parameter_field.pseudo2',
  'invalid_top_level_assert_false.pseudo2'
];

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

  const testWithVeriFast = fs.existsSync(verifastExe) ? test : test.skip;

  testWithVeriFast('runs all VeriFast examples and maps failing diagnostics to Pseudo2 lines', async () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-verifast-examples-'));

    for (const example of validExamples) {
      const result = await generateAndVerify(example, destination);
      expect(result.ok, formatFailure(example, result)).toBe(true);
    }

    for (const example of invalidExamples) {
      const result = await generateAndVerify(example, destination);
      expect(result.ok, `${example} should fail VeriFast`).toBe(false);
      expect(
        result.errors.some(error => typeof error.sourceLine === 'number'),
        `${example} should contain at least one Pseudo2-mapped diagnostic:\n${formatFailure(example, result)}`
      ).toBe(true);
    }
  }, 120000);
});

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

function generatedBaseName(fileName: string): string {
  return path.basename(fileName, path.extname(fileName)).replace(/[.-]/g, '');
}

function formatFailure(example: string, result: VeriFastResult): string {
  return [
    `${example}: exit ${result.exitCode}`,
    result.stdout.trim(),
    result.stderr.trim(),
    JSON.stringify(result.errors, null, 2)
  ].filter(Boolean).join('\n');
}
