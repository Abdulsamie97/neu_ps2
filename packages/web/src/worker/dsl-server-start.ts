/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * @file dsl-server-start.ts
 * @brief Initialisiert den Pseudo2-Language-Server innerhalb eines Browser-Web-Workers.
 */

/// <reference lib="WebWorker" />

import { EmptyFileSystem } from 'langium';
import { startLanguageServer } from 'langium/lsp';
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from 'vscode-languageserver/browser.js';
import { createPseudo2Services } from 'pseudo2-language'; //TBC

/** @brief Aktiver LSP-Nachrichtenleser für den Worker-Port; vor dem Start ist er nicht gesetzt. */
export let messageReader: BrowserMessageReader | undefined;
/** @brief Aktiver LSP-Nachrichtenschreiber für den Worker-Port; vor dem Start ist er nicht gesetzt. */
export let messageWriter: BrowserMessageWriter | undefined;

/**
 * @brief Verbindet einen Worker-Port mit Langium und startet den Pseudo2-Language-Server.
 *
 * Aus dem Port werden BrowserMessageReader und BrowserMessageWriter aufgebaut.
 * Anschließend erzeugt die Funktion eine LSP-Verbindung, injiziert sie zusammen
 * mit dem leeren Browser-Dateisystem in die Pseudo2-Dienste und startet den
 * Langium-Server auf den gemeinsam genutzten Diensten.
 *
 * @param port Kommunikationsendpunkt des Workers oder der globale Dedicated-Worker-Kontext.
 * @param name Anzeigename für die Startmeldung in der Browserkonsole.
 */
export const start = (port: MessagePort | DedicatedWorkerGlobalScope, name: string) => {
    console.log(`Starting ${name}...`);
    /* browser specific setup code */
    messageReader = new BrowserMessageReader(port);
    messageWriter = new BrowserMessageWriter(port);

    messageReader.listen((message) => {
        // console.log('Received message from main thread:', message);
    });

    const connection = createConnection(messageReader, messageWriter);

    // Inject the shared services and language-specific services
    const { shared } = createPseudo2Services({ connection, ...EmptyFileSystem }); //TBC

    // Start the language server with the shared services
    startLanguageServer(shared);
};
