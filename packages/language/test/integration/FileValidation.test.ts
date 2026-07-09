import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { EmptyFileSystem, URI } from 'langium';

import { createPseudo2Services } from '../../src/pseudo2-module.js';

describe('FileValidation', () => {
  test('validates all example programs', async () => {
    const examplesRoot = fileURLToPath(new URL('../../../../examples', import.meta.url));
    const files = collectPseudo2Files(examplesRoot);
    const failures: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      if (!text.trim()) {
        continue;
      }

      const services = createPseudo2Services(EmptyFileSystem);
      const documentBuilder = services.shared.workspace.DocumentBuilder;
      const documentFactory = services.shared.workspace.LangiumDocumentFactory;
      const document = documentFactory.fromString(text, URI.parse(`memory:/${relativeExamplePath(examplesRoot, file)}`));
      await documentBuilder.build([document], { validation: true });
      const diagnostics = document.diagnostics ?? [];
      const errors = diagnostics.filter(diagnostic => diagnostic.severity === 1);

      if (errors.length > 0) {
        failures.push(`${relativeExamplePath(examplesRoot, file)}: ${errors.map(error => error.message).join(' | ')}`);
      }
    }

    expect(files.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  }, 30000);
});

function collectPseudo2Files(dir: string): string[] {
  const out: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectPseudo2Files(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.pseudo2')) {
      out.push(fullPath);
    }
  }

  return out;
}

function relativeExamplePath(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, '/');
}
