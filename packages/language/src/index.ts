import { AstUtils, EmptyFileSystem, URI } from 'langium';
import type { LangiumServices } from 'langium/lsp';
import { createPseudo2Services as createPseudo2ServicesImpl } from './pseudo2-module.js';
import type { Program } from './generated/ast.js';
import {
  isFunctionDeclaration,
  isStructDeclaration,
  isVarDecl
} from './generated/ast.js';

export * from './pseudo2-module.js';
export * from './pseudo2-validator.js';
export * from './langenerator.js';
export * from './c-generator-core.js';
export * from './generator-pretty.js';
export * from './generator-context.js';
export * from './generator-artifacts.js';
export * from './graphviz/generator-graphviz-ast.js';
export * from './graphviz/generator-graphviz-dep.js';
export * from './graphviz/generator-graphviz-cfg.js';
export * from './generated/ast.js';
export * from './generated/grammar.js';
export * from './generated/module.js';

let summaryServices: LangiumServices | undefined;
let summaryDocumentCounter = 0;

export async function getSummaryFromCode(code: string): Promise<string> {
  if (code.trim().length === 0) {
    return 'Empty Pseudo2 program.';
  }

  summaryServices ??= createPseudo2ServicesImpl(EmptyFileSystem).Pseudo2;

  const documentFactory = summaryServices.shared.workspace.LangiumDocumentFactory;
  const documentBuilder = summaryServices.shared.workspace.DocumentBuilder;
  const document = documentFactory.fromString(code, URI.parse(`memory:/summary-${summaryDocumentCounter++}.pseudo2`));

  await documentBuilder.build([document], { validation: true });

  const program = document.parseResult.value as Program;
  const diagnostics = document.diagnostics ?? [];
  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 1);
  const warnings = diagnostics.filter(diagnostic => diagnostic.severity === 2);
  const contents = [...AstUtils.streamAllContents(program)];
  const structs = contents.filter(isStructDeclaration);
  const functions = contents.filter(isFunctionDeclaration);
  const globalFunctions = functions.filter(fn => fn.keyword === true);
  const methods = functions.filter(fn => fn.keyword !== true);
  const globalVariables = (program.instructions ?? []).filter(isVarDecl);

  return [
    `Lines: ${countLines(code)}`,
    `Top-level instructions: ${program.instructions?.length ?? 0}`,
    `Global variables: ${formatNames(globalVariables.map(variable => variable.name))}`,
    `Structs: ${formatNames(structs.map(struct => struct.name))}`,
    `Functions: ${formatNames(globalFunctions.map(fn => fn.name))}`,
    `Methods: ${formatNames(methods.map(fn => fn.name))}`,
    `Diagnostics: ${errors.length} error(s), ${warnings.length} warning(s)`
  ].join('\n');
}

function countLines(code: string): number {
  return code.replace(/\r/g, '').split('\n').length;
}

function formatNames(names: string[]): string {
  return names.length > 0 ? names.join(', ') : '(none)';
}
