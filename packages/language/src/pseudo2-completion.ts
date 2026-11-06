/**
 * @file pseudo2-completion.ts
 * @brief Trennt Pseudo2-Vorschlaege von eingebetteten VeriFast-Annotationen.
 * @author Abdul
 */

import { GrammarAST } from 'langium';
import { DefaultCompletionProvider, type CompletionContext } from 'langium/lsp';

const VERIFICATION_KEYWORDS = new Set([
  'assert', 'assume', 'close', 'decreases', 'ensures', 'invariant', 'leak',
  'open', 'requires', 'result', 'terminates', 'undefined', 'INT_MAX', 'INT_MIN', 'length'
]);

/** @returns Ob ein Schluesselwort nur zur VeriFast-Spezifikation gehoert. */
export function isVerificationKeyword(value: string): boolean {
  return value.startsWith('vf_') || VERIFICATION_KEYWORDS.has(value);
}

/** @returns Ob die aktuelle Zeile mit einer Pseudo2-VeriFast-Annotation beginnt. */
export function isVerificationAnnotationLine(linePrefix: string): boolean {
  return /^\s*(?:\/\/)?@/.test(linePrefix);
}

/** Verbirgt VeriFast-Schluesselwoerter im ausfuehrbaren Pseudo2-Code. */
export class Pseudo2CompletionProvider extends DefaultCompletionProvider {
  protected override filterKeyword(context: CompletionContext, keyword: GrammarAST.Keyword): boolean {
    if (!super.filterKeyword(context, keyword)) return false;
    if (!isVerificationKeyword(keyword.value)) return true;
    const linePrefix = context.textDocument.getText({
      start: { line: context.position.line, character: 0 },
      end: context.position
    });
    return isVerificationAnnotationLine(linePrefix);
  }
}
