/**
 * @file DebugShortcuts.test.ts
 * @brief Prueft Tastenzuordnung, Freigaben und Fokusgrenzen der Browser-Debugger.
 * @author Abdul
 */

import { afterEach, expect, test, vi } from 'vitest';
import { installDebugShortcuts } from '../../src/browser/debug-shortcuts.js';

afterEach(() => vi.unstubAllGlobals());

function createKeyboard() {
  const buttons = new Map(['start', 'continue', 'step', 'over', 'out'].map(id => [`#debug-${id}`, {
    disabled: id !== 'start', title: '', click: vi.fn(), setAttribute: vi.fn()
  }]));
  const focus = { source: true, dialog: false };
  const reveal = vi.fn();
  class Input {
    closest() { return this; }
  }
  const document = Object.assign(new EventTarget(), {
    querySelector: (selector: string) => selector === 'dialog[open]' ? focus.dialog : buttons.get(selector)
  });
  vi.stubGlobal('document', document);
  vi.stubGlobal('Element', Input);
  installDebugShortcuts(() => focus.source, reveal);

  function press(code: string, extras: KeyboardEventInit = {}, target?: Input) {
    const event = Object.assign(new Event('keydown', { cancelable: true }), {
      code, key: code, altKey: true, shiftKey: true,
      getModifierState: () => !!extras.modifierAltGraph,
      ...extras
    });
    if (target) Object.defineProperty(event, 'target', { value: target });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  }
  return { button: (id: string) => buttons.get(`#debug-${id}`)!, focus, reveal, press, input: new Input() };
}

test('starts or continues using the enabled button and never repeats a command', () => {
  const { button, press, reveal } = createKeyboard();
  expect(button('start').setAttribute).toHaveBeenCalledWith('aria-keyshortcuts', 'Alt+Shift+Enter');
  expect(press('Enter')).toBe(true);
  expect(button('start').click).toHaveBeenCalledTimes(1);
  expect(reveal).toHaveBeenCalledTimes(1);

  button('start').disabled = true;
  expect(press('Enter')).toBe(false);
  button('continue').disabled = false;
  expect(press('Enter', { repeat: true })).toBe(true);
  expect(button('continue').click).not.toHaveBeenCalled();
  expect(press('Enter')).toBe(true);
  expect(button('continue').click).toHaveBeenCalledTimes(1);
  expect(button('start').click).toHaveBeenCalledTimes(1);
});

test.each([['1', '!', 'step'], ['2', '"', 'over'], ['3', '#', 'out']])(
  'runs step shortcut %s only when the command is enabled', (key, shiftedKey, id) => {
    const { button, press } = createKeyboard();
    expect(press(`Digit${key}`, { key: shiftedKey })).toBe(false);
    button(id).disabled = false;
    expect(press(`Digit${key}`, { key: shiftedKey })).toBe(true);
    expect(button(id).click).toHaveBeenCalledTimes(1);
    expect(button(id).title).toContain(`Alt+Umschalt+${key}`);
  }
);

test('leaves modal dialogs, other text inputs, IME and unrelated shortcuts alone', () => {
  const { button, focus, input, press } = createKeyboard();
  focus.dialog = true;
  expect(press('Enter', {}, input)).toBe(false);
  focus.dialog = false;
  focus.source = false;
  expect(press('Enter', {}, input)).toBe(false);
  focus.source = true;
  expect(press('Enter', { isComposing: true }, input)).toBe(false);
  expect(press('Enter', { modifierAltGraph: true }, input)).toBe(false);
  expect(press('Enter', { altKey: false, shiftKey: false, ctrlKey: true }, input)).toBe(false);
  expect(press('F5', { altKey: false, shiftKey: false }, input)).toBe(false);
  expect(button('start').click).not.toHaveBeenCalled();
  expect(press('Enter', {}, input)).toBe(true);
  expect(button('start').click).toHaveBeenCalledTimes(1);
});
