/**
 * @file generator-artifacts.ts
 * @brief Orchestriert JavaScript-, Pretty-Pseudo2- und Graphviz-Ausgaben.
 * @author Abdul
 */

import type { Program } from './generated/ast.js';
import { generatePrettyPseudo2 } from './generator-pretty.js';
import { generateProgram } from './langenerator.js';
import { generateGraphvizAst } from './graphviz/generator-graphviz-ast.js';
import { generateGraphvizCfgArtifacts } from './graphviz/generator-graphviz-cfg.js';
import { generateGraphvizDep } from './graphviz/generator-graphviz-dep.js';

/**
 * Generiertes Textartefakt mit relativem Zieldateinamen.
 */
export type GeneratedArtifact = {
  /** Vorgeschlagener Dateiname einschließlich Erweiterung. */
  fileName: string;
  /** Vollständiger textueller Inhalt des Artefakts. */
  code: string;
};

/** Auswählbare Graphviz-Artefaktkategorien. */
export type GraphvizArtifactKind = 'ast' | 'dep' | 'cfg';

/**
 * Optionen für die selektive Graphviz-Erzeugung.
 */
export type GenerateGraphvizArtifactsOptions = {
  /**
   * Gewünschte Grapharten. Fehlt die Liste oder ist sie leer, werden alle
   * Graphviz-Artefakte erzeugt.
   */
  kinds?: GraphvizArtifactKind[];
};

/**
 * Optionen für die gemeinsame Erzeugung aller unterstützten Artefakte.
 */
export type GenerateAllArtifactsOptions = GenerateGraphvizArtifactsOptions & {
  /** Schaltet die standardmäßig aktivierte JavaScript-Ausgabe ab oder ein. */
  includeJavaScript?: boolean;
  /** Aktiviert zusätzlich die Pseudo2-Ausgabe mit expliziten Klammern. */
  includePrettyPseudo2?: boolean;
};

/**
 * Erzeugt die ausgewählten Graphviz-Artefakte eines Programms.
 *
 * AST und Dependency-Graph liefern jeweils eine Datei. Der CFG-Generator kann
 * mehrere Dateien liefern, da jede globale Funktion einen eigenen Graphen erhält.
 *
 * @param program Zu analysierendes Pseudo2-Programm.
 * @param options Optionale Auswahl der Grapharten.
 * @returns Erzeugte DOT-Artefakte in der Reihenfolge AST, Dependency, CFG.
 */
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

/**
 * Erzeugt JavaScript, optional Pretty-Pseudo2 und die gewünschten Graphviz-Dateien.
 *
 * @param program Zu verarbeitendes Pseudo2-Programm.
 * @param options Schalter für Text- und Graphartefakte.
 * @returns Alle erzeugten Artefakte mit ihren vorgeschlagenen Dateinamen.
 */
export function generateAllArtifacts(program: Program, options: GenerateAllArtifactsOptions = {}): GeneratedArtifact[] {
  const artifacts: GeneratedArtifact[] = [];

  if (options.includeJavaScript !== false) {
    artifacts.push({ fileName: 'generated_code.js', code: generateProgram(program) });
  }

  if (options.includePrettyPseudo2 === true) {
    artifacts.push({ fileName: 'pretty.pseudo2', code: generatePrettyPseudo2(program) });
  }

  artifacts.push(...generateGraphvizArtifacts(program, options));
  return artifacts;
}
