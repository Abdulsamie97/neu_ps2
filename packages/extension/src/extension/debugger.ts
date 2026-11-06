/**
 * @file debugger.ts
 * @brief Registriert den nativen Pseudo2-Debugger in der VS-Code-Extension.
 * @author Abdul
 */

import * as vscode from 'vscode';
import { Pseudo2DebugSession } from './debug-session.js';

const DEBUG_TYPE = 'pseudo2';

/**
 * Startet das aktuelle Pseudo2-Dokument ueber den VS-Code-Debugger.
 * Der Inline-Adapter liest den aktuellen Editorinhalt, auch wenn er noch nicht gespeichert wurde.
 */
export function registerPseudo2Debugger(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider(DEBUG_TYPE, {
        provideDebugConfigurations: () => [{
            type: DEBUG_TYPE,
            request: 'launch',
            name: 'Pseudo2 debuggen',
            program: '${file}'
        }],
        resolveDebugConfiguration: (_folder, config) => {
            if (!vscode.workspace.isTrusted) {
                void vscode.window.showWarningMessage('Pseudo2-Debugging ist nur in einem vertrauenswuerdigen Workspace moeglich.');
                return undefined;
            }
            if (!config.type) config.type = DEBUG_TYPE;
            if (!config.request) config.request = 'launch';
            if (!config.name) config.name = 'Pseudo2 debuggen';
            if (!config.program) {
                const document = vscode.window.activeTextEditor?.document;
                if (document?.languageId !== 'pseudo2' || document.uri.scheme !== 'file') {
                    void vscode.window.showWarningMessage('Bitte zuerst eine gespeicherte Pseudo2-Datei oeffnen.');
                    return undefined;
                }
                config.program = document.uri.fsPath;
            }
            return config;
        }
    }));

    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory(DEBUG_TYPE, {
        createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(
            new Pseudo2DebugSession(async programPath => {
                if (!vscode.workspace.isTrusted) throw new Error('Workspace nicht vertrauenswuerdig.');
                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(programPath));
                if (document.languageId !== 'pseudo2') throw new Error('Das Programm ist keine Pseudo2-Datei.');
                return document.getText();
            })
        )
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pseudo2.debug', async () => {
        const document = vscode.window.activeTextEditor?.document;
        if (document?.languageId !== 'pseudo2' || document.uri.scheme !== 'file') {
            void vscode.window.showWarningMessage('Bitte zuerst eine gespeicherte Pseudo2-Datei oeffnen.');
            return;
        }
        if (!vscode.workspace.isTrusted) {
            void vscode.window.showWarningMessage('Pseudo2-Debugging ist nur in einem vertrauenswuerdigen Workspace moeglich.');
            return;
        }
        await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(document.uri), {
            type: DEBUG_TYPE,
            request: 'launch',
            name: `Pseudo2: ${document.fileName}`,
            program: document.uri.fsPath
        });
    }));
}
