/**
 * @file build-web.mjs
 * @brief Begrenzt die esbuild-Parallelitaet beim speicherintensiven Monaco-Bundle.
 * @author Abdul
 */

process.env.GOMAXPROCS ??= '2';

const { build } = await import('vite');
await build();
