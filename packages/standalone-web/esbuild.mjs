/**
 * @file esbuild.mjs
 * @brief Erstellt den vollstaendig eingebetteten Pseudo2-JavaScript-Runner.
 * @author Abdul
 */

import * as esbuild from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(workspaceDirectory, 'src');
const outputDirectory = join(workspaceDirectory, 'dist');
const outputFile = join(outputDirectory, 'pseudo2-js-runner.html');

/**
 * Maskiert eine schliessende HTML-Tagfolge innerhalb eingebetteten Inhalts.
 * Dadurch kann weder JavaScript noch CSS den umgebenden Tag vorzeitig beenden.
 *
 * @param {string} content Einzubettender JavaScript- oder CSS-Inhalt.
 * @param {string} tagName Name des umgebenden HTML-Tags.
 * @returns {string} Fuer die Einbettung abgesicherter Inhalt.
 */
function escapeClosingTag(content, tagName) {
  return content.replace(new RegExp(`</${tagName}`, 'gi'), `<\\/${tagName}`);
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const buildResult = await esbuild.build({
  entryPoints: [join(sourceDirectory, 'main.ts')],
  outfile: join(outputDirectory, 'embedded-bundle.js'),
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: ['es2022'],
  charset: 'utf8',
  minify: true,
  treeShaking: true,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});

const javaScript = buildResult.outputFiles.find(file => file.path.endsWith('.js'))?.text;
if (!javaScript) {
  throw new Error('esbuild did not produce a JavaScript bundle.');
}

const [template, styles] = await Promise.all([
  readFile(join(sourceDirectory, 'template.html'), 'utf8'),
  readFile(join(sourceDirectory, 'style.css'), 'utf8')
]);

const stylePlaceholder = '/*__PSEUDO2_STYLES__*/';
const scriptPlaceholder = '/*__PSEUDO2_SCRIPT__*/';
if (!template.includes(stylePlaceholder) || !template.includes(scriptPlaceholder)) {
  throw new Error('Standalone HTML template is missing an embedding placeholder.');
}

const html = template
  .replace(stylePlaceholder, () => escapeClosingTag(styles, 'style'))
  .replace(scriptPlaceholder, () => escapeClosingTag(javaScript, 'script'));

if (html.includes(stylePlaceholder) || html.includes(scriptPlaceholder)) {
  const remaining = [stylePlaceholder, scriptPlaceholder].filter(placeholder => html.includes(placeholder));
  throw new Error(`Standalone HTML template placeholders were not replaced: ${remaining.join(', ')}`);
}

await writeFile(outputFile, html, 'utf8');

const sizeInKiB = Math.round(Buffer.byteLength(html) / 1024);
console.log(`Standalone runner: ${outputFile} (${sizeInKiB} KiB)`);
