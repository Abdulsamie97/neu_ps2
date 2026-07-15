/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * @file node.ts
 * @brief Exportiert ausschließlich die serverseitigen Node-Hilfen des Webpakets.
 */

/* server side export only */
/** @brief Exportiert WebSocket-Brücke, Prozessstart und Pfadhilfen für Node-Anwendungen. */
export * from './common/node/server-commons.js';
/** @brief Exportiert den vollständigen Express-/WebSocket-Sprachserver-Runner. */
export * from './common/node/language-server-runner.js';
