/**
 * @file LineCommentEdits.test.ts
 * @brief Prueft die Zeilenauswahl und das Umschalten von Pseudo2-Kommentaren.
 * @author Abdul
 */

import { TextDocument } from 'langium';
import { describe, expect, test } from 'vitest';
import { isLineCommentShortcut } from '../../src/browser/editor-shortcuts.js';
import { getLineCommentEdits } from '../../src/pseudo2-line-comments.js';

/** Wendet die Editor-Edits auf ein Dokument mit denselben nullbasierten Positionen an. */
function toggle(source: string, selections: Parameters<typeof getLineCommentEdits>[0]): string {
  const document = TextDocument.create('memory:/comments.pseudo2', 'pseudo2', 0, source);
  const lines = source.split(/\r?\n/);
  return TextDocument.applyEdits(document, getLineCommentEdits(selections, line => lines[line]));
}

describe('Pseudo2 line comment shortcut', () => {
  test('toggles all touched lines but excludes the next line at column one', () => {
    const selections = [{ start: { line: 0, character: 4 }, end: { line: 3, character: 0 } }];
    const source = '  print 1\r\n\r\n\tprint 2\r\nprint 3';
    const commented = '  // print 1\r\n\r\n\t// print 2\r\nprint 3';
    expect(toggle(source, selections)).toBe(commented);
    expect(toggle(commented, selections)).toBe(source);
  });

  test('adds one layer over mixed code, comments and active annotations', () => {
    const selections = [{ start: { line: 0, character: 0 }, end: { line: 3, character: 1 } }];
    const source = 'print 1\n// keep this\n//@ assert true\n@ assert true';
    const commented = '// print 1\n// // keep this\n// //@ assert true\n// @ assert true';
    expect(toggle(source, selections)).toBe(commented);
    expect(toggle(commented, selections)).toBe(source);
    const cursor = { line: 0, character: 0 };
    expect(toggle('  //@ assert false', [{ start: cursor, end: cursor }])).toBe('  // //@ assert false');
  });

  test('uses the cursor line without a selection and deduplicates overlapping selections', () => {
    const first = { line: 0, character: 0 };
    const next = { line: 1, character: 2 };
    expect(toggle('//print 1\n  // print 2', [{ start: first, end: next }, { start: next, end: next }]))
      .toBe('print 1\n  print 2');
    expect(toggle(' \t\nprint 1', [{ start: first, end: first }])).toBe(' \t\nprint 1');
  });

  test('matches Ctrl/Cmd plus slash, including the German keyboard combination', () => {
    const slash = { altKey: false, code: 'Slash', ctrlKey: true, isComposing: false, key: '/', metaKey: false, shiftKey: false };
    expect(isLineCommentShortcut(slash)).toBe(true);
    expect(isLineCommentShortcut({ ...slash, ctrlKey: false, metaKey: true })).toBe(true);
    expect(isLineCommentShortcut({ ...slash, shiftKey: true, code: 'Digit7', key: '7' })).toBe(true);
    expect(isLineCommentShortcut({ ...slash, code: 'Digit7', key: '7' })).toBe(false);
    expect(isLineCommentShortcut({ ...slash, ctrlKey: false })).toBe(false);
    expect(isLineCommentShortcut({ ...slash, altKey: true })).toBe(false);
    expect(isLineCommentShortcut({ ...slash, isComposing: true })).toBe(false);
  });
});
