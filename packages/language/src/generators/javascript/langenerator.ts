/**
 * @file langenerator.ts
 * @brief Stellt den öffentlichen Einstieg in den gemeinsamen JavaScript-Generator bereit.
 * @author Abdul
 */

import type { Program } from '../../generated/ast.js';
import { generateProgram as generateProgramCore } from './generator-core.js';
import { Pseudo2GeneratorContext } from './generator-context.js';

/**
 * Erzeugt JavaScript aus einem vollständig gelinkten Pseudo2-Programm.
 *
 * Der Wrapper hält die öffentliche API stabil, während die Implementierung im
 * gemeinsamen Generator-Core liegt und von CLI sowie Weboberfläche geteilt wird.
 *
 * @param program Zu übersetzender Pseudo2-AST.
 * @param context Optionaler Namenskontext, etwa fuer einen beobachteten Lauf.
 * @returns Ausführbarer JavaScript-Quelltext ohne Dateisystemzugriff.
 */
export function generateProgram(program: Program, context?: Pseudo2GeneratorContext): string {
  return generateProgramCore(program, context);
}
