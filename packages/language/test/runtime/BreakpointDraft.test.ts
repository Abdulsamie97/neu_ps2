/**
 * @file BreakpointDraft.test.ts
 * @brief Sichert lokale Haltepunkte gegen ungueltige Daten und verschobene Zeilen ab.
 * @author Abdul
 */

import { EmptyFileSystem } from 'langium';
import { expect, test } from 'vitest';
import { createPseudo2Services } from '../../src/index.js';
import { loadBreakpointDraft, rebaseTextareaBreakpoints, saveBreakpointDraft } from '../../src/browser/debug-breakpoints.js';

const parser = () => createPseudo2Services(EmptyFileSystem).Pseudo2.parser.LangiumParser;

/** Verwendet denselben Speichervertrag wie der Browser, ohne einen DOM zu benoetigen. */
function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
}

test('restores source and disabled conditions together without trusting stored ASTs', () => {
  const storage = createStorage();
  const key = 'runner';
  const source = 'var i = 2\nprint i\n';
  saveBreakpointDraft(key, source, [{ line: 2, enabled: false, condition: {
    source: 'i == 2', expression: { kind: 'literal', value: false }
  } }], storage);
  expect(storage.getItem(key)).not.toContain('expression');
  expect(loadBreakpointDraft(key, parser, storage)).toMatchObject({ source, breakpoints: [{ line: 2, enabled: false, condition: {
    source: 'i == 2', expression: { kind: 'binary', op: '==' }
  } }] });
  expect(loadBreakpointDraft('workbench', parser, storage)).toBeUndefined();
  saveBreakpointDraft(key, source, [], storage);
  expect(loadBreakpointDraft(key, parser, storage)).toBeUndefined();
});

test('does not restore invalid conditions as unconditional breakpoints', () => {
  const storage = createStorage();
  storage.setItem('runner', JSON.stringify({ version: 1, source: 'var i = 0\nprint i\nprint 7', breakpoints: [
    { line: 1, enabled: true, condition: 'i++ == 3' },
    { line: 2, enabled: false },
    { line: 90, enabled: true },
    { line: 3, enabled: 'true' }
  ] }));
  expect(loadBreakpointDraft('runner', parser, storage)?.breakpoints).toEqual([{ line: 2, enabled: false }]);
  storage.setItem('runner', '{broken');
  expect(loadBreakpointDraft('runner', parser, storage)).toBeUndefined();
});

test('keeps the editor usable without local storage access', () => {
  const unavailable = () => { throw new Error('denied'); };
  const storage = { getItem: unavailable, setItem: unavailable, removeItem: unavailable };
  expect(loadBreakpointDraft('runner', parser, storage)).toBeUndefined();
  expect(() => saveBreakpointDraft('runner', 'print 1', [{ line: 1, enabled: true }], storage)).not.toThrow();
});

test('rebases unchanged textarea lines and discards markers in replaced blocks', () => {
  const source = 'var i = 1\nprint i\nprint 2\nprint 3\n';
  const points = [{ line: 1, enabled: true }, { line: 2, enabled: false }, { line: 4, enabled: true }];
  expect(rebaseTextareaBreakpoints(source, `// insert\n${source}`, points).map(point => point.line)).toEqual([2, 3, 5]);
  expect(rebaseTextareaBreakpoints(source, source.replace('print i', 'print i + 1'), points)).toEqual(points);
  expect(rebaseTextareaBreakpoints(source, 'var i = 1\nprint 3\n', points)).toEqual([
    { line: 1, enabled: true }, { line: 2, enabled: true }
  ]);
});
