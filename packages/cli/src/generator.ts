import type { Program } from 'pseudo2-language';
import type { GraphvizArtifactKind } from 'pseudo2-language';
import { generateGraphvizArtifacts, generateProgram } from 'pseudo2-language';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './util.js';

export type GenerateCliArtifactsOptions = {
  destination?: string;
  emitJavaScript?: boolean;
  emitGraphviz?: boolean;
  graphvizKinds?: GraphvizArtifactKind[];
};

export function generate(programAst: Program, filePath: string, options: GenerateCliArtifactsOptions = {}): string[] {
  const data = extractDestinationAndName(filePath, options.destination);
  const generatedFilePath = `${path.join(data.destination, data.name)}.js`;
  const writtenFiles: string[] = [];

  if (!fs.existsSync(data.destination)) {
    fs.mkdirSync(data.destination, { recursive: true });
  }

  if (options.emitJavaScript !== false) {
    const generatedCode = `"use strict";\n\n// Pseudo2 generator\n${generateProgram(programAst)}\n`;
    fs.writeFileSync(generatedFilePath, generatedCode);
    writtenFiles.push(generatedFilePath);
  }

  if (options.emitGraphviz !== false) {
    for (const artifact of generateGraphvizArtifacts(programAst, { kinds: options.graphvizKinds })) {
      const artifactPath = path.join(data.destination, artifact.fileName);
      fs.writeFileSync(artifactPath, artifact.code);
      writtenFiles.push(artifactPath);
    }
  }

  return writtenFiles;
}
