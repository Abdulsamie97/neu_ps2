import type { Program } from 'pseudo2-language';
import { generateCProgram } from 'pseudo2-language';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './util.js';

export type GenerateCOptions = {
  destination?: string;
};

export function generateC(program: Program, sourceFileName: string, destination?: string): string {
  const data = extractDestinationAndName(sourceFileName, destination);
  const outDir = path.resolve(data.destination);

  fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `${data.name}.c`);
  const c = generateCProgram(program);
  fs.writeFileSync(outFile, c, { encoding: 'utf8' });
  return outFile;
}
