import type { Program } from 'pseudo2-language';
import type { GraphvizArtifactKind } from 'pseudo2-language';
import { generateGraphvizArtifacts, generatePrettyPseudo2, generateProgram } from 'pseudo2-language';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './util.js';

export type GenerateCliArtifactsOptions = {
  destination?: string;
  emitJavaScript?: boolean;
  emitGraphviz?: boolean;
  emitPrettyPseudo2?: boolean;
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

  if (options.emitPrettyPseudo2 === true) {
    const prettyFilePath = path.join(data.destination, `${data.name}.braced.pseudo2`);
    fs.writeFileSync(prettyFilePath, generatePrettyPseudo2(programAst));
    writtenFiles.push(prettyFilePath);
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

export function generatePretty(programAst: Program, filePath: string, destination?: string): string {
  const data = extractDestinationAndName(filePath, destination);
  const generatedFilePath = path.join(data.destination, `${data.name}.braced.pseudo2`);

  if (!fs.existsSync(data.destination)) {
    fs.mkdirSync(data.destination, { recursive: true });
  }

  fs.writeFileSync(generatedFilePath, generatePrettyPseudo2(programAst));
  return generatedFilePath;
}
