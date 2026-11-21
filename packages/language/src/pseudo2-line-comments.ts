/**
 * @file pseudo2-line-comments.ts
 * @brief Berechnet gemeinsame Zeilenkommentar-Edits fuer die Pseudo2-Editoren.
 * @author Abdul
 */

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type TextEdit = { range: Range; newText: string };

/**
 * Kommentiert die ausgewaehlten nichtleeren Zeilen oder entfernt eine Kommentar-Ebene.
 * Eine Auswahl bis zum Anfang der naechsten Zeile schliesst diese nicht ein.
 * @param selections Sortierte Start-/Endpositionen je Auswahl, jeweils nullbasiert.
 * @param lineText Liefert den unveraenderten Text einer Zeile ohne Zeilenende.
 * @returns Aufsteigend sortierte, zeilenlokale Edits in der urspruenglichen Quelle.
 */
export function getLineCommentEdits(selections: readonly Range[], lineText: (line: number) => string): TextEdit[] {
  const lineNumbers = new Set<number>();
  for (const { start, end } of selections) {
    const lastLine = end.line > start.line && end.character === 0 ? end.line - 1 : end.line;
    for (let line = start.line; line <= lastLine; line++) lineNumbers.add(line);
  }

  const lines = [...lineNumbers].sort((a, b) => a - b).flatMap(line => {
    const text = lineText(line);
    const character = text.search(/[^ \t]/);
    if (character < 0) return [];
    // `//@` ist eine aktive Annotation und kein entfernbarer Kommentar-Praefix.
    const commentLength = /^\/\/(?!@) ?/.exec(text.slice(character))?.[0].length ?? 0;
    return [{ line, character, commentLength }];
  });

  const remove = lines.every(({ commentLength }) => commentLength > 0);
  return lines.map(({ line, character, commentLength }) => ({
    range: {
      start: { line, character },
      end: { line, character: character + (remove ? commentLength : 0) }
    },
    newText: remove ? '' : '// '
  }));
}
