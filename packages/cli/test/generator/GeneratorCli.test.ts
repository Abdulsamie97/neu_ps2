import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { describe, expect, test } from 'vitest';

import { generateAction } from '../../src/main.js';

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
