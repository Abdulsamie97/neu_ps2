/**
 * @file main.ts
 * @brief Aktiviert die Pseudo2-VS-Code-Erweiterung und verwaltet ihren Language Client.
 *
 * Der Einstiegspunkt startet den gebündelten Node-Language-Server über IPC,
 * registriert ihn für Pseudo2-Dokumente und beendet die Verbindung beim Deaktivieren
 * der Erweiterung kontrolliert.
 *
 * @author Abdul
 */

import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node.js';
import type * as vscode from 'vscode';
import * as path from 'node:path';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node.js';

/** Aktuell laufender Pseudo2-Language-Client der Erweiterungsinstanz. */
let client: LanguageClient;

// This function is called when the extension is activated.
/**
 * Aktiviert die Erweiterung und startet den Pseudo2-Language-Client.
 * @param context Von VS Code bereitgestellter Erweiterungskontext zur Pfadauflösung.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    client = await startLanguageClient(context);
}

// This function is called when the extension is deactivated.
/**
 * Beendet einen laufenden Language Client und damit auch seine Serververbindung.
 * @returns Stop-Promise des Clients oder `undefined`, wenn kein Client gestartet wurde.
 */
export function deactivate(): Thenable<void> | undefined {
    if (client) {
        return client.stop();
    }
    return undefined;
}

/**
 * Konfiguriert und startet den gebündelten Language Server als IPC-Kindprozess.
 * Im VS-Code-Debugmodus werden Node-Inspector-Optionen verwendet; `DEBUG_BREAK`
 * aktiviert das Warten auf den Debugger und `DEBUG_SOCKET` überschreibt Port 6009.
 * Der Client verarbeitet Dokumente mit der Sprachkennung `pseudo2` unabhängig vom URI-Schema.
 *
 * @param context Erweiterungskontext zur absoluten Auflösung des Servermoduls.
 * @returns Vollständig gestarteter Pseudo2-Language-Client.
 */
async function startLanguageClient(context: vscode.ExtensionContext): Promise<LanguageClient> {
    const serverModule = context.asAbsolutePath(path.join('out', 'language', 'main.cjs'));
    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging.
    // By setting `process.env.DEBUG_BREAK` to a truthy value, the language server will wait until a debugger is attached.
    const debugOptions = { execArgv: ['--nolazy', `--inspect${process.env.DEBUG_BREAK ? '-brk' : ''}=${process.env.DEBUG_SOCKET || '6009'}`] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: '*', language: 'pseudo2' }]
    };

    // Create the language client and start the client.
    const client = new LanguageClient(
        'pseudo2',
        'Pseudo2',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    await client.start();
    return client;
}
