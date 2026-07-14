import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { describe, expect, test } from 'vitest';

import { generateAction, generateCAction, generatePrettyAction } from '../../src/main.js';
import { resolveCCompiler, runCSource } from '../../src/c-runner.js';

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

  test('C runner compiles and executes source when a compiler is available', async () => {
    if (!resolveCCompiler()) return;

    const result = await runCSource('#include <stdio.h>\nint main(void) { puts("C OK"); return 0; }');

    expect(result.ok).toBe(true);
    expect(result.stage).toBe('run');
    expect(result.stdout.trim()).toBe('C OK');
  }, 30_000);
});

function sampleProgram(): string {
  return `
func add(a, b)
  return a + b

print add(2, 3)
`;
}

function executeGeneratedJs(code: string): string {
  const output: string[] = [];
  vm.runInNewContext(code, {
    console: {
      log: (...values: unknown[]) => output.push(values.map(value => String(value)).join(' '))
    }
  }, { timeout: 1000 });
  return output.join(' ').replace(/\s+/g, ' ').trim();
}
