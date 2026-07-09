import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { describe, expect, test } from 'vitest';

import { generateAction, generateCAction } from '../../src/main.js';

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
    expect(c).toContain('ps2_print(func_add_0(ps2_num(2), ps2_num(3)));');
    expect(sourceMap.sourceFile).toBe(path.resolve(sourcePath));
    expect(sourceMap.mappings?.some(entry => entry.sourceLine === 2)).toBe(true);
    expect(sourceMap.mappings?.some(entry => entry.sourceLine === 5)).toBe(true);
  });
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
