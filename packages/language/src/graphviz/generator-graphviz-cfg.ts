import { AstUtils } from 'langium';
import type {
  Block,
  Expr,
  ExprStatement,
  FunctionDeclaration,
  Instruction,
  Program
} from '../generated/ast.js';
import {
  isAssignment,
  isBlock,
  isCallCommand,
  isDoWhileLoop,
  isExprStatement,
  isForLoop,
  isFunctionDeclaration,
  isIfStatement,
  isPrintCommand,
  isReturnStmt,
  isStructDeclaration,
  isThrowCommand,
  isVarDecl,
  isWhileLoop
} from '../generated/ast.js';
import { dotAttributes, dotId } from './dot-utils.js';
import { printExpr, printInstruction } from './pseudo2-printer.js';

type CfgNodeKind = 'start' | 'stop' | 'plain' | 'decision' | 'error';

export type GraphvizCfgArtifact = {
  fileName: string;
  code: string;
};

class CfgNode {
  id = '';

  constructor(readonly kind: CfgNodeKind) {}
}

class CfgEdge {
  cond?: Expr;
  isElse = false;

  constructor(
    public from: CfgNode,
    public to: CfgNode,
    readonly action?: Instruction
  ) {}

  isSkip(): boolean {
    return this.action === undefined && this.cond === undefined && !this.isElse;
  }
}

type ConnectContext = {
  builder: CfgGraphBuilder;
  from: CfgNode;
  to: CfgNode;
  ret: CfgNode;
};

export function generateGraphvizCfgArtifacts(program: Program): GraphvizCfgArtifact[] {
  return globalFunctions(program).map(fn => ({
    fileName: `graphvizCfg_${safeFilePart(fn.name)}.dot`,
    code: generateGraphvizCfg(program, fn)
  }));
}

export function generateGraphvizCfg(_program: Program, fn: FunctionDeclaration): string {
  if (outOfFragment(fn)) {
    return 'digraph G { not_in_fragment }';
  }

  const builder = new CfgGraphBuilder();
  const start = new CfgNode('start');
  const stop = new CfgNode('stop');

  builder.addNode(start);
  builder.addNode(stop);

  connect({ builder, from: start, to: stop, ret: stop }, blockInstructions(fn.body));

  while (builder.optimize()) {
    // Remove unreachable graph parts until stable.
  }
  while (builder.optimize2()) {
    // Remove plain skip-only nodes until stable.
  }
  while (builder.optimize3()) {
    // Remove plain nodes with one outgoing skip edge until stable.
  }

  return builder.build(fn.name);
}

function globalFunctions(program: Program): FunctionDeclaration[] {
  return (program.instructions ?? []).filter(isFunctionDeclaration);
}

function outOfFragment(fn: FunctionDeclaration): boolean {
  return [...AstUtils.streamAllContents(fn)].some(isForLoop);
}

function connect(ctx: ConnectContext, statements: Instruction[]): void {
  if (statements.length === 0) {
    ctx.builder.addEdge(new CfgEdge(ctx.from, ctx.to));
    return;
  }

  const [head, ...tail] = statements;
  const middle = new CfgNode('plain');
  ctx.builder.addNode(middle);

  connectStmt({ ...ctx, to: middle }, head);
  connect({ ...ctx, from: middle }, tail);
}

function connectStmt(ctx: ConnectContext, statement: Instruction): void {
  if (isVarDecl(statement) || isAssignment(statement) || isPrintCommand(statement) || isCallCommand(statement)) {
    ctx.builder.addEdge(new CfgEdge(ctx.from, ctx.to, statement));
    return;
  }

  if (isExprStatement(statement)) {
    connectExprStatement(ctx, statement);
    return;
  }

  if (isForLoop(statement)) {
    throw new Error(`instruction outside fragment: ${statement.$type}`);
  }

  if (isWhileLoop(statement)) {
    connectWhile(ctx, statement.condition, blockInstructions(statement.body));
    return;
  }

  if (isDoWhileLoop(statement)) {
    connectDoWhile(ctx, statement.condition, blockInstructions(statement.body));
    return;
  }

  if (isIfStatement(statement)) {
    connectIf(ctx, statement.condition, blockInstructions(statement.thenBlock), statement.elseBlock ? blockInstructions(statement.elseBlock) : []);
    return;
  }

  if (isFunctionDeclaration(statement) || isStructDeclaration(statement)) {
    return;
  }

  if (isReturnStmt(statement)) {
    ctx.builder.addEdge(new CfgEdge(ctx.from, ctx.ret, statement));
    return;
  }

  if (isThrowCommand(statement)) {
    const errorNode = new CfgNode('error');
    ctx.builder.addNode(errorNode);
    ctx.builder.addEdge(new CfgEdge(ctx.from, errorNode, statement));
    return;
  }

  if (isBlock(statement)) {
    connect(ctx, blockInstructions(statement));
    return;
  }

  throw new Error('Unknown instruction type');
}

function connectExprStatement(ctx: ConnectContext, statement: ExprStatement): void {
  ctx.builder.addEdge(new CfgEdge(ctx.from, ctx.to, statement));
}

function connectWhile(ctx: ConnectContext, condition: Expr, body: Instruction[]): void {
  const ifNode = new CfgNode('decision');
  const startBody = new CfgNode('plain');
  const endBody = new CfgNode('plain');

  ctx.builder.addNode(ifNode);
  ctx.builder.addNode(startBody);
  ctx.builder.addNode(endBody);

  ctx.builder.addEdge(new CfgEdge(ctx.from, ifNode));

  const thenEdge = new CfgEdge(ifNode, startBody);
  thenEdge.cond = condition;
  ctx.builder.addEdge(thenEdge);

  ctx.builder.addEdge(new CfgEdge(endBody, ctx.from));

  const elseEdge = new CfgEdge(ifNode, ctx.to);
  elseEdge.isElse = true;
  ctx.builder.addEdge(elseEdge);

  connect({ ...ctx, from: startBody, to: endBody }, body);
}

function connectDoWhile(ctx: ConnectContext, condition: Expr, body: Instruction[]): void {
  const ifNode = new CfgNode('decision');
  const endBody = new CfgNode('plain');

  ctx.builder.addNode(ifNode);
  ctx.builder.addNode(endBody);

  ctx.builder.addEdge(new CfgEdge(endBody, ifNode));

  const thenEdge = new CfgEdge(ifNode, ctx.from);
  thenEdge.cond = condition;
  ctx.builder.addEdge(thenEdge);

  const elseEdge = new CfgEdge(ifNode, ctx.to);
  elseEdge.isElse = true;
  ctx.builder.addEdge(elseEdge);

  connect({ ...ctx, to: endBody }, body);
}

function connectIf(ctx: ConnectContext, condition: Expr, thenStatements: Instruction[], elseStatements: Instruction[]): void {
  const ifNode = new CfgNode('decision');
  ctx.builder.addNode(ifNode);
  ctx.builder.addEdge(new CfgEdge(ctx.from, ifNode));

  const thenNode = new CfgNode('plain');
  ctx.builder.addNode(thenNode);

  const thenEdge = new CfgEdge(ifNode, thenNode);
  thenEdge.cond = condition;
  ctx.builder.addEdge(thenEdge);

  connect({ ...ctx, from: thenNode }, thenStatements);

  if (elseStatements.length === 0) {
    const elseEdge = new CfgEdge(ifNode, ctx.to);
    elseEdge.isElse = true;
    ctx.builder.addEdge(elseEdge);
    return;
  }

  const elseNode = new CfgNode('plain');
  ctx.builder.addNode(elseNode);

  const elseEdge = new CfgEdge(ifNode, elseNode);
  elseEdge.isElse = true;
  ctx.builder.addEdge(elseEdge);

  connect({ ...ctx, from: elseNode }, elseStatements);
}

function blockInstructions(block: Block): Instruction[] {
  return block.instructions ?? [];
}

class CfgGraphBuilder {
  readonly nodes: CfgNode[] = [];
  readonly edges: CfgEdge[] = [];
  private nodeCounter = 0;

  addNode(node: CfgNode): void {
    node.id = dotId('n', this.nodeCounter++);
    this.nodes.push(node);
  }

  addEdge(edge: CfgEdge): void {
    this.edges.push(edge);
  }

  optimize(): boolean {
    const unreachableNodes = this.nodes.filter(node => node.kind !== 'start' && this.incomingEdges(node).length === 0);
    if (unreachableNodes.length === 0) {
      return false;
    }

    for (const node of [...unreachableNodes]) {
      this.removeOutgoingEdges(node);
      removeFromArray(this.nodes, node);
    }

    return true;
  }

  optimize2(): boolean {
    const skipNodes = this.nodes
      .filter(node => node.kind === 'plain')
      .filter(node => this.incomingEdges(node).every(edge => edge.isSkip()))
      .filter(node => this.outgoingEdges(node).every(edge => edge.isSkip()))
      .filter(node => this.incomingEdges(node).length === 1 || this.outgoingEdges(node).length === 1);

    if (skipNodes.length === 0) {
      return false;
    }

    const node = skipNodes[0];
    const incoming = this.incomingEdges(node);
    const outgoing = this.outgoingEdges(node);

    if (incoming.length === 1) {
      const predEdge = incoming[0];
      for (const edge of [...outgoing]) {
        edge.from = predEdge.from;
      }
      removeFromArray(this.edges, predEdge);
    } else {
      const succEdge = outgoing[0];
      for (const edge of [...incoming]) {
        edge.to = succEdge.to;
      }
      removeFromArray(this.edges, succEdge);
    }

    removeFromArray(this.nodes, node);
    return true;
  }

  optimize3(): boolean {
    const skipNodes = this.nodes
      .filter(node => node.kind === 'plain')
      .filter(node => this.outgoingEdges(node).every(edge => edge.isSkip()))
      .filter(node => this.outgoingEdges(node).length === 1);

    if (skipNodes.length === 0) {
      return false;
    }

    const node = skipNodes[0];
    const succEdge = this.outgoingEdges(node)[0];

    for (const edge of [...this.incomingEdges(node)]) {
      edge.to = succEdge.to;
    }

    removeFromArray(this.edges, succEdge);
    removeFromArray(this.nodes, node);
    return true;
  }

  incomingEdges(node: CfgNode): CfgEdge[] {
    return this.edges.filter(edge => edge.to === node);
  }

  outgoingEdges(node: CfgNode): CfgEdge[] {
    return this.edges.filter(edge => edge.from === node);
  }

  build(functionName: string): string {
    const lines = [
      'digraph G {',
      '  subgraph cluster_cfg {',
      `    graph${dotAttributes({ style: 'filled', color: 'lightgrey', label: `${functionName}()`, fontsize: 16 })};`,
      '    node [style="filled", color="white"];'
    ];

    for (const node of this.nodes) {
      lines.push(`    ${node.id}${dotAttributes(cfgNodeAttributes(node))};`);
    }

    for (const edge of this.edges) {
      lines.push(`    ${edge.from.id} -> ${edge.to.id}${dotAttributes({ label: edgeLabel(edge) })};`);
    }

    lines.push('  }');
    lines.push('}');
    return lines.join('\n');
  }

  private removeOutgoingEdges(node: CfgNode): void {
    for (const edge of [...this.outgoingEdges(node)]) {
      removeFromArray(this.edges, edge);
    }
  }
}

function cfgNodeAttributes(node: CfgNode): Record<string, string> {
  switch (node.kind) {
    case 'decision':
      return { label: '', shape: 'diamond' };
    case 'start':
      return { label: '', shape: 'circle', style: 'filled', color: 'black' };
    case 'stop':
      return { label: '', shape: 'doublecircle', style: 'filled', color: 'black' };
    case 'error':
      return { label: '', shape: 'doublecircle', style: 'filled', color: 'red' };
    case 'plain':
    default:
      return { label: '', shape: 'ellipse' };
  }
}

function edgeLabel(edge: CfgEdge): string {
  if (edge.isElse) {
    return '[else]';
  }

  if (edge.cond) {
    return `[${printExpr(edge.cond)}]`;
  }

  if (!edge.action) {
    return '';
  }

  if (isPrintCommand(edge.action)) {
    return '/print';
  }

  if (isThrowCommand(edge.action)) {
    return '/throw';
  }

  return `/${printInstruction(edge.action)}`;
}

function safeFilePart(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_') || 'anonymous';
}

function removeFromArray<T>(array: T[], item: T): void {
  const index = array.indexOf(item);
  if (index >= 0) {
    array.splice(index, 1);
  }
}
