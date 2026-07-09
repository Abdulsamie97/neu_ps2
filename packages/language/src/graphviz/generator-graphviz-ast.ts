import { AstUtils } from 'langium';
import type { AstNode } from 'langium';
import type { Program } from '../generated/ast.js';
import {
  isAttSelection,
  isBoolLiteral,
  isExpr,
  isFunctionCall,
  isInstruction,
  isIntLiteral,
  isMethSelection,
  isStringLiteral,
  isStructAttDeclaration,
  isStructDeclaration,
  isVarDecl,
  isVarRef
} from '../generated/ast.js';
import { dotAttributes, dotId } from './dot-utils.js';

const MAX_NO_INSTRUCTIONS = 10;

export function generateGraphvizAst(program: Program): string {
  const contents = [...AstUtils.streamAllContents(program)];
  const instructionCount = contents.filter(isInstruction).length;

  if (instructionCount > MAX_NO_INSTRUCTIONS) {
    return `digraph G { Number_of_Instructions_has_exceeded_${MAX_NO_INSTRUCTIONS} }`;
  }

  const ids = new Map<AstNode, string>();
  let nextId = 0;

  const idFor = (node: AstNode): string => {
    let id = ids.get(node);
    if (!id) {
      id = dotId('n', nextId++);
      ids.set(node, id);
    }
    return id;
  };

  const nodes = [program, ...contents];
  const lines = [
    'digraph G {',
    '  edge [dir="forward"];'
  ];

  for (const node of nodes) {
    const attrs = astNodeAttributes(node);
    lines.push(`  ${idFor(node)}${dotAttributes(attrs)};`);
  }

  for (const node of contents) {
    const parent = node.$container;
    if (!parent) {
      continue;
    }

    const label = node.$containerProperty ?? '';
    lines.push(`  ${idFor(parent)} -> ${idFor(node)}${dotAttributes({ headlabel: label })};`);
  }

  lines.push('}');
  return lines.join('\n');
}

function astNodeAttributes(node: AstNode): Record<string, string> {
  const attrs: Record<string, string> = {
    label: astNodeLabel(node)
  };

  if (!isExpr(node)) {
    attrs.fontcolor = 'red';
    attrs.shape = 'parallelogram';
  }

  return attrs;
}

function astNodeLabel(node: AstNode): string {
  let label = node.$type;

  if (isIntLiteral(node) || isBoolLiteral(node) || isStringLiteral(node)) {
    label += `\n--\n${node.value}`;
  } else if (isVarDecl(node)) {
    label += `\n------\n${node.name}`;
  } else if (isStructAttDeclaration(node)) {
    label += `\n------\n${node.name}`;
  } else if (isStructDeclaration(node)) {
    label += `\n------\n${node.name}`;
  } else if (isVarRef(node)) {
    label += `\n------\n${node.ref?.ref?.name ?? 'unresolved'}`;
  } else if (isFunctionCall(node)) {
    label += `\n------\n${node.f?.ref?.name ?? 'unresolved'}`;
  } else if (isAttSelection(node)) {
    label += `\n------\n${node.attref.ref?.ref?.name ?? 'unresolved'}`;
  } else if (isMethSelection(node)) {
    label += `\n------\n${node.methref.f?.ref?.name ?? 'unresolved'}()`;
  }

  return label;
}
