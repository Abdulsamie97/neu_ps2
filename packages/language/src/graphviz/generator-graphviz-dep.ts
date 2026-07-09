import { AstUtils } from 'langium';
import type { AstNode } from 'langium';
import type {
  FunctionDeclaration,
  Program,
  StructAttDeclaration,
  StructDeclaration,
  VarDecl
} from '../generated/ast.js';
import {
  isAssignment,
  isAttSelection,
  isFunctionCall,
  isFunctionDeclaration,
  isMethSelection,
  isStructAttDeclaration,
  isStructDeclaration,
  isVarDecl,
  isVarRef
} from '../generated/ast.js';
import { dotAttributes, dotId, graphName } from './dot-utils.js';

type DepNodeKind = 'top' | 'gvar' | 'func' | 'struct' | 'att' | 'meth';
type DepEdgeKind = 'read' | 'write' | 'call' | 'create';

type DepNode = {
  id: string;
  label: string;
  kind: DepNodeKind;
  children: DepNode[];
  astNode: AstNode;
};

type DepEdge = {
  from: DepNode;
  to: DepNode;
  kind: DepEdgeKind;
  count: number;
};

export function generateGraphvizDep(program: Program): string {
  const builder = new DependencyGraphBuilder(program);
  builder.addProgram(program);

  for (const fn of globalFunctions(program)) {
    builder.addFunction(fn);
  }

  for (const struct of structDeclarations(program)) {
    builder.addStruct(struct);
  }

  for (const variable of globalVariables(program)) {
    builder.addVariable(variable);
  }

  for (const node of AstUtils.streamAllContents(program)) {
    if (isFunctionCall(node) && node.f?.ref) {
      builder.addFunctionCall(node, node.f.ref);
    } else if (isMethSelection(node) && node.methref.f?.ref) {
      builder.addFunctionCall(node, node.methref.f.ref);
    } else if (isVarRef(node) && node.ref?.ref && builder.isGlobalVariable(node.ref.ref)) {
      builder.addVarRef(node);
    } else if (isAttSelection(node) && node.attref.ref?.ref) {
      builder.addAttSelection(node);
    }
  }

  return builder.build();
}

function globalFunctions(program: Program): FunctionDeclaration[] {
  return (program.instructions ?? []).filter(isFunctionDeclaration);
}

function structDeclarations(program: Program): StructDeclaration[] {
  return (program.instructions ?? []).filter(isStructDeclaration);
}

function globalVariables(program: Program): VarDecl[] {
  return (program.instructions ?? []).filter(isVarDecl);
}

class DependencyGraphBuilder {
  private readonly nodeByAst = new Map<AstNode, DepNode>();
  private readonly edges: DepEdge[] = [];
  private nodeCounter = 0;

  constructor(private readonly program: Program) {}

  addProgram(program: Program): void {
    this.addNode(program, '', 'top');
  }

  addVariable(variable: VarDecl): void {
    this.addNode(variable, variable.name, 'gvar');
  }

  addFunction(fn: FunctionDeclaration): void {
    this.addNode(fn, fn.name, 'func');
  }

  addStruct(struct: StructDeclaration): void {
    const parent = this.addNode(struct, struct.name, 'struct');

    for (const child of struct.children ?? []) {
      if (isStructAttDeclaration(child)) {
        this.addStructChild(parent, child, 'att');
      } else if (isFunctionDeclaration(child)) {
        this.addStructChild(parent, child, 'meth');
      }
    }
  }

  addFunctionCall(call: AstNode, target: FunctionDeclaration): void {
    const to = this.nodeByAst.get(target);
    const from = this.nodeForMappedParent(call);

    if (!from || !to) {
      return;
    }

    this.addEdge(from, to, 'call');
  }

  addVarRef(ref: AstNode): void {
    if (!isVarRef(ref) || !ref.ref?.ref || !isVarDecl(ref.ref.ref)) {
      return;
    }

    const to = this.nodeByAst.get(ref.ref.ref);
    const from = this.nodeForMappedParent(ref);

    if (!from || !to) {
      return;
    }

    this.addEdge(from, to, isDirectAssignmentTarget(ref) ? 'write' : 'read');
  }

  addAttSelection(selection: AstNode): void {
    if (!isAttSelection(selection) || !selection.attref.ref?.ref) {
      return;
    }

    const to = this.nodeByAst.get(selection.attref.ref.ref);
    const from = this.nodeForMappedParent(selection);

    if (!from || !to) {
      return;
    }

    this.addEdge(from, to, isDirectAssignmentTarget(selection) ? 'write' : 'read');
  }

  isGlobalVariable(node: AstNode): node is VarDecl {
    return isVarDecl(node) && (this.program.instructions ?? []).includes(node);
  }

  build(): string {
    const lines = [
      'digraph G {',
      '  graph [compound=true];',
      '  edge [arrowhead="vee"];'
    ];

    for (const node of this.nodeByAst.values()) {
      if (node.kind === 'struct') {
        lines.push(...this.renderStruct(node));
      } else if (node.kind !== 'att' && node.kind !== 'meth') {
        lines.push(`  ${node.id}${dotAttributes(depNodeAttributes(node))};`);
      }
    }

    for (const edge of this.edges) {
      lines.push(`  ${edge.from.id} -> ${edge.to.id}${dotAttributes(depEdgeAttributes(edge.kind))};`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  private addStructChild(parent: DepNode, child: StructAttDeclaration | FunctionDeclaration, kind: 'att' | 'meth'): void {
    const node = this.addNode(child, child.name, kind);
    parent.children.push(node);
  }

  private addNode(astNode: AstNode, label: string, kind: DepNodeKind): DepNode {
    const node: DepNode = {
      id: dotId('n', this.nodeCounter++),
      label,
      kind,
      children: [],
      astNode
    };
    this.nodeByAst.set(astNode, node);
    return node;
  }

  private addEdge(from: DepNode, to: DepNode, kind: DepEdgeKind): void {
    const existing = this.edges.find(edge => edge.from === from && edge.to === to && edge.kind === kind);
    if (existing) {
      existing.count++;
    } else {
      this.edges.push({ from, to, kind, count: 0 });
    }
  }

  private nodeForMappedParent(node: AstNode): DepNode | undefined {
    let current: AstNode | undefined = node;

    while (current) {
      const mapped = this.nodeByAst.get(current);
      if (mapped) {
        return mapped;
      }
      current = current.$container;
    }

    return undefined;
  }

  private renderStruct(node: DepNode): string[] {
    const clusterId = `cluster_${graphName(node.id)}`;
    const lines = [
      `  subgraph ${clusterId} {`,
      `    graph${dotAttributes({ style: 'filled', color: 'lightgrey', fontsize: 24, label: node.label })};`,
      '    node [style="filled", color="white"];'
    ];

    for (const child of node.children) {
      lines.push(`    ${child.id}${dotAttributes(depNodeAttributes(child))};`);
    }

    lines.push('  }');
    return lines;
  }
}

function depNodeAttributes(node: DepNode): Record<string, string> {
  return {
    label: node.label,
    shape: nodeShape(node.kind)
  };
}

function nodeShape(kind: DepNodeKind): string {
  switch (kind) {
    case 'top':
      return 'tripleoctagon';
    case 'gvar':
    case 'att':
      return 'house';
    case 'func':
    case 'meth':
      return 'hexagon';
    default:
      return 'ellipse';
  }
}

function depEdgeAttributes(kind: DepEdgeKind): Record<string, string> {
  switch (kind) {
    case 'read':
      return { style: 'dashed', color: 'green' };
    case 'write':
      return { style: 'dashed', color: 'red' };
    case 'create':
      return { style: 'dotted', color: 'black' };
    case 'call':
    default:
      return { style: 'solid', color: 'black' };
  }
}

function isDirectAssignmentTarget(node: AstNode): boolean {
  const parent = node.$container;
  return isAssignment(parent) && parent.sel === node;
}
