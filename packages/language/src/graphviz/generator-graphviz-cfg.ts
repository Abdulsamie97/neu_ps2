/**
 * @file generator-graphviz-cfg.ts
 * @brief Erzeugt und vereinfacht Kontrollflussgraphen für globale Pseudo2-Funktionen.
 * @author Abdul
 */

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
  isVerificationStatement,
  isWhileLoop
} from '../generated/ast.js';
import { dotAttributes, dotId } from './dot-utils.js';
import { printExpr, printInstruction } from './pseudo2-printer.js';

/** Fachliche Rolle eines Knotens im Kontrollflussgraphen. */
type CfgNodeKind = 'start' | 'stop' | 'plain' | 'decision' | 'error';

/**
 * Ein benanntes DOT-Artefakt für den Kontrollfluss einer Funktion.
 */
export type GraphvizCfgArtifact = {
  /** Sicherer Zieldateiname des Graphen. */
  fileName: string;
  /** Vollständiger DOT-Quelltext. */
  code: string;
};

/**
 * Interner Knoten des noch nicht gerenderten Kontrollflussgraphen.
 */
class CfgNode {
  /** Beim Einfügen vom Builder vergebene DOT-ID. */
  id = '';

  /**
   * Erstellt einen Knoten mit der angegebenen Kontrollflussrolle.
   *
   * @param kind Visuelle und semantische Rolle des Knotens.
   */
  constructor(readonly kind: CfgNodeKind) {}
}

/**
 * Gerichtete Kontrollflusskante mit optionaler Aktion oder Bedingung.
 */
class CfgEdge {
  /** Bedingung einer positiven Entscheidungskante. */
  cond?: Expr;
  /** Markiert die alternative Kante einer Verzweigung. */
  isElse = false;

  /**
   * Erstellt eine Kante zwischen zwei CFG-Knoten.
   *
   * @param from Ausgangsknoten.
   * @param to Zielknoten.
   * @param action Optional auf der Kante ausgeführte Pseudo2-Anweisung.
   */
  constructor(
    public from: CfgNode,
    public to: CfgNode,
    readonly action?: Instruction
  ) {}

  /**
   * Prüft, ob die Kante nur strukturell verbindet und keine Semantik trägt.
   *
   * @returns `true`, wenn weder Aktion, Bedingung noch Else-Markierung gesetzt ist.
   */
  isSkip(): boolean {
    return this.action === undefined && this.cond === undefined && !this.isElse;
  }
}

/**
 * Gemeinsamer Zustand beim rekursiven Verbinden einer Anweisungsfolge.
 */
type ConnectContext = {
  /** Builder, in den neue Knoten und Kanten eingetragen werden. */
  builder: CfgGraphBuilder;
  /** Eintrittsknoten des aktuellen Fragments. */
  from: CfgNode;
  /** Regulärer Austrittsknoten des aktuellen Fragments. */
  to: CfgNode;
  /** Funktionsweiter Zielknoten für Return-Anweisungen. */
  ret: CfgNode;
};

/**
 * Erzeugt für jede globale Funktion des Programms ein separates CFG-Artefakt.
 *
 * Struct-Methoden sind nicht Teil dieser Liste, da der historische CFG-Generator
 * ausschließlich globale Funktionen als eigenständige Fragmente verarbeitet.
 *
 * @param program Vollständig geparstes Pseudo2-Programm.
 * @returns Dateinamen und DOT-Inhalt aller erzeugbaren Funktionsgraphen.
 */
export function generateGraphvizCfgArtifacts(program: Program): GraphvizCfgArtifact[] {
  return globalFunctions(program).map(fn => ({
    fileName: `graphvizCfg_${safeFilePart(fn.name)}.dot`,
    code: generateGraphvizCfg(program, fn)
  }));
}

/**
 * Erzeugt den Kontrollflussgraphen einer einzelnen Funktion.
 *
 * Nach dem Aufbau werden die Optimierungen wiederholt bis zu einem Fixpunkt
 * ausgeführt. Funktionen mit For-Schleifen liegen außerhalb des unterstützten
 * historischen Fragments und erhalten einen expliziten Hinweisgraphen.
 *
 * @param _program Zugehöriges Programm; für API-Kompatibilität vorhanden.
 * @param fn Funktion, deren Body analysiert wird.
 * @returns Vollständiger DOT-Quelltext des Kontrollflussgraphen.
 */
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

/**
 * Filtert die globalen Funktionsdeklarationen aus den Top-Level-Anweisungen.
 *
 * @param program Pseudo2-Programm.
 * @returns Globale Funktionen in Quellreihenfolge.
 */
function globalFunctions(program: Program): FunctionDeclaration[] {
  return (program.instructions ?? []).filter(isFunctionDeclaration);
}

/**
 * Prüft, ob eine Funktion nicht unterstützte CFG-Konstrukte enthält.
 *
 * @param fn Zu prüfende Funktion.
 * @returns `true`, sobald innerhalb der Funktion eine For-Schleife vorkommt.
 */
function outOfFragment(fn: FunctionDeclaration): boolean {
  return [...AstUtils.streamAllContents(fn)].some(isForLoop);
}

/**
 * Verbindet eine Folge von Anweisungen rekursiv zwischen zwei CFG-Knoten.
 *
 * Für eine leere Folge wird eine Skip-Kante erzeugt. Andernfalls verbindet ein
 * temporärer Mittelknoten die erste Anweisung mit dem rekursiv aufgebauten Rest.
 *
 * @param ctx Eintritt, Austritt, Return-Ziel und Ziel-Builder.
 * @param statements Zu verbindende Anweisungen in Ausführungsreihenfolge.
 */
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

/**
 * Übersetzt eine einzelne Anweisung in das passende Kontrollflussfragment.
 *
 * Einfache Anweisungen landen direkt auf einer Kante. Schleifen und
 * Verzweigungen erzeugen eigene Knoten; Return springt zum gemeinsamen
 * Funktionsende und Throw endet in einem Fehlerknoten.
 *
 * @param ctx Kontext des aktuellen Kontrollflussfragments.
 * @param statement Zu übersetzende Pseudo2-Anweisung.
 * @throws Error Bei For-Schleifen oder unbekannten Anweisungstypen.
 */
function connectStmt(ctx: ConnectContext, statement: Instruction): void {
  if (
    isVarDecl(statement) ||
    isAssignment(statement) ||
    isPrintCommand(statement) ||
    isCallCommand(statement) ||
    isVerificationStatement(statement)
  ) {
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

/**
 * Legt eine Ausdrucksanweisung als beschriftete Kante ab.
 *
 * @param ctx Aktueller Verbindungskontext.
 * @param statement Ausdrucksanweisung.
 */
function connectExprStatement(ctx: ConnectContext, statement: ExprStatement): void {
  ctx.builder.addEdge(new CfgEdge(ctx.from, ctx.to, statement));
}

/**
 * Baut Entscheidung, Body-Eintritt, Rückkante und Exit einer While-Schleife.
 *
 * @param ctx Umgebender Kontrollflusskontext.
 * @param condition Schleifenbedingung.
 * @param body Anweisungen des Schleifenrumpfs.
 */
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

/**
 * Baut eine Do-While-Schleife mit garantiertem erstem Body-Durchlauf.
 *
 * Die Bedingung wird hinter dem Body ausgewertet; die positive Kante führt zum
 * ursprünglichen Body-Eintritt zurück, die Else-Kante zum regulären Nachfolger.
 *
 * @param ctx Umgebender Kontrollflusskontext.
 * @param condition Schleifenbedingung.
 * @param body Anweisungen des Schleifenrumpfs.
 */
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

/**
 * Baut eine If-Verzweigung mit positiven und alternativen Pfaden.
 *
 * Fehlt ein Else-Block, führt die Else-Kante direkt zum Nachfolger. Andernfalls
 * erhält auch der Else-Zweig einen eigenen Eintrittsknoten.
 *
 * @param ctx Umgebender Kontrollflusskontext.
 * @param condition Verzweigungsbedingung.
 * @param thenStatements Anweisungen des Then-Zweigs.
 * @param elseStatements Anweisungen des optionalen Else-Zweigs.
 */
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

/**
 * Liefert die Anweisungen eines Blocks mit leerer Liste als Fallback.
 *
 * @param block Braced- oder eingerückter Pseudo2-Block.
 * @returns Enthaltene Anweisungen in Quellreihenfolge.
 */
function blockInstructions(block: Block): Instruction[] {
  return block.instructions ?? [];
}

/**
 * Verwaltet den veränderlichen CFG, seine Optimierung und die DOT-Ausgabe.
 */
class CfgGraphBuilder {
  /** Alle aktuell vorhandenen Knoten in Einfügereihenfolge. */
  readonly nodes: CfgNode[] = [];
  /** Alle aktuell vorhandenen gerichteten Kanten. */
  readonly edges: CfgEdge[] = [];
  /** Zähler zur kollisionsfreien Vergabe von DOT-Knoten-IDs. */
  private nodeCounter = 0;

  /**
   * Registriert einen Knoten und weist ihm seine endgültige DOT-ID zu.
   *
   * @param node Einzufügender CFG-Knoten.
   */
  addNode(node: CfgNode): void {
    node.id = dotId('n', this.nodeCounter++);
    this.nodes.push(node);
  }

  /**
   * Fügt eine bereits konfigurierte Kante zum Graphen hinzu.
   *
   * @param edge Einzufügende Kontrollflusskante.
   */
  addEdge(edge: CfgEdge): void {
    this.edges.push(edge);
  }

  /**
   * Entfernt eine Ebene aktuell unerreichbarer Knoten.
   *
   * Ausgenommen ist der Startknoten. Ausgehende Kanten werden mit entfernt;
   * wiederholte Aufrufe beseitigen dadurch auch nachgelagert unerreichbare Teile.
   *
   * @returns `true`, wenn der Graph verändert wurde.
   */
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

  /**
   * Zieht einen rein strukturellen Plain-Knoten mit eindeutigem Ein- oder Ausgang zusammen.
   *
   * Alle beteiligten Kanten müssen Skip-Kanten sein. Je nach Eindeutigkeit
   * werden die Nachfolger zum Vorgänger oder die Vorgänger zum Nachfolger umgebogen.
   *
   * @returns `true`, wenn ein Skip-Knoten entfernt wurde.
   */
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

  /**
   * Entfernt einen Plain-Knoten mit genau einer ausgehenden Skip-Kante.
   *
   * Sämtliche eingehenden Kanten werden direkt auf den Nachfolger umgeleitet.
   *
   * @returns `true`, wenn ein Knoten zusammengezogen wurde.
   */
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

  /**
   * Ermittelt alle in einen Knoten eingehenden Kanten.
   *
   * @param node Zielknoten der gesuchten Kanten.
   * @returns Passende Kanten in Speicherreihenfolge.
   */
  incomingEdges(node: CfgNode): CfgEdge[] {
    return this.edges.filter(edge => edge.to === node);
  }

  /**
   * Ermittelt alle aus einem Knoten ausgehenden Kanten.
   *
   * @param node Ausgangsknoten der gesuchten Kanten.
   * @returns Passende Kanten in Speicherreihenfolge.
   */
  outgoingEdges(node: CfgNode): CfgEdge[] {
    return this.edges.filter(edge => edge.from === node);
  }

  /**
   * Rendert den aktuellen Builder-Zustand als DOT-Subgraph.
   *
   * @param functionName Quellname der Funktion für das Clusterlabel.
   * @returns Vollständiger DOT-Quelltext.
   */
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

  /**
   * Entfernt sämtliche vom angegebenen Knoten ausgehenden Kanten.
   *
   * @param node Knoten, dessen Nachfolgerverbindungen gelöscht werden.
   */
  private removeOutgoingEdges(node: CfgNode): void {
    for (const edge of [...this.outgoingEdges(node)]) {
      removeFromArray(this.edges, edge);
    }
  }
}

/**
 * Ordnet einer CFG-Knotenrolle die passenden DOT-Attribute zu.
 *
 * @param node Zu rendernder CFG-Knoten.
 * @returns Label-, Form- und Farbattribute.
 */
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

/**
 * Erzeugt das semantische Label einer Kontrollflusskante.
 *
 * Else- und Bedingungskanten werden in eckigen Klammern dargestellt. Aktionen
 * erhalten einen führenden Schrägstrich; Print und Throw werden bewusst verkürzt.
 *
 * @param edge Zu beschriftende Kante.
 * @returns Kantenlabel oder Leerstring für reine Skip-Kanten.
 */
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

/**
 * Normalisiert einen Funktionsnamen für die Verwendung in einem Dateinamen.
 *
 * @param name Pseudo2-Quellname.
 * @returns Sicherer Dateinamensbestandteil oder `anonymous`.
 */
function safeFilePart(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_') || 'anonymous';
}

/**
 * Entfernt genau das erste identische Element aus einem Array.
 *
 * @typeParam T Elementtyp des Arrays.
 * @param array Zu veränderndes Array.
 * @param item Zu entfernende Objektinstanz.
 */
function removeFromArray<T>(array: T[], item: T): void {
  const index = array.indexOf(item);
  if (index >= 0) {
    array.splice(index, 1);
  }
}
