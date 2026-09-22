/**
 * @file smoke.mjs
 * @brief Prueft das gebaute VPL-Bundle als echten externen Node-Prozess.
 * @author Abdul
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const distributionDirectory = join(packageDirectory, 'dist');
const bundlePath = join(distributionDirectory, 'pseudo2-vpl.mjs');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pseudo2-vpl-test-'));

/** Startet das Bundle und sammelt seine vollstaendige Ausgabe. */
function runBundle(arguments_, environment = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [bundlePath, ...arguments_], {
      cwd: temporaryDirectory,
      env: { ...process.env, ...environment },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Bundle process did not finish: ${arguments_.join(' ')}`));
    }, 15_000);
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timeout);
      resolveResult({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
  });
}

/** Schreibt eine JSON-Aufgabenkonfiguration in das temporaere Testverzeichnis. */
async function writeManifest(fileName, value) {
  const filePath = join(temporaryDirectory, fileName);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

try {
  const bundle = await readFile(bundlePath, 'utf8');
  assert.match(bundle, /^#!\/usr\/bin\/env node/);
  assert.ok(bundle.length > 100_000, 'bundle should contain the language implementation');
  assert.doesNotMatch(bundle, /from\s+["']pseudo2-language["']/);
  await readFile(join(distributionDirectory, 'vpl_run.sh'), 'utf8');
  await readFile(join(distributionDirectory, 'vpl_evaluate.sh'), 'utf8');
  await readFile(join(distributionDirectory, 'assignment.example.json'), 'utf8');

  const validSourcePath = join(temporaryDirectory, 'main.pseudo2');
  await writeFile(validSourcePath, `func square(value)
    return value * value

print square(5)
`, 'utf8');

  const validateResult = await runBundle(['validate', validSourcePath]);
  assert.equal(validateResult.code, 0, validateResult.stderr);
  assert.match(validateResult.stdout, /Pseudo2 validation OK: main\.pseudo2/);

  const runResult = await runBundle(['run', validSourcePath]);
  assert.equal(runResult.code, 0, runResult.stderr);
  assert.equal(runResult.stdout.trim(), '25');

  const invalidSourcePath = join(temporaryDirectory, 'invalid.pseudo2');
  await writeFile(invalidSourcePath, 'print unknownValue\n', 'utf8');
  const invalidResult = await runBundle(['validate', invalidSourcePath]);
  assert.equal(invalidResult.code, 2);
  assert.match(invalidResult.stderr, /invalid\.pseudo2:1:\d+: Fehler:/);
  assert.match(invalidResult.stderr, /Could not resolve reference|resolve reference/i);

  const functionSourcePath = join(temporaryDirectory, 'function.pseudo2');
  await writeFile(functionSourcePath, `func square(value)
    return value * value
`, 'utf8');
  const passingManifestPath = await writeManifest('passing.json', {
    version: 1,
    title: 'Quadratfunktion',
    mode: 'function',
    maxGrade: 10,
    defaultTimeoutMs: 1000,
    tests: [
      {
        name: 'square(5)',
        harness: 'print square(5)',
        expectedOutput: '25',
        points: 4
      },
      {
        name: 'Versteckter Negativtest',
        harness: 'print square(-3)',
        expectedOutput: '9',
        points: 6,
        hidden: true
      }
    ]
  });
  const passingEvaluation = await runBundle(['evaluate', functionSourcePath, passingManifestPath]);
  assert.equal(passingEvaluation.code, 0, passingEvaluation.stderr);
  assert.match(passingEvaluation.stdout, /2\/2 Tests bestanden/);
  assert.match(passingEvaluation.stdout, /Grade :=>>10/);

  const partialManifestPath = await writeManifest('partial.json', {
    version: 1,
    title: 'Teilbewertung',
    mode: 'function',
    maxGrade: 10,
    tests: [
      {
        name: 'Oeffentlicher Test',
        harness: 'print square(5)',
        expectedOutput: '25',
        points: 4
      },
      {
        name: 'Versteckter Test',
        harness: 'print square(-3)',
        expectedOutput: '123456789',
        points: 6,
        hidden: true
      }
    ]
  });
  const partialEvaluation = await runBundle(['evaluate', functionSourcePath, partialManifestPath]);
  assert.equal(partialEvaluation.code, 0, partialEvaluation.stderr);
  assert.match(partialEvaluation.stdout, /1\/2 Tests bestanden/);
  assert.match(partialEvaluation.stdout, /Grade :=>>4/);
  assert.match(partialEvaluation.stdout, /Die Ausgabe des versteckten Tests stimmt nicht/);
  assert.doesNotMatch(partialEvaluation.stdout, /123456789/);

  const invalidManifestPath = await writeManifest('invalid-source.json', {
    version: 1,
    title: 'Validierungsfehler',
    mode: 'program',
    maxGrade: 10,
    tests: [{ name: 'Programm', expectedOutput: '', points: 1 }]
  });
  const invalidEvaluation = await runBundle(['evaluate', invalidSourcePath, invalidManifestPath]);
  assert.equal(invalidEvaluation.code, 0, invalidEvaluation.stderr);
  assert.match(invalidEvaluation.stdout, /invalid\.pseudo2:1:\d+: Fehler:/);
  assert.match(invalidEvaluation.stdout, /Grade :=>>0/);

  const endlessSourcePath = join(temporaryDirectory, 'endless.pseudo2');
  await writeFile(endlessSourcePath, `var value = 0
while true
    value = value + 1
`, 'utf8');
  const timeoutManifestPath = await writeManifest('timeout.json', {
    version: 1,
    title: 'Zeitlimit',
    mode: 'program',
    maxGrade: 10,
    defaultTimeoutMs: 100,
    tests: [{ name: 'Endlosschleife', expectedOutput: '', points: 1 }]
  });
  const timeoutEvaluation = await runBundle(['evaluate', endlessSourcePath, timeoutManifestPath]);
  assert.equal(timeoutEvaluation.code, 0, timeoutEvaluation.stderr);
  assert.match(timeoutEvaluation.stdout, /Zeitlimit von 100 ms ueberschritten/);
  assert.match(timeoutEvaluation.stdout, /Grade :=>>0/);

  const runtimeErrorSourcePath = join(temporaryDirectory, 'runtime-error.pseudo2');
  await writeFile(runtimeErrorSourcePath, 'throw "kaputt"\n', 'utf8');
  const runtimeErrorResult = await runBundle(['run', runtimeErrorSourcePath]);
  assert.equal(runtimeErrorResult.code, 3);
  assert.match(runtimeErrorResult.stderr, /kaputt/);
  assert.doesNotMatch(runtimeErrorResult.stderr, /pseudo2-vpl-[^\\/\s]+[\\/]program\.mjs/);

  console.log('Pseudo2 VPL smoke tests passed.');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
