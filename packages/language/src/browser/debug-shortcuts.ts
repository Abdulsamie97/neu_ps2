/**
 * @file debug-shortcuts.ts
 * @brief Gemeinsame Tastatursteuerung fuer die Browser-Debugger.
 * @author Abdul
 */

const shortcuts = [
  { code: 'Enter', key: 'Enter', buttons: ['debug-continue', 'debug-start'] },
  { code: 'Digit1', key: '1', buttons: ['debug-step'] },
  { code: 'Digit2', key: '2', buttons: ['debug-over'] },
  { code: 'Digit3', key: '3', buttons: ['debug-out'] }
] as const;

/**
 * @brief Verwendet dieselben Schaltflaechen und Freigaben wie bei einem Mausklick.
 * @param isSourceFocused Erkennt den Quelltexteditor, nicht dessen Suche oder andere Eingabefelder.
 * @param revealDebugger Zeigt den Debug-Bereich an, ohne den Tastaturfokus zu verschieben.
 */
export function installDebugShortcuts(isSourceFocused: () => boolean, revealDebugger: () => void): void {
  const bindings = shortcuts.map(({ code, key, buttons }) => ({
    code, key,
    buttons: buttons.flatMap(id => {
      const button = document.querySelector<HTMLButtonElement>(`#${id}`);
      if (!button) return [];
      button.setAttribute('aria-keyshortcuts', `Alt+Shift+${key}`);
      const hint = `Alt+Umschalt+${key}`;
      button.title = button.title ? `${button.title} (${hint})` : hint;
      return [button];
    })
  }));

  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || !event.altKey || !event.shiftKey
        || event.ctrlKey || event.metaKey || event.getModifierState('AltGraph')) return;

    const button = bindings.find(binding => binding.code === event.code || binding.key === event.key)
      ?.buttons.find(candidate => !candidate.disabled);
    if (!button || document.querySelector('dialog[open]')) return;
    if (event.target instanceof Element && event.target.closest('form, input, textarea, select, [contenteditable]')
        && !isSourceFocused()) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    revealDebugger();
    button.click();
  }, { capture: true });
}
