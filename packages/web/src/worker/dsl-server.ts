/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/// <reference lib="WebWorker" />

import { start } from './dsl-server-start.js';

declare const self: DedicatedWorkerGlobalScope;

start(self, 'pseudo2-server');  //TBC  
