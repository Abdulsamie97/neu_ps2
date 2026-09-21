/**
 * @file clean.mjs
 * @brief Entfernt das generierte Einzeldatei-Ausgabeverzeichnis plattformunabhaengig.
 * @author Abdul
 */

import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDirectory = dirname(fileURLToPath(import.meta.url));
await rm(join(workspaceDirectory, 'dist'), { recursive: true, force: true });
