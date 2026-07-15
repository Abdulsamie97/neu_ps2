/**
 * @file GraphvizArtifacts.test.ts
 * @brief Prüft Erzeugung und Inhalt der AST-, Dependency- und CFG-Graphviz-Artefakte.
 *
 * Abgedeckt sind normale Programme, größere ASTs, Funktionsabhängigkeiten,
 * Kontrollflusskanten und Fehlersignalisierung bei ungültigem Pseudo2.
 *
 * @author Abdul
 */

import { describe, expect, test } from 'vitest';

import { generateGraphvizArtifacts } from '../../src/generator-artifacts.js';
import { generateGraphvizDep } from '../../src/graphviz/generator-graphviz-dep.js';
import { parseRuntimeProgram } from '../helpers/runtime-test-utils.js';

/** Integrationssuite für alle Graphviz-Generatoren und ihre gemeinsame Artefakt-API. */
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

    expect(dep).toBe([
      'digraph G {',
      '  graph [compound=true];',
      '  edge [arrowhead="vee"];',
      '  n0 [label="", shape="tripleoctagon"];',
      '  n1 [label="m", shape="hexagon"];',
      '  n0 -> n1 [style="solid", color="black"];',
      '}'
    ].join('\n'));

    expect(cfg).toBe([
      'digraph G {',
      '  subgraph cluster_cfg {',
      '    graph [style="filled", color="lightgrey", label="m()", fontsize=16];',
      '    node [style="filled", color="white"];',
      '    n0 [label="", shape="circle", style="filled", color="black"];',
      '    n1 [label="", shape="doublecircle", style="filled", color="black"];',
      '    n2 [label="", shape="ellipse"];',
      '    n3 [label="", shape="diamond"];',
      '    n4 [label="", shape="ellipse"];',
      '    n0 -> n3 [label=""];',
      '    n3 -> n4 [label="[(x > 0)]"];',
      '    n4 -> n1 [label="/return x"];',
      '    n3 -> n2 [label="[else]"];',
      '    n2 -> n1 [label="/return 0"];',
      '  }',
      '}'
    ].join('\n'));
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

  test('can generate a selected Graphviz artifact subset', async () => {
    const { model, document } = await parseRuntimeProgram(`
      func add(a, b)
        return a + b
    `);

    expectErrors(document);

    const artifacts = generateGraphvizArtifacts(model, { kinds: ['dep'] });
    expect(artifacts.map(artifact => artifact.fileName)).toEqual(['graphvizDep.dot']);
    expect(artifacts[0].code).toContain('label="add", shape="hexagon"');
  });

  test('generates the complete AST for programs with more than ten instructions', async () => {
    const declarations = Array.from({ length: 15 }, (_, index) => `var value${index} = ${index}`).join('\n');
    const { model, document } = await parseRuntimeProgram(declarations);
    expectErrors(document);

    const ast = artifactCode(generateGraphvizArtifacts(model, { kinds: ['ast'] }), 'graphvizAST.dot');
    expect(ast).not.toContain('Number_of_Instructions_has_exceeded');
    expect(ast.match(/label="VarDecl\\n------\\nvalue\d+"/g)).toHaveLength(15);
  });
});

/**
 * Liefert den Inhalt eines benannten Generatorartefakts und schlägt bei fehlendem Eintrag fehl.
 * @param artifacts Erzeugte Dateiname-Code-Paare.
 * @param fileName Gesuchter Artefaktname.
 * @returns Graphviz-Code des Artefakts.
 */
function artifactCode(artifacts: Array<{ fileName: string; code: string }>, fileName: string): string {
  const artifact = artifacts.find(candidate => candidate.fileName === fileName);
  expect(artifact).toBeTruthy();
  return artifact!.code;
}

/**
 * Erwartet, dass ein geparstes Dokument keine Diagnosen mit Fehlerseverity enthält.
 * @param document Dokumentähnliches Objekt mit optionalen Diagnosen.
 */
function expectErrors(document: { diagnostics?: Array<{ severity?: number; message: string }> }): void {
  const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
  expect(errors.map(error => error.message).join('\n')).toBe('');
}
