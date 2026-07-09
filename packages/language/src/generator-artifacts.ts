import type { Program } from './generated/ast.js';
import { generateProgram } from './langenerator.js';
import { generateGraphvizAst } from './graphviz/generator-graphviz-ast.js';
import { generateGraphvizCfgArtifacts } from './graphviz/generator-graphviz-cfg.js';
import { generateGraphvizDep } from './graphviz/generator-graphviz-dep.js';

export type GeneratedArtifact = {
  fileName: string;
  code: string;
};

export function generateGraphvizArtifacts(program: Program): GeneratedArtifact[] {
  return [
    { fileName: 'graphvizAST.dot', code: generateGraphvizAst(program) },
    { fileName: 'graphvizDep.dot', code: generateGraphvizDep(program) },
    ...generateGraphvizCfgArtifacts(program)
  ];
}

export function generateAllArtifacts(program: Program): GeneratedArtifact[] {
  return [
    { fileName: 'generated_code.js', code: generateProgram(program) },
    ...generateGraphvizArtifacts(program)
  ];
}
