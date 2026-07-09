import type { Program } from './generated/ast.js';
import { generateProgram } from './langenerator.js';
import { generateGraphvizAst } from './graphviz/generator-graphviz-ast.js';
import { generateGraphvizCfgArtifacts } from './graphviz/generator-graphviz-cfg.js';
import { generateGraphvizDep } from './graphviz/generator-graphviz-dep.js';

export type GeneratedArtifact = {
  fileName: string;
  code: string;
};

export type GraphvizArtifactKind = 'ast' | 'dep' | 'cfg';

export type GenerateGraphvizArtifactsOptions = {
  kinds?: GraphvizArtifactKind[];
};

export type GenerateAllArtifactsOptions = GenerateGraphvizArtifactsOptions & {
  includeJavaScript?: boolean;
};

export function generateGraphvizArtifacts(program: Program, options: GenerateGraphvizArtifactsOptions = {}): GeneratedArtifact[] {
  const kinds = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : undefined;
  const artifacts: GeneratedArtifact[] = [];

  if (!kinds || kinds.has('ast')) {
    artifacts.push({ fileName: 'graphvizAST.dot', code: generateGraphvizAst(program) });
  }

  if (!kinds || kinds.has('dep')) {
    artifacts.push({ fileName: 'graphvizDep.dot', code: generateGraphvizDep(program) });
  }

  if (!kinds || kinds.has('cfg')) {
    artifacts.push(...generateGraphvizCfgArtifacts(program));
  }

  return artifacts;
}

export function generateAllArtifacts(program: Program, options: GenerateAllArtifactsOptions = {}): GeneratedArtifact[] {
  const artifacts: GeneratedArtifact[] = [];

  if (options.includeJavaScript !== false) {
    artifacts.push({ fileName: 'generated_code.js', code: generateProgram(program) });
  }

  artifacts.push(...generateGraphvizArtifacts(program, options));
  return artifacts;
}
