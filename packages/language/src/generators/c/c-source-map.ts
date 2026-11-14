/**
 * @file c-source-map.ts
 * @brief Verwaltet die Quellzeilenabbildung beider C-Generatoren.
 * @author Abdul
 */

import type { AstNode } from 'langium';

/** Ordnet eine Zeile des bereinigten C-Codes ihrer Pseudo2-Ausgangszeile zu. */
export type CSourceMapEntry = {
  /** Einsbasierte Zeilennummer im erzeugten C-Code. */
  generatedLine: number;
  /** Einsbasierte Zeilennummer im Pseudo2-Dokument. */
  sourceLine: number;
};

/** Ergebnis der C-Erzeugung einschließlich Quellabbildung. */
export type GeneratedCProgram = {
  /** Vollständiger C-Code ohne interne Source-Map-Marker. */
  code: string;
  /** Zuordnungen aller markierten C-Zeilen zu Pseudo2-Zeilen. */
  sourceMap: CSourceMapEntry[];
};

const RANGE_START_MARKER = /^\/\*@@pseudo2-source-line:(\d+)\*\/$/;
const RANGE_END_MARKER = '/*@@pseudo2-source-line:end*/';

/**
 * Entfernt Bereichsmarker des Runtime-C-Generators und ordnet jede C-Zeile
 * der innersten aktiven Pseudo2-Quellzeile zu.
 * @param markedCode C-Code mit verschachtelbaren Bereichsmarkern.
 * @returns Markerfreier Code und Zeilenabbildung.
 */
export function stripSourceMapMarkers(markedCode: string): GeneratedCProgram {
  const codeLines: string[] = [];
  const sourceMap: CSourceMapEntry[] = [];
  const sourceLineStack: number[] = [];

  for (const line of markedCode.split(/\r?\n/)) {
    const marker = line.match(RANGE_START_MARKER);
    if (marker) {
      sourceLineStack.push(Number(marker[1]));
      continue;
    }
    if (line === RANGE_END_MARKER) {
      sourceLineStack.pop();
      continue;
    }

    codeLines.push(line);

    const currentSourceLine = sourceLineStack[sourceLineStack.length - 1];
    if (currentSourceLine !== undefined) {
      sourceMap.push({ generatedLine: codeLines.length, sourceLine: currentSourceLine });
    }
  }

  return { code: codeLines.join('\n'), sourceMap };
}

/**
 * Umschließt C-Code mit einem Bereichsmarker, wenn die Quellabbildung aktiv ist.
 * @param node Pseudo2-Knoten, dessen Quellzeile markiert wird.
 * @param code Zu markierender C-Abschnitt.
 * @param state Generatorzustand mit Source-Map-Schalter.
 * @returns Unveränderter oder markierter Code.
 */
export function sourceMapped(node: AstNode, code: string, state: { sourceMap: boolean }): string {
  const sourceLine = sourceLineFor(node);
  if (!state.sourceMap || sourceLine === undefined || code.length === 0) {
    return code;
  }

  return `/*@@pseudo2-source-line:${sourceLine}*/\n${code}\n${RANGE_END_MARKER}`;
}

/** Markiert einen Direct-C-Abschnitt inline mit seiner Pseudo2-Quellzeile. */
export function markInlineSource(node: AstNode | undefined, code: string): string {
  const sourceLine = sourceLineFor(node);
  return !code || sourceLine === undefined ? code : `/*__ps2_line_${sourceLine}__*/${code}`;
}

/**
 * Entfernt Inline-Marker des Direct-C-Generators und übernimmt für Folgezeilen
 * die zuletzt bekannte Pseudo2-Quellzeile.
 * @param markedCode C-Code mit Inline-Quellmarken.
 * @returns Markerfreier Code und Zeilenabbildung.
 */
export function stripInlineSourceMapMarkers(markedCode: string): GeneratedCProgram {
  const sourceMap: CSourceMapEntry[] = [];
  let sourceLine: number | undefined;
  const code = markedCode.split('\n').map((line, index) => {
    const matches = [...line.matchAll(/\/\*__ps2_line_(\d+)__\*\//g)];
    if (matches.length) sourceLine = Number(matches[matches.length - 1][1]);
    if (sourceLine !== undefined) sourceMap.push({ generatedLine: index + 1, sourceLine });
    return line.replace(/\/\*__ps2_line_\d+__\*\//g, '');
  }).join('\n');
  return { code, sourceMap };
}

/** @returns Einsbasierte Quellzeile eines AST-Knotens oder `undefined`. */
function sourceLineFor(node: AstNode | undefined): number | undefined {
  const line = node?.$cstNode?.range.start.line;
  return line === undefined ? undefined : line + 1;
}
