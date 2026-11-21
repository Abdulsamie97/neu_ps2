/**
 * @file EditorShortcuts.test.ts
 * @brief Prueft die Belegungen und Prioritaeten des Einzeldatei-Editors.
 * @author Abdul
 */

import { expect, test, vi } from 'vitest';
import { installTextareaEditorShortcuts, RUN_EDITOR_SHORTCUT } from '../../src/browser/editor-shortcuts.js';

function createEditor(completionsOpen = false) {
  const target = new EventTarget();
  const actions = {
    toggleLineComments: vi.fn(), showCompletions: vi.fn(), nextCompletion: vi.fn(), previousCompletion: vi.fn(),
    acceptCompletion: vi.fn(), dismissCompletions: vi.fn(), indent: vi.fn(), run: vi.fn()
  };
  installTextareaEditorShortcuts(target as HTMLTextAreaElement, () => completionsOpen, actions);
  const press = (key: string, options: KeyboardEventInit = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key, ...options });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { actions, press };
}

test('runs, indents or toggles line comments without consuming ordinary text entry', () => {
  const { actions, press } = createEditor();
  expect(RUN_EDITOR_SHORTCUT.aria).toBe('Control+Enter Meta+Enter');
  expect(press('Enter', { ctrlKey: true })).toBe(true);
  expect(press('Enter', { metaKey: true })).toBe(true);
  expect(actions.run).toHaveBeenCalledTimes(2);
  expect(press('Enter')).toBe(false);
  expect(press('ArrowDown')).toBe(false);
  expect(press('x')).toBe(false);
  expect(press('Tab')).toBe(true);
  expect(actions.indent).toHaveBeenCalledOnce();
  expect(press('/', { ctrlKey: true })).toBe(true);
  expect(press('/', { ctrlKey: true, repeat: true })).toBe(true);
  expect(actions.toggleLineComments).toHaveBeenCalledOnce();
});

test('opens, navigates, accepts and dismisses suggestions without overriding run', () => {
  const { actions, press } = createEditor(true);
  expect(press(' ', { code: 'Space', ctrlKey: true })).toBe(true);
  expect(press(' ', { code: 'Space', metaKey: true })).toBe(true);
  expect(actions.showCompletions).toHaveBeenCalledTimes(2);
  expect(press('ArrowDown')).toBe(true);
  expect(press('ArrowUp')).toBe(true);
  expect(press('Escape')).toBe(true);
  expect(actions.nextCompletion).toHaveBeenCalledOnce();
  expect(actions.previousCompletion).toHaveBeenCalledOnce();
  expect(actions.dismissCompletions).toHaveBeenCalledOnce();
  expect(press('Tab')).toBe(true);
  expect(press('Enter')).toBe(true);
  expect(actions.indent).not.toHaveBeenCalled();
  expect(actions.acceptCompletion).toHaveBeenCalledTimes(2);
  expect(press('Enter', { ctrlKey: true })).toBe(true);
  expect(actions.run).toHaveBeenCalledOnce();
  expect(actions.acceptCompletion).toHaveBeenCalledTimes(2);
});
