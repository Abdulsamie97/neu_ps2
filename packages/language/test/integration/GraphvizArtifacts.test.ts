import { describe, expect, test } from 'vitest';

import { generateGraphvizArtifacts } from '../../src/generator-artifacts.js';
import { generateGraphvizDep } from '../../src/graphviz/generator-graphviz-dep.js';
import { parseRuntimeProgram } from '../helpers/runtime-test-utils.js';

describe('GraphvizArtifacts', () => {
  test('generates AST, dependency and CFG artifacts for a function', async () => {
    const { model, document } = await parseRuntimeProgram(`
      func m(x)
        if x > 0
          return x
        return 0

      print m(1)
    `);

    expectErrors(document);

    const artifacts = generateGraphvizArtifacts(model);
    expect(artifacts.map(artifact => artifact.fileName)).toEqual([
      'graphvizAST.dot',
      'graphvizDep.dot',
      'graphvizCfg_m.dot'
    ]);

    const ast = artifactCode(artifacts, 'graphvizAST.dot');
    expect(ast).toContain('digraph G {');
    expect(ast).toContain('label="FunctionDeclaration"');
    expect(ast).toContain('label="FunctionCall\\n------\\nm"');

    const dep = artifactCode(artifacts, 'graphvizDep.dot');
    expect(dep).toContain('n1 [label="m", shape="hexagon"]');
    expect(dep).toContain('n0 -> n1 [style="solid", color="black"]');

    const cfg = artifactCode(artifacts, 'graphvizCfg_m.dot');
    expect(cfg).toContain('label="m()"');
    expect(cfg).toContain('label="[(x > 0)]"');
    expect(cfg).toContain('label="/return x"');
    expect(cfg).toContain('label="/return 0"');
  });

  test('dependency graph contains struct attributes and methods', async () => {
    const { model, document } = await parseRuntimeProgram(`
      struct S
        num value
        set(x)
          this.value = x
          return this.value

      var s = new S
      call s.set(4)
      print s.value
    `);

    expectErrors(document);

    const dep = generateGraphvizDep(model);
    expect(dep).toContain('label="S"');
    expect(dep).toContain('label="value", shape="house"');
    expect(dep).toContain('label="set", shape="hexagon"');
    expect(dep).toContain('style="dashed", color="red"');
    expect(dep).toContain('style="dashed", color="green"');
    expect(dep).toContain('style="solid", color="black"');
  });
});

function artifactCode(artifacts: Array<{ fileName: string; code: string }>, fileName: string): string {
  const artifact = artifacts.find(candidate => candidate.fileName === fileName);
  expect(artifact).toBeTruthy();
  return artifact!.code;
}

function expectErrors(document: { diagnostics?: Array<{ severity?: number; message: string }> }): void {
  const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
  expect(errors.map(error => error.message).join('\n')).toBe('');
}
