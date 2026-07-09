import * as vm from 'node:vm';
import { EmptyFileSystem, URI, type LangiumDocument } from 'langium';
import { expect } from 'vitest';

import type { Program } from '../../src/generated/ast.js';
import { generateProgram } from '../../src/generator-core.js';
import { createPseudo2Services } from '../../src/pseudo2-module.js';

let documentCounter = 0;

export function dedent(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');

  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  const indents = lines
    .filter(line => line.trim().length > 0)
    .map(line => line.match(/^ */)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  return lines.map(line => line.slice(minIndent)).join('\n');
}

export async function parseRuntimeProgram(text: string): Promise<{ model: Program; document: LangiumDocument }> {
  const services = createPseudo2Services(EmptyFileSystem);
  const documentBuilder = services.shared.workspace.DocumentBuilder;
  const documentFactory = services.shared.workspace.LangiumDocumentFactory;
  const uri = URI.parse(`memory:/runtime-test-${documentCounter++}.pseudo2`);
  const document = documentFactory.fromString(dedent(text), uri);

  await documentBuilder.build([document], { validation: true });

  return {
    model: document.parseResult.value as Program,
    document
  };
}

export async function generateRuntimeCode(text: string): Promise<string> {
  const { model, document } = await parseRuntimeProgram(text);
  const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
  expect(errors.map(error => error.message).join('\n')).toBe('');
  return `"use strict";\n\n${generateProgram(model)}\n`;
}

export async function executePseudo2(text: string): Promise<string> {
  const output: string[] = [];
  const code = await generateRuntimeCode(text);

  vm.runInNewContext(code, {
    console: {
      log: (...values: unknown[]) => output.push(values.map(value => String(value)).join(' '))
    }
  }, { timeout: 1000 });

  return normalizeOutput(output.join(' '));
}

export async function assertExecResult(text: string, expected: string): Promise<void> {
  expect(await executePseudo2(text)).toBe(expected);
}

export async function assertExecThrows(text: string): Promise<void> {
  await expect(executePseudo2(text)).rejects.toBeTruthy();
}

function normalizeOutput(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
