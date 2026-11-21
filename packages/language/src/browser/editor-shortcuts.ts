/**
 * @file editor-shortcuts.ts
 * @brief Eigene Tastaturbelegungen der Browser-Editoren ausserhalb des Debuggers.
 * @author Abdul
 */

type EditorKey = Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'shiftKey'>;
type TextareaAction = 'toggleLineComments' | 'showCompletions' | 'nextCompletion' | 'previousCompletion'
  | 'acceptCompletion' | 'dismissCompletions' | 'indent' | 'run';

const runKey = 'Enter';
export const RUN_EDITOR_SHORTCUT = {
  hint: `Strg/Cmd+${runKey}`,
  aria: `Control+${runKey} Meta+${runKey}`
};

/** Erkennt Strg/Cmd + Slash, auch wenn Slash ueber Umschalt+7 eingegeben wird. */
export function isLineCommentShortcut(event: EditorKey): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.isComposing
    && (event.key === '/' || (event.shiftKey && event.code === 'Digit7'));
}

/** Laesst eine offene Vorschlagsliste Tab und Enter vor der Texteingabe behandeln. */
function findTextareaAction(event: EditorKey, completionsOpen: boolean): TextareaAction | undefined {
  const command = event.ctrlKey || event.metaKey;
  if (isLineCommentShortcut(event)) return 'toggleLineComments';
  if (command && event.code === 'Space') return 'showCompletions';
  if (completionsOpen) {
    if (event.key === 'ArrowDown') return 'nextCompletion';
    if (event.key === 'ArrowUp') return 'previousCompletion';
    if (event.key === 'Tab' || (event.key === 'Enter' && !command)) return 'acceptCompletion';
    if (event.key === 'Escape') return 'dismissCompletions';
  }
  if (event.key === 'Tab') return 'indent';
  if (event.key === runKey && command) return 'run';
  return undefined;
}

/**
 * @brief Bindet die Tastatur der Textarea an die Aktionen des Einzeldatei-Editors.
 * @param editor Empfaengt die Tastendruecke aus dem Quelltext.
 * @param completionsOpen Liefert den aktuellen Sichtbarkeitszustand der Vorschlagsliste.
 * @param actions Fuehrt die gewaehlte Aktion aus, ohne die Tastenbelegung zu kennen.
 */
export function installTextareaEditorShortcuts(
  editor: HTMLTextAreaElement,
  completionsOpen: () => boolean,
  actions: Record<TextareaAction, () => void>
): void {
  editor.addEventListener('keydown', event => {
    const action = findTextareaAction(event, completionsOpen());
    if (!action) return;
    event.preventDefault();
    if (action !== 'toggleLineComments' || !event.repeat) actions[action]();
  });
}
