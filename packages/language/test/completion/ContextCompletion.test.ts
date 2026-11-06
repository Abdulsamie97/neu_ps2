/**
 * @file ContextCompletion.test.ts
 * @brief Trennt Pseudo2-Vervollstaendigung von VeriFast-Annotationen.
 * @author Abdul
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, URI } from 'langium';
import { createPseudo2Services, isVerificationAnnotationLine } from 'pseudo2-language';

let services: ReturnType<typeof createPseudo2Services>;
let documentCounter = 0;

beforeAll(() => {
  services = createPseudo2Services(EmptyFileSystem);
});

/** Fragt den gemeinsamen Langium-Provider an der letzten Quellposition ab. */
async function completionLabels(source: string): Promise<string[]> {
  const uri = URI.parse(`memory:/completion-context-${documentCounter++}.pseudo2`);
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(source, uri);
  try {
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
    const completion = await services.Pseudo2.lsp.CompletionProvider?.getCompletion(document, {
      textDocument: { uri: uri.toString() },
      position: document.textDocument.positionAt(source.length)
    });
    return completion?.items.map(item => item.label) ?? [];
  } finally {
    services.shared.workspace.IndexManager.remove(uri);
    services.shared.workspace.LangiumDocuments.deleteDocument(uri);
  }
}

describe('context-specific completion', () => {
  test('normal Pseudo2 keywords remain available', async () => {
    expect(await completionLabels('var n = 1\npr')).toContain('print');
  });

  test('VeriFast keywords and constants stay out of executable code', async () => {
    expect(await completionLabels('var n = 1\nvf_')).not.toContain('vf_int');
    expect(await completionLabels('var n = 1\nINT_')).not.toContain('INT_MAX');
  });

  test('VeriFast proposals remain in annotation lines', async () => {
    expect(await completionLabels('func f(x)\n  return x\n@ens')).toContain('ensures');
    expect(await completionLabels('func f(x)\n  //@ requires vf_')).toContain('vf_int');
    expect(await completionLabels('func f(x)\n  //@ requires INT_')).toContain('INT_MAX');
    expect(isVerificationAnnotationLine('  //@ requires vf_')).toBe(true);
    expect(isVerificationAnnotationLine('  // ordinary comment')).toBe(false);
  });

  test('user-defined names beginning with vf_ are not hidden', async () => {
    expect(await completionLabels('var vf_helper = 1\nprint vf_')).toContain('vf_helper');
  });
});
