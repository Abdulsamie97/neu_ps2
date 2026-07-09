import type { Program } from './generated/ast.js';
import { generateProgram as generateProgramCore } from './generator-core.js';

export function generateProgram(program: Program): string {
  return generateProgramCore(program);
}
