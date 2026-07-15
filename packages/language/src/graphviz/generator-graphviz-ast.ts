/**
 * @file generator-graphviz-ast.ts
 * @brief Erzeugt eine vollständige Graphviz-Darstellung des Pseudo2-AST.
 * @author Abdul
 */

import { AstUtils } from 'langium';
import type { AstNode } from 'langium';
import type { Program } from '../generated/ast.js';
import {
  isAttSelection,
  isBoolLiteral,
  isExpr,
  isFunctionCall,
  isIntLiteral,
  isMethSelection,
  isStringLiteral,
  isStructAttDeclaration,
  isStructDeclaration,
  isVarDecl,
  isVarRef
} from '../generated/ast.js';
import { dotAttributes, dotId } from './dot-utils.js';

/**
 * Wandelt das Programm und sämtliche enthaltenen AST-Knoten in einen DOT-Graphen um.
 *
 * Jeder AST-Knoten erhält eine eindeutige ID und einen typabhängigen Beschriftungstext.
 * Die Containerbeziehung wird als gerichtete Kante dargestellt; der Name der
 * Container-Eigenschaft erscheint als Kantenlabel.
 *
 * @param program Wurzel des vollständig gelinkten Pseudo2-AST.
 * @returns Vollständiger DOT-Quelltext des AST-Graphen.
 */
export function generateGraphvizAst(program: Program): string {
  const contents = [...AstUtils.streamAllContents(program)];

  const ids = new Map<AstNode, string>();
  let nextId = 0;

  /**
   * Liefert die bereits vergebene Knoten-ID oder reserviert die nächste freie ID.
   *
   * @param node AST-Knoten, dessen DOT-ID benötigt wird.
   * @returns Innerhalb dieses Graphen eindeutige Knoten-ID.
   */
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

/**
 * Bestimmt Label und visuelle Grundform eines AST-Knotens.
 *
 * Ausdrucksknoten verwenden die DOT-Standardform. Deklarationen, Anweisungen
 * und andere Nicht-Ausdrücke werden rot und als Parallelogramm hervorgehoben.
 *
 * @param node Zu klassifizierender AST-Knoten.
 * @returns Attributsammlung für die DOT-Knotendeklaration.
 */
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

/**
 * Erzeugt das fachliche Label eines AST-Knotens.
 *
 * Neben dem konkreten AST-Typ werden bei Literalen ihre Werte und bei
 * Deklarationen oder Referenzen ihre Quellnamen ausgegeben. Nicht aufgelöste
 * Cross-References werden sichtbar mit `unresolved` markiert.
 *
 * @param node AST-Knoten, der im Graphen beschriftet werden soll.
 * @returns Mehrzeiliges DOT-Label.
 */
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
