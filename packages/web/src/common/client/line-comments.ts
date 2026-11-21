/**
 * @file line-comments.ts
 * @brief Bindet das Pseudo2-Kommentar-Kuerzel an den gemeinsamen Monaco-Editor.
 * @author Abdul
 */

import * as monaco from '@codingame/monaco-vscode-editor-api';
import { getLineCommentEdits } from 'pseudo2-language';
import { isLineCommentShortcut } from 'pseudo2-language/browser/editor-shortcuts';

/** Verwendet eine gemeinsame Undo-Gruppe und laesst Monaco die Auswahl nachfuehren. */
export function installLineCommentShortcut(editor: monaco.editor.IStandaloneCodeEditor): void {
    editor.onKeyDown(event => {
        if (!isLineCommentShortcut(event.browserEvent)) return;
        const model = editor.getModel();
        const selections = editor.getSelections();
        if (model?.getLanguageId() !== 'pseudo2' || !selections || editor.getOption(monaco.editor.EditorOption.readOnly)) return;

        event.preventDefault();
        event.stopPropagation();
        if (event.browserEvent.repeat) return;
        const edits = getLineCommentEdits(selections.map(selection => ({
            start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
            end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 }
        })), line => model.getLineContent(line + 1));
        if (edits.length === 0) return;

        editor.pushUndoStop();
        editor.executeEdits('pseudo2.toggleLineComment', edits.map(({ range: { start, end }, newText }) => ({
            range: new monaco.Range(start.line + 1, start.character + 1, end.line + 1, end.character + 1),
            text: newText
        })));
        editor.pushUndoStop();
    });
}
