/**
 * @file observed-worker.ts
 * @brief Erstellt den gemeinsamen Node-Worker fuer Ausfuehrung und Debugging.
 * @author Abdul
 */

import { Worker } from 'node:worker_threads';
import { OBSERVED_WORKER_SCRIPT } from 'pseudo2-language';

const WORKER_BOOTSTRAP = `const { parentPort } = require('node:worker_threads');\n`
    + `const self = { postMessage: message => parentPort.postMessage(message) };\n`
    + OBSERVED_WORKER_SCRIPT
    + `\nparentPort.on('message', data => self.onmessage({ data }));`;

/**
 * Verbindet das browserkompatible Beobachtungsskript mit Node-Worker-Nachrichten.
 * Das Speicherlimit begrenzt sowohl normale Laeufe als auch Debug-Sitzungen.
 * @returns Einen gestarteten, noch nicht mit Quellcode versorgten Worker.
 */
export function createObservedWorker(): Worker {
    return new Worker(WORKER_BOOTSTRAP, {
        eval: true,
        resourceLimits: { maxOldGenerationSizeMb: 128 }
    });
}
