// packages/cli/src/generator-c.ts
import type { Program, Instruction, Block } from 'pseudo2-language';
import {
  isBlock,
  isBracedBlock,
  isIndentedBlock,
} from 'pseudo2-language';

import * as fs from 'node:fs';
import * as path from 'node:path';

export type GenerateCOptions = {
  destination?: string;
};

export function generateC(program: Program, sourceFileName: string, destination?: string): string {
  const outDir = destination ? path.resolve(destination) : process.cwd();
  fs.mkdirSync(outDir, { recursive: true });

  const baseName = path.basename(sourceFileName).replace(/\.[^.]+$/, '');
  const outFile = path.join(outDir, `${baseName}.c`); 

  const body = program.instructions.map(i => emitInstruction(i, '  ')).join('');

  const c = `#include "stdlib.h"

int main()
//@ requires true;
//@ ensures true;
{
${body}  return 0;
}
`;

  fs.writeFileSync(outFile, c, { encoding: 'utf8' });
  return outFile;
}

function emitInstruction(i: Instruction, indent: string): string {
  if (isBlock(i)) return emitBlock(i, indent);

  return `${indent}/* TODO: ${i.$type} */\n`;
}

function emitBlock(b: Block, indent: string): string {
  // Beide Blockarten haben instructions
  if (isBracedBlock(b)) return emitBlockBody(b.instructions, indent);
  if (isIndentedBlock(b)) return emitBlockBody(b.instructions, indent);


  return emitBlockBody(((b as any).instructions ?? []) as Instruction[], indent);
}

function emitBlockBody(instructions: Instruction[], indent: string): string {
  let out = `${indent}{\n`;
  const inner = indent + '  ';
  for (const instr of instructions) out += emitInstruction(instr, inner);
  out += `${indent}}\n`;
  return out;
}