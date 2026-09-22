/**
 * @file clean.mjs
 * @brief Entfernt die erzeugten VPL-Artefakte.
 * @author Abdul
 */

import { rm } from 'node:fs/promises';

await rm(new URL('./dist', import.meta.url), { recursive: true, force: true });
