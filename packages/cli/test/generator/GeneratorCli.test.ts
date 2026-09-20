/**
 * @file GeneratorCli.test.ts
 * @brief Prüft Dateiausgabe und Optionen der JavaScript-, C-, Pretty- und Graphviz-CLI-Generatoren.
 *
 * Temporäre Projekte sichern Standard- und Zielverzeichnisse, selektierte Artefakte,
 * Source-Map-Dateien, ausführbare C-Runtime-Ausgabe und optionale Compiler-Ausführung ab.
 *
 * @author Abdul
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { describe, expect, test } from 'vitest';

import { generateAction, generateCAction, generatePrettyAction } from '../../src/main.js';
import { resolveCCompiler, runCSource } from '../../src/c-runner.js';
import { applyCSourceMapToVeriFastResult, runVeriFast, type CSourceMapFile } from '../../src/verifast.js';

/** Integrationssuite der programmatisch aufgerufenen CLI-Generatoraktionen. */
describe('CLI generator', () => {
  test('generateAction writes JavaScript and Graphviz artifacts to explicit destination', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-cli-'));
    const sourcePath = path.join(tmp, 'sample-file.pseudo2');
    const destination = path.join(tmp, 'out');

    fs.writeFileSync(sourcePath, sampleProgram(), 'utf8');

    await generateAction(sourcePath, { destination });

    const jsPath = path.join(destination, 'samplefile.js');
    expect(fs.existsSync(jsPath)).toBe(true);
    expect(fs.existsSync(path.join(destination, 'graphvizAST.dot'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'graphvizDep.dot'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'graphvizCfg_add.dot'))).toBe(true);

    expect(executeGeneratedJs(fs.readFileSync(jsPath, 'utf8'))).toBe('5');
  });

  test('generateAction writes to source-directory generated folder by default', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-cli-default-'));
    const sourcePath = path.join(tmp, 'default-output.pseudo2');

    fs.writeFileSync(sourcePath, sampleProgram(), 'utf8');

    await generateAction(sourcePath, {});

    const destination = path.join(tmp, 'generated');
    expect(fs.existsSync(path.join(destination, 'defaultoutput.js'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'graphvizAST.dot'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'graphvizDep.dot'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'graphvizCfg_add.dot'))).toBe(true);
  });

  test('generateAction can write only JavaScript', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-cli-only-js-'));
    const sourcePath = path.join(tmp, 'only-js.pseudo2');
    const destination = path.join(tmp, 'out');

    fs.writeFileSync(sourcePath, sampleProgram(), 'utf8');

    await generateAction(sourcePath, { destination, onlyJs: true });

    expect(fs.existsSync(path.join(destination, 'onlyjs.js'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'graphvizAST.dot'))).toBe(false);
    expect(fs.existsSync(path.join(destination, 'graphvizDep.dot'))).toBe(false);
    expect(fs.existsSync(path.join(destination, 'graphvizCfg_add.dot'))).toBe(false);
  });

  test('generateAction can write selected Graphviz artifacts without JavaScript', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-cli-selected-graphviz-'));
    const sourcePath = path.join(tmp, 'selected.pseudo2');
    const destination = path.join(tmp, 'out');

    fs.writeFileSync(sourcePath, sampleProgram(), 'utf8');

    await generateAction(sourcePath, { destination, js: false, ast: true });

    expect(fs.existsSync(path.join(destination, 'selected.js'))).toBe(false);
    expect(fs.existsSync(path.join(destination, 'graphvizAST.dot'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'graphvizDep.dot'))).toBe(false);
    expect(fs.existsSync(path.join(destination, 'graphvizCfg_add.dot'))).toBe(false);
  });

  test('generateAction can also write a braced Pseudo2 pretty-print artifact', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-cli-pretty-'));
    const sourcePath = path.join(tmp, 'pretty-sample.pseudo2');
    const destination = path.join(tmp, 'out');

    fs.writeFileSync(sourcePath, sampleProgram(), 'utf8');

    await generateAction(sourcePath, { destination, pretty: true });

    const prettyPath = path.join(destination, 'prettysample.braced.pseudo2');
    expect(fs.existsSync(prettyPath)).toBe(true);
    expect(fs.readFileSync(prettyPath, 'utf8')).toContain('func add(a, b) {');
  });

  test('generatePrettyAction writes only the braced Pseudo2 pretty-print artifact', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-cli-pretty-only-'));
    const sourcePath = path.join(tmp, 'pretty-only.pseudo2');
    const destination = path.join(tmp, 'out');

    fs.writeFileSync(sourcePath, sampleProgram(), 'utf8');

    await generatePrettyAction(sourcePath, { destination });

    expect(fs.existsSync(path.join(destination, 'prettyonly.braced.pseudo2'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'prettyonly.js'))).toBe(false);
    expect(fs.existsSync(path.join(destination, 'graphvizAST.dot'))).toBe(false);
  });

  test('generateCAction writes a C file with VeriFast annotations', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-cli-c-'));
    const sourcePath = path.join(tmp, 'sample-c.pseudo2');
    const destination = path.join(tmp, 'out');

    fs.writeFileSync(sourcePath, sampleProgram(), 'utf8');

    await generateCAction(sourcePath, { destination });

    const cPath = path.join(destination, 'samplec.c');
    const mapPath = `${cPath}.map.json`;
    expect(fs.existsSync(cPath)).toBe(true);
    expect(fs.existsSync(mapPath)).toBe(true);
    const c = fs.readFileSync(cPath, 'utf8');
    const sourceMap = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as {
      sourceFile?: string;
      mappings?: Array<{ generatedLine: number; sourceLine: number }>;
    };
    expect(c).toContain('typedef struct Ps2Value { int _; } Ps2Value;');
    expect(c).toContain('//@ requires true;');
    expect(c).toContain('Ps2Value* func_add_0(Ps2Value* a_0, Ps2Value* b_1);');
    expect(c).toContain('ps2_print(func_add_0(ps2_int(2), ps2_int(3)));');
    expect(sourceMap.sourceFile).toBe(path.resolve(sourcePath));
    expect(sourceMap.mappings?.some(entry => entry.sourceLine === 2)).toBe(true);
    expect(sourceMap.mappings?.some(entry => entry.sourceLine === 5)).toBe(true);
  });

  test('generateCAction can write a runnable C implementation', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-cli-c-runtime-'));
    const sourcePath = path.join(tmp, 'sample-c-runtime.pseudo2');
    const destination = path.join(tmp, 'out');

    fs.writeFileSync(sourcePath, sampleProgram(), 'utf8');

    await generateCAction(sourcePath, { destination, runtime: 'implementation' });

    const cPath = path.join(destination, 'samplecruntime.c');
    const c = fs.readFileSync(cPath, 'utf8');
    expect(c).toContain('typedef enum {');
    expect(c).toContain('PS2_UNDEFINED');
    expect(c).toContain('int main(void)');
    expect(c).not.toContain('typedef struct Ps2Value { int _; } Ps2Value;');
  });

  test('generateCAction writes direct native C and runs it when a compiler is available', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-cli-c-direct-'));
    const sourcePath = path.join(tmp, 'direct.pseudo2');
    const destination = path.join(tmp, 'out');
    fs.writeFileSync(sourcePath, sampleProgram(), 'utf8');

    await generateCAction(sourcePath, { destination, direct: true, runtime: 'implementation' });

    const cPath = path.join(destination, 'direct.direct.c');
    const c = fs.readFileSync(cPath, 'utf8');
    expect(c).toContain('int add(int a, int b)');
    expect(c).not.toContain('Ps2Value');
    expect(fs.existsSync(`${cPath}.map.json`)).toBe(true);

    if (resolveCCompiler()) {
      const result = await runCSource(c, 'direct.c');
      expect(result.ok, result.stderr).toBe(true);
      expect(result.stdout.trim()).toBe('5');
    }
  }, 60_000);

  test('verifies native integer, array, struct and string contracts with the repo-local VeriFast', async () => {
    const verifastExe = path.join(process.cwd(), 'verifast-26.01', 'bin', 'verifast.exe');
    if (!fs.existsSync(verifastExe)) return;
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-direct-verifast-'));
    for (const name of [
      'direct-c-verifast',
      'direct-c-arrays-structs',
      'direct-c-multiply',
      'direct-c-method-contract',
      'direct-c-array-contract',
      'direct-c-array-update',
      'direct-c-string-contract',
      'direct-c-string-pair',
      'direct-c-string-return',
      'direct-c-dynamic-array',
      'direct-c-filled-array',
      'direct-c-do-while'
    ]) {
      const sourcePath = path.join(process.cwd(), 'examples', `${name}.pseudo2`);
      await generateCAction(sourcePath, { destination, direct: true });
      const cPath = path.join(destination, `${name.replace(/-/g, '')}.direct.c`);
      const result = await runVeriFast({ verifastExe, file: cPath, compileOnly: true });
      expect(result.ok, `${name}: ${result.stderr}`).toBe(true);
    }
  }, 60_000);

  test('verifies nested and aliased Direct-C heap ownership with the repo-local VeriFast', async () => {
    const verifastExe = path.join(process.cwd(), 'verifast-26.01', 'bin', 'verifast.exe');
    if (!fs.existsSync(verifastExe)) return;
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-direct-ownership-'));
    for (const name of [
      'valid_nested_arrays',
      'valid_nested_container_ownership',
      'valid_nested_heap_ownership',
      'valid_parameter_alias_ownership',
      'valid_replaced_child_ownership',
      'valid_stateful_array_alias',
      'valid_stateful_struct_alias'
    ]) {
      const sourcePath = path.join(process.cwd(), 'examples', 'verifast', `${name}.pseudo2`);
      await generateCAction(sourcePath, { destination, direct: true });
      const cPath = path.join(destination, `${name}.direct.c`);
      const result = await runVeriFast({ verifastExe, file: cPath, compileOnly: true });
      expect(result.ok, `${name}: ${result.stderr}`).toBe(true);
    }
  }, 60_000);

  test('verifies native array and struct output without consuming heap ownership', async () => {
    const verifastExe = path.join(process.cwd(), 'verifast-26.01', 'bin', 'verifast.exe');
    if (!fs.existsSync(verifastExe)) return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-direct-print-verifast-'));
    const sourcePath = path.join(tmp, 'print-values.pseudo2');
    fs.writeFileSync(sourcePath, [
      'struct Box',
      '  num value',
      'var values = [1, 2]',
      'var matrix = [[1, 2], [3, 4]]',
      'var item = new Box',
      'print values',
      'print matrix',
      'print item'
    ].join('\n'), 'utf8');

    await generateCAction(sourcePath, { destination: tmp, direct: true });
    const cPath = path.join(tmp, 'printvalues.direct.c');
    const result = await runVeriFast({ verifastExe, file: cPath, compileOnly: true });
    expect(result.ok, result.stderr).toBe(true);
  }, 30_000);

  test('maps a native VeriFast assertion failure to its Pseudo2 line', async () => {
    const verifastExe = path.join(process.cwd(), 'verifast-26.01', 'bin', 'verifast.exe');
    if (!fs.existsSync(verifastExe)) return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-direct-verifast-failure-'));
    const sourcePath = path.join(tmp, 'invalid.pseudo2');
    fs.writeFileSync(sourcePath, 'var x = 2\n//@ assert x == 3\nprint x\n', 'utf8');
    await generateCAction(sourcePath, { destination: tmp, direct: true });
    const cPath = path.join(tmp, 'invalid.direct.c');
    const sourceMap = JSON.parse(fs.readFileSync(`${cPath}.map.json`, 'utf8')) as CSourceMapFile;
    const result = applyCSourceMapToVeriFastResult(await runVeriFast({
      verifastExe, file: cPath, compileOnly: true
    }), sourceMap);
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.kind === 'error' && error.sourceLine === 2)).toBe(true);
  }, 60_000);

  test('builds a separate native verification tree for every Pseudo2 function', async () => {
    const verifastExe = path.join(process.cwd(), 'verifast-26.01', 'bin', 'verifast.exe');
    if (!fs.existsSync(verifastExe)) return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-direct-verifast-trees-'));
    const sourcePath = path.join(tmp, 'functions.pseudo2');
    const source = [
      '//@ ensures result == 1',
      'func one()',
      '  return 1',
      '//@ ensures result == 2',
      'func two()',
      '  return 2',
      'var first = one()',
      'var second = two()',
      'print first + second'
    ].join('\n');
    fs.writeFileSync(sourcePath, source, 'utf8');
    await generateCAction(sourcePath, { destination: tmp, direct: true });
    const cPath = path.join(tmp, 'functions.direct.c');
    const sourceMap = JSON.parse(fs.readFileSync(`${cPath}.map.json`, 'utf8')) as CSourceMapFile;
    const result = await runVeriFast({
      verifastExe,
      file: cPath,
      compileOnly: true,
      pseudo2Trace: { sourceCode: source, sourceMap }
    });
    expect(result.ok, result.stderr).toBe(true);
    expect(result.verificationTrees?.map(tree => tree.label)).toEqual(expect.arrayContaining(['Function: one', 'Function: two']));
  }, 60_000);

  test('direct C rejects an out-of-bounds array access at runtime', async () => {
    if (!resolveCCompiler()) return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-direct-bounds-'));
    const sourcePath = path.join(tmp, 'bounds.pseudo2');
    fs.writeFileSync(sourcePath, 'var values = [2, 4]\nprint values[3]\n', 'utf8');
    await generateCAction(sourcePath, { destination: tmp, direct: true });
    const result = await runCSource(fs.readFileSync(path.join(tmp, 'bounds.direct.c'), 'utf8'));
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  }, 60_000);

  test('direct C executes arrays, loops, structs, methods and strings', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-cli-c-direct-structures-'));
    const sourcePath = path.join(tmp, 'structures.pseudo2');
    const destination = path.join(tmp, 'out');
    fs.writeFileSync(sourcePath, [
      'struct Counter',
      '  num value',
      '  inc(n)',
      '    value = value + n',
      'func sum(A[1..n])',
      '  var total = 0',
      '  for i=1 to n',
      '    total = total + A[i]',
      '  return total',
      'func currentText()',
      '  return "done"',
      'var A = [1, 2, 3]',
      'var counter = new Counter',
      'counter.value = 0',
      'call counter.inc(sum(A))',
      'print counter.value',
      'print "done"',
      'if currentText() == "done"',
      '  print currentText()',
      'print A',
      'var matrix = [[1, 2], [3, 4]]',
      'print matrix',
      'print counter'
    ].join('\n'), 'utf8');
    await generateCAction(sourcePath, { destination, direct: true, runtime: 'implementation' });
    const c = fs.readFileSync(path.join(destination, 'structures.direct.c'), 'utf8');
    expect(c).not.toContain('Ps2Value');
    const jsDestination = path.join(tmp, 'js');
    await generateAction(sourcePath, { destination: jsDestination, onlyJs: true });
    const expected = executeGeneratedJs(fs.readFileSync(path.join(jsDestination, 'structures.js'), 'utf8'));
    if (resolveCCompiler()) {
      const result = await runCSource(c, 'direct-struct.c');
      expect(result.ok, result.stderr).toBe(true);
      expect(result.stdout.trim().replace(/\r\n/g, '\n')).toBe('6\ndone\ndone\n1,2,3\n1,2,3,4\n[object Object]');
      expect(result.stdout.replace(/\s+/g, ' ').trim()).toBe(expected);
    }
  }, 60_000);

  test('direct C preserves JavaScript-style fractional division', async () => {
    if (!resolveCCompiler()) return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-direct-fraction-'));
    const sourcePath = path.join(tmp, 'fraction.pseudo2');
    fs.writeFileSync(sourcePath, 'var value = 3 / 2\nprint value\n', 'utf8');

    await generateCAction(sourcePath, { destination: tmp, direct: true, runtime: 'implementation' });
    const cPath = path.join(tmp, 'fraction.direct.c');
    const c = fs.readFileSync(cPath, 'utf8');
    expect(c).toContain('(3.0 / 2.0)');
    const result = await runCSource(c, 'fraction.c');
    expect(result.ok, result.stderr).toBe(true);
    expect(result.stdout.trim()).toBe('1.5');
  }, 30_000);

  test('direct C executes a linked struct built from an array parameter', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-cli-c-direct-list-'));
    const sourcePath = path.join(tmp, 'list.pseudo2');
    const destination = path.join(tmp, 'out');
    fs.writeFileSync(sourcePath, [
      'struct Node',
      '  num value',
      '  Node next',
      'func build(A[1..n])',
      '  if n == 0',
      '    return null',
      '  var head = new Node',
      '  head.value = A[1]',
      '  head.next = null',
      '  var tail = head',
      '  for i=2 to n',
      '    var item = new Node',
      '    item.value = A[i]',
      '    item.next = null',
      '    tail.next = item',
      '    tail = item',
      '  return head',
      'var head = build([7, 8])',
      'print head.next.value'
    ].join('\n'), 'utf8');

    await generateCAction(sourcePath, { destination, direct: true, runtime: 'implementation' });
    const c = fs.readFileSync(path.join(destination, 'list.direct.c'), 'utf8');
    expect(c).toMatch(/struct Node \*\s*next;/);
    expect(c).toContain('head->next->value');
    if (resolveCCompiler()) {
      const result = await runCSource(c, 'list.c');
      expect(result.ok, result.stderr).toBe(true);
      expect(result.stdout.trim()).toBe('8');
    }
  }, 60_000);

  test('C runner compiles and executes source when a compiler is available', async () => {
    if (!resolveCCompiler()) return;

    const result = await runCSource('#include <stdio.h>\nint main(void) { puts("C OK"); return 0; }');

    expect(result.ok).toBe(true);
    expect(result.stage).toBe('run');
    expect(result.stdout.trim()).toBe('C OK');
  }, 30_000);
});

/** @returns Kleines gültiges Pseudo2-Programm für alle Generatoraktionen der Suite. */
function sampleProgram(): string {
  return `
func add(a, b)
  return a + b

print add(2, 3)
`;
}

/**
 * Führt generierten JavaScript-Code isoliert aus und zeichnet console.log-Ausgaben auf.
 * @param code Zu prüfender JavaScript-Quelltext.
 * @returns Normalisierte Programmausgabe.
 */
function executeGeneratedJs(code: string): string {
  const output: string[] = [];
  vm.runInNewContext(code, {
    console: {
      log: (...values: unknown[]) => output.push(values.map(value => String(value)).join(' '))
    }
  }, { timeout: 1000 });
  return output.join(' ').replace(/\s+/g, ' ').trim();
}
