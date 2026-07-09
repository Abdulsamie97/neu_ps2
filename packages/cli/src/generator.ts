import type { Program } from 'pseudo2-language';
import { generateProgram } from 'pseudo2-language';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './util.js';

export function generate(programAst: Program, filePath: string, destination: string | undefined): string {
  const data = extractDestinationAndName(filePath, destination);
  const generatedFilePath = `${path.join(data.destination, data.name)}.js`;
  const generatedCode = `"use strict";\n\n// Pseudo2 generator\n${generateProgram(programAst)}\n`;

  if (!fs.existsSync(data.destination)) {
    fs.mkdirSync(data.destination, { recursive: true });
  }
  fs.writeFileSync(generatedFilePath, generatedCode);
  return generatedFilePath;
}
