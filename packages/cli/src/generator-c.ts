import type { Program } from 'pseudo2-language';
import { generateCProgramWithSourceMap } from 'pseudo2-language';
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
  const generated = generateCProgramWithSourceMap(program, undefined, { moduleName: data.name });
  fs.writeFileSync(outFile, generated.code, { encoding: 'utf8' });
  fs.writeFileSync(`${outFile}.map.json`, JSON.stringify({
    sourceFile: path.resolve(sourceFileName),
    mappings: generated.sourceMap
  }, null, 2), { encoding: 'utf8' });
  return outFile;
}
