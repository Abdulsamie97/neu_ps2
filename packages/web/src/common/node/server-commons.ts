/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * @file server-commons.ts
 * @brief Verbindet WebSocket-Clients bidirektional mit extern gestarteten Language-Server-Prozessen.
 */
import { WebSocketServer, type ServerOptions } from 'ws';
import { IncomingMessage, Server } from 'node:http';
import { URL } from 'node:url';
import { Socket } from 'node:net';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cp from 'node:child_process';
import { type IWebSocket, WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc';
import { createConnection, createServerProcess, forward } from 'vscode-ws-jsonrpc/server';
import { Message, InitializeRequest, type InitializeParams, type RequestMessage, type ResponseMessage } from 'vscode-languageserver-protocol';

/** @brief Konfiguriert HTTP-Endpunkt, Language-Server-Prozess und optionale LSP-Nachrichtenfilter. */
export interface LanguageServerRunConfig {
    /** @brief Lesbarer Name für Prozess- und Protokollausgaben. */
    serverName: string;
    /** @brief URL-Pfad, auf dem WebSocket-Upgrades angenommen werden. */
    pathName: string;
    /** @brief TCP-Port des übergeordneten HTTP-Servers. */
    serverPort: number;
    /** @brief Auszuführender Language-Server-Befehl oder absoluter Programmpfad. */
    runCommand: string;
    /** @brief Argumente, die unverändert an den Language-Server-Prozess übergeben werden. */
    runCommandArgs: string[];
    /** @brief Optionen des WebSocketServers, beispielsweise Port- oder `noServer`-Konfiguration. */
    wsServerOptions: ServerOptions,
    /** @brief Optionale Node-Spawn-Einstellungen für den Language-Server-Prozess. */
    spawnOptions?: cp.SpawnOptions;
    /** @brief Aktiviert die Ausgabe weitergeleiteter LSP-Anfragen und -Antworten. */
    logMessages?: boolean;
    /** @brief Kann ausgehende Clientanfragen vor der Weiterleitung verändern. */
    requestMessageHandler?: (message: RequestMessage) => RequestMessage;
    /** @brief Kann eingehende Serverantworten vor der Weiterleitung verändern. */
    responseMessageHandler?: (message: ResponseMessage) => ResponseMessage;
}

/**
 * start the language server inside the current process
 *
 * @brief Startet einen externen Language Server und koppelt ihn an eine bestehende WebSocket-Verbindung.
 *
 * Für den Browser-Socket werden JSON-RPC-Reader und -Writer angelegt. Der externe
 * Prozess erhält eine zweite JSON-RPC-Verbindung; `forward` überträgt Nachrichten
 * in beide Richtungen. Bei der LSP-Initialisierung wird die Node-Prozess-ID gesetzt.
 * Optionale Handler dürfen Requests beziehungsweise Responses vor der Weitergabe
 * ersetzen, und die Socket-Verbindung wird beim Dispose ordnungsgemäß geschlossen.
 *
 * @param runconfig Prozessdaten, Logging und optionale Nachrichtenhandler.
 * @param socket Bereits akzeptierter WebSocket in der JSON-RPC-Abstraktion.
 */
export const launchLanguageServer = (runconfig: LanguageServerRunConfig, socket: IWebSocket) => {
    const { serverName, runCommand, runCommandArgs, spawnOptions } = runconfig;
    // start the language server as an external process
    const reader = new WebSocketMessageReader(socket);
    const writer = new WebSocketMessageWriter(socket);
    const socketConnection = createConnection(reader, writer, () => socket.dispose());
    const serverConnection = createServerProcess(serverName, runCommand, runCommandArgs, spawnOptions);
    if (serverConnection !== undefined) {
        forward(socketConnection, serverConnection, message => {
            if (Message.isRequest(message)) {
                if (message.method === InitializeRequest.type.method) {
                    const initializeParams = message.params as InitializeParams;
                    initializeParams.processId = process.pid;
                }

                if (runconfig.logMessages ?? false) {
                    console.log(`${serverName} Server received: ${message.method}`);
                    console.log(message);
                }
                if (runconfig.requestMessageHandler !== undefined) {
                    return runconfig.requestMessageHandler(message);
                }
            }
            if (Message.isResponse(message)) {
                if (runconfig.logMessages ?? false) {
                    console.log(`${serverName} Server sent:`);
                    console.log(message);
                }
                if (runconfig.responseMessageHandler !== undefined) {
                    return runconfig.responseMessageHandler(message);
                }
            }
            return message;
        });
    }
};

/**
 * @brief Verarbeitet HTTP-Upgrades für den konfigurierten Sprachserverpfad.
 *
 * Die Funktion ignoriert Upgrades anderer URL-Pfade. Für einen passenden Pfad
 * übernimmt der WebSocketServer den vorhandenen TCP-Socket. Danach wird der native
 * WebSocket in `IWebSocket` adaptiert und der Language Server sofort oder nach dem
 * `open`-Ereignis gestartet.
 *
 * @param runconfig Erwarteter WebSocket-Pfad und Language-Server-Prozesskonfiguration.
 * @param config Bereits laufender HTTP-Server und WebSocketServer für das Upgrade.
 */
export const upgradeWsServer = (runconfig: LanguageServerRunConfig,
    config: {
        /** @brief HTTP-Server, dessen `upgrade`-Ereignisse ausgewertet werden. */
        server: Server,
        /** @brief WebSocketServer, der passende TCP-Verbindungen übernimmt. */
        wss: WebSocketServer
    }) => {
    config.server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
        const baseURL = `http://${request.headers.host}/`;
        const pathName = request.url !== undefined ? new URL(request.url, baseURL).pathname : undefined;
        if (pathName === runconfig.pathName) {
            config.wss.handleUpgrade(request, socket, head, webSocket => {
                const socket: IWebSocket = {
                    send: content => webSocket.send(content, error => {
                        if (error) {
                            throw error;
                        }
                    }),
                    onMessage: cb => webSocket.on('message', (data) => {
                        cb(data);
                    }),
                    onError: cb => webSocket.on('error', cb),
                    onClose: cb => webSocket.on('close', cb),
                    dispose: () => webSocket.close()
                };
                // launch the server when the web socket is opened
                if (webSocket.readyState === webSocket.OPEN) {
                    launchLanguageServer(runconfig, socket);
                } else {
                    webSocket.on('open', () => {
                        launchLanguageServer(runconfig, socket);
                    });
                }
            });
        }
    });
};

/**
 * Solves: __dirname is not defined in ES module scope
 *
 * @brief Ermittelt das lokale Verzeichnis eines ES-Moduls ohne CommonJS-`__dirname`.
 * @param referenceUrl Modul-URL, üblicherweise `import.meta.url`.
 * @return Dateisystemverzeichnis der referenzierten Moduldatei.
 */
export const getLocalDirectory = (referenceUrl: string | URL) => {
    const __filename = fileURLToPath(referenceUrl);
    return dirname(__filename);
};
