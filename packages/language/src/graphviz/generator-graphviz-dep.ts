/**
 * @file generator-graphviz-dep.ts
 * @brief Erzeugt einen Abhängigkeitsgraphen für globale Variablen, Funktionen und Structs.
 * @author Abdul
 */

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

/** Unterstützte fachliche Kategorien eines Dependency-Knotens. */
type DepNodeKind = 'top' | 'gvar' | 'func' | 'struct' | 'att' | 'meth';
/** Unterstützte Beziehungen zwischen zwei Dependency-Knoten. */
type DepEdgeKind = 'read' | 'write' | 'call' | 'create';

/**
 * Interne, vom AST entkoppelte Darstellung eines Dependency-Knotens.
 */
type DepNode = {
  /** Eindeutige DOT-ID. */
  id: string;
  /** Sichtbarer Pseudo2-Quellname. */
  label: string;
  /** Fachliche Kategorie für Form und Gruppierung. */
  kind: DepNodeKind;
  /** Bei Structs enthaltene Attribut- und Methodenknoten. */
  children: DepNode[];
  /** Zugehöriger AST-Knoten für Rückverfolgung und Besitzersuche. */
  astNode: AstNode;
};

/**
 * Aggregierte gerichtete Abhängigkeit zwischen zwei Knoten.
 */
type DepEdge = {
  /** Ursprung der Abhängigkeit. */
  from: DepNode;
  /** Ziel der Abhängigkeit. */
  to: DepNode;
  /** Art des Zugriffs oder Aufrufs. */
  kind: DepEdgeKind;
  /** Anzahl weiterer gleicher Vorkommen nach der ersten Kante. */
  count: number;
};

/**
 * Analysiert ein Pseudo2-Programm und erzeugt seinen Dependency-DOT-Graphen.
 *
 * Zuerst werden alle möglichen Ziel- und Besitzerknoten registriert. Danach
 * werden Funktions-/Methodenaufrufe sowie globale Variablen- und Attributzugriffe
 * über den vollständigen AST gesammelt.
 *
 * @param program Vollständig gelinktes Pseudo2-Programm.
 * @returns Vollständiger DOT-Quelltext des Abhängigkeitsgraphen.
 */
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

/**
 * Filtert globale Funktionen aus den Top-Level-Anweisungen.
 *
 * @param program Pseudo2-Programm.
 * @returns Globale Funktionen in Quellreihenfolge.
 */
function globalFunctions(program: Program): FunctionDeclaration[] {
  return (program.instructions ?? []).filter(isFunctionDeclaration);
}

/**
 * Filtert Struct-Deklarationen aus den Top-Level-Anweisungen.
 *
 * @param program Pseudo2-Programm.
 * @returns Structs in Quellreihenfolge.
 */
function structDeclarations(program: Program): StructDeclaration[] {
  return (program.instructions ?? []).filter(isStructDeclaration);
}

/**
 * Filtert globale Variablendeklarationen aus den Top-Level-Anweisungen.
 *
 * @param program Pseudo2-Programm.
 * @returns Globale Variablen in Quellreihenfolge.
 */
function globalVariables(program: Program): VarDecl[] {
  return (program.instructions ?? []).filter(isVarDecl);
}

/**
 * Baut die interne Dependency-Struktur auf und rendert sie als DOT.
 */
class DependencyGraphBuilder {
  /** Ordnet jedem registrierten AST-Knoten genau einen Dependency-Knoten zu. */
  private readonly nodeByAst = new Map<AstNode, DepNode>();
  /** Aggregierte Abhängigkeiten in Entdeckungsreihenfolge. */
  private readonly edges: DepEdge[] = [];
  /** Zähler für kollisionsfreie DOT-Knoten-IDs. */
  private nodeCounter = 0;

  /**
   * Erstellt einen Builder für genau ein Programm.
   *
   * @param program Programmwurzel zur Erkennung globaler Variablen.
   */
  constructor(private readonly program: Program) {}

  /**
   * Registriert die Programmwurzel als Top-Level-Knoten.
   *
   * @param program Zu registrierende Programmwurzel.
   */
  addProgram(program: Program): void {
    this.addNode(program, '', 'top');
  }

  /**
   * Registriert eine globale Variable als Dependency-Ziel.
   *
   * @param variable Globale Variablendeklaration.
   */
  addVariable(variable: VarDecl): void {
    this.addNode(variable, variable.name, 'gvar');
  }

  /**
   * Registriert eine globale Funktion als Aufrufziel und Besitzer.
   *
   * @param fn Globale Funktionsdeklaration.
   */
  addFunction(fn: FunctionDeclaration): void {
    this.addNode(fn, fn.name, 'func');
  }

  /**
   * Registriert ein Struct und seine Attribute sowie Methoden.
   *
   * Die Kinder werden später gemeinsam in einem DOT-Cluster dargestellt.
   *
   * @param struct Zu registrierende Struct-Deklaration.
   */
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

  /**
   * Fügt für einen freien Funktions- oder Methodenaufruf eine Call-Kante ein.
   *
   * Der Ursprung ist der nächste registrierte AST-Vorfahre des Aufrufs. Kann
   * Ursprung oder Ziel nicht bestimmt werden, bleibt der Graph unverändert.
   *
   * @param call AST-Knoten des Aufrufs.
   * @param target Aufgelöste Funktions- oder Methodendeklaration.
   */
  addFunctionCall(call: AstNode, target: FunctionDeclaration): void {
    const to = this.nodeByAst.get(target);
    const from = this.nodeForMappedParent(call);

    if (!from || !to) {
      return;
    }

    this.addEdge(from, to, 'call');
  }

  /**
   * Erfasst den Lese- oder Schreibzugriff auf eine globale Variable.
   *
   * @param ref Erwartete Variablenreferenz; andere AST-Typen werden ignoriert.
   */
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

  /**
   * Erfasst den Lese- oder Schreibzugriff auf ein Struct-Attribut.
   *
   * @param selection Erwartete Attributselektion; ungültige Knoten werden ignoriert.
   */
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

  /**
   * Prüft, ob ein AST-Knoten eine direkte Top-Level-Variablendeklaration ist.
   *
   * @param node Zu prüfender AST-Knoten.
   * @returns `true` nur für Variablen in der Programmanweisungsliste.
   */
  isGlobalVariable(node: AstNode): node is VarDecl {
    return isVarDecl(node) && (this.program.instructions ?? []).includes(node);
  }

  /**
   * Rendert alle registrierten Knoten, Struct-Cluster und Kanten als DOT.
   *
   * @returns Vollständiger DOT-Quelltext.
   */
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

  /**
   * Registriert ein Attribut oder eine Methode und hängt es an sein Struct.
   *
   * @param parent Bereits registrierter Struct-Knoten.
   * @param child Attribut- oder Methodendeklaration.
   * @param kind Passende Kindkategorie `att` oder `meth`.
   */
  private addStructChild(parent: DepNode, child: StructAttDeclaration | FunctionDeclaration, kind: 'att' | 'meth'): void {
    const node = this.addNode(child, child.name, kind);
    parent.children.push(node);
  }

  /**
   * Erstellt einen Dependency-Knoten, vergibt seine ID und registriert das AST-Mapping.
   *
   * @param astNode Zugehöriger AST-Knoten.
   * @param label Sichtbarer Quellname.
   * @param kind Fachliche Knotenkategorie.
   * @returns Neu angelegter Dependency-Knoten.
   */
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

  /**
   * Fügt eine Abhängigkeit hinzu oder aggregiert ein bereits vorhandenes Gegenstück.
   *
   * Gleiche Kanten besitzen identischen Ursprung, identisches Ziel und dieselbe
   * Art. Weitere Vorkommen erhöhen lediglich den internen Zähler.
   *
   * @param from Ursprungsknoten.
   * @param to Zielknoten.
   * @param kind Art der Abhängigkeit.
   */
  private addEdge(from: DepNode, to: DepNode, kind: DepEdgeKind): void {
    const existing = this.edges.find(edge => edge.from === from && edge.to === to && edge.kind === kind);
    if (existing) {
      existing.count++;
    } else {
      this.edges.push({ from, to, kind, count: 0 });
    }
  }

  /**
   * Sucht vom gegebenen AST-Knoten aufwärts den nächsten registrierten Besitzer.
   *
   * So werden beispielsweise Referenzen innerhalb einer Funktion dieser
   * Funktion und Referenzen innerhalb einer Methode der Methode zugeordnet.
   *
   * @param node Ausgangspunkt der Containersuche.
   * @returns Nächster gemappter Dependency-Knoten oder `undefined`.
   */
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

  /**
   * Rendert die Kinder eines Struct-Knotens als eigenes DOT-Cluster.
   *
   * @param node Registrierter Struct-Knoten.
   * @returns Einzelne DOT-Zeilen des Clusters.
   */
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

/**
 * Erzeugt die DOT-Attribute eines Dependency-Knotens.
 *
 * @param node Zu rendernder Knoten.
 * @returns Label und typabhängige Knotenform.
 */
function depNodeAttributes(node: DepNode): Record<string, string> {
  return {
    label: node.label,
    shape: nodeShape(node.kind)
  };
}

/**
 * Ordnet einer fachlichen Knotenkategorie eine DOT-Form zu.
 *
 * @param kind Dependency-Knotenkategorie.
 * @returns DOT-Shape-Name.
 */
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

/**
 * Ordnet einer Abhängigkeitsart Linienstil und Farbe zu.
 *
 * Lesezugriffe sind grün gestrichelt, Schreibzugriffe rot gestrichelt,
 * Erzeugungsbeziehungen punktiert und Aufrufe schwarz durchgezogen.
 *
 * @param kind Art der Abhängigkeit.
 * @returns DOT-Kantenattribute.
 */
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

/**
 * Prüft, ob ein Referenzknoten das unmittelbare Ziel einer Zuweisung ist.
 *
 * @param node Variablen- oder Attributreferenz.
 * @returns `true`, wenn der Container eine Zuweisung mit genau diesem Ziel ist.
 */
function isDirectAssignmentTarget(node: AstNode): boolean {
  const parent = node.$container;
  return isAssignment(parent) && parent.sel === node;
}
