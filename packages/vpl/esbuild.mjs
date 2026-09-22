/**
 * @file esbuild.mjs
 * @brief Buendelt den Pseudo2-VPL-Runner und kopiert die Moodle-VPL-Dateien.
 * @author Abdul
 */

import * as esbuild from 'esbuild';
import { chmod, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(workspaceDirectory, 'dist');
const outputFile = join(outputDirectory, 'pseudo2-vpl.mjs');
const copiedFiles = [
  'vpl_run.sh',
  'vpl_evaluate.sh',
  'assignment.example.json',
  'README.md'
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await esbuild.build({
  entryPoints: [join(workspaceDirectory, 'src', 'main.ts')],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node20.10'],
  charset: 'utf8',
  minify: true,
  treeShaking: true,
  legalComments: 'none',
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __pseudo2CreateRequire } from "node:module";',
      'const require = __pseudo2CreateRequire(import.meta.url);'
    ].join('\n')
  }
});

for (const fileName of copiedFiles) {
  await copyFile(join(workspaceDirectory, fileName), join(outputDirectory, fileName));
}

await chmod(outputFile, 0o755);
await chmod(join(outputDirectory, 'vpl_run.sh'), 0o755);
await chmod(join(outputDirectory, 'vpl_evaluate.sh'), 0o755);

const bundleSize = Math.round((await stat(outputFile)).size / 1024);
console.log(`Pseudo2 VPL bundle: ${outputFile} (${bundleSize} KiB)`);
