/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * @file dsl-server.ts
 * @brief Dient als schlanker Worker-Einstiegspunkt für den Pseudo2-Language-Server.
 */

/// <reference lib="WebWorker" />

import { start } from './dsl-server-start.js';

/** @brief Typisiert den globalen Worker-Kontext für die Übergabe an die gemeinsame Startfunktion. */
declare const self: DedicatedWorkerGlobalScope;

/** @brief Startet den Sprachserver unmittelbar beim Laden des Worker-Moduls. */
start(self, 'pseudo2-server');  //TBC  
