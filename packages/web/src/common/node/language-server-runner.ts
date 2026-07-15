/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * @file language-server-runner.ts
 * @brief Startet einen HTTP-/WebSocket-Host und verbindet Browserclients mit einem externen Language-Server-Prozess.
 */

import { WebSocketServer } from 'ws';
import { Server } from 'node:http';
import express from 'express';
import { getLocalDirectory, type LanguageServerRunConfig, upgradeWsServer } from './server-commons.js';

/**
 * LSP server runner
 *
 * @brief Initialisiert den vollständigen Node-Host für einen per WebSocket erreichbaren Sprachserver.
 *
 * Installiert zuerst eine Ausgabe für unbehandelte Prozessfehler, stellt anschließend
 * statische Webdateien aus dem Modulverzeichnis über Express bereit und öffnet den
 * konfigurierten HTTP-Port. Ein separater WebSocketServer übernimmt nur Upgrade-
 * Verbindungen; `upgradeWsServer` startet für passende Pfade den externen Sprachserver.
 *
 * @param languageServerRunConfig Prozess-, Port-, Pfad- und WebSocket-Konfiguration des Sprachservers.
 */
export const runLanguageServer = (
    languageServerRunConfig: LanguageServerRunConfig
) => {
    process.on('uncaughtException', err => {
        console.error('Uncaught Exception: ', err.toString());
        if (err.stack !== undefined) {
            console.error(err.stack);
        }
    });

    // create the express application
    const app = express();
    // server the static content, i.e. index.html
    const dir = getLocalDirectory(import.meta.url);
    app.use(express.static(dir));
    // start the http server
    const httpServer: Server = app.listen(languageServerRunConfig.serverPort);
    const wss = new WebSocketServer(languageServerRunConfig.wsServerOptions);
    // create the web socket
    upgradeWsServer(languageServerRunConfig, {
        server: httpServer,
        wss
    });
};
