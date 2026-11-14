/**
 * @file build-web.mjs
 * @brief Begrenzt die Rolldown-Parallelitaet beim speicherintensiven Monaco-Bundle.
 * @author Abdul
 */

process.env.ROLLDOWN_WORKER_THREADS ??= '2';
process.env.RAYON_NUM_THREADS ??= '2';

const { build } = await import('vite');
await build();
