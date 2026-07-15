/**
 * @file generator.ts
 * @brief Erzeugt JavaScript-, Pretty-Pseudo2- und Graphviz-Dateien über die Kommandozeile.
 * @author Abdul
 */

import type { Program } from 'pseudo2-language';
import type { GraphvizArtifactKind } from 'pseudo2-language';
import { generateGraphvizArtifacts, generatePrettyPseudo2, generateProgram } from 'pseudo2-language';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './util.js';

/** @brief Steuert, welche Generatorartefakte in welches Verzeichnis geschrieben werden. */
export type GenerateCliArtifactsOptions = {
  /** @brief Überschreibt das standardmäßige Unterverzeichnis `generated`. */
  destination?: string;
  /** @brief Aktiviert oder deaktiviert die JavaScript-Ausgabe; Standard ist aktiviert. */
  emitJavaScript?: boolean;
  /** @brief Aktiviert oder deaktiviert Graphviz-Artefakte; Standard ist aktiviert. */
  emitGraphviz?: boolean;
  /** @brief Aktiviert eine zweite, mit geschweiften Klammern formatierte Pseudo2-Datei. */
  emitPrettyPseudo2?: boolean;
  /** @brief Begrenzt Graphviz auf ausgewählte Diagrammarten wie AST, Abhängigkeiten oder CFG. */
  graphvizKinds?: GraphvizArtifactKind[];
};

/**
 * @brief Erzeugt die ausgewählten CLI-Artefakte eines Pseudo2-Programms.
 *
 * Die Funktion legt das Zielverzeichnis bei Bedarf an. JavaScript wird mit
 * Strict-Mode-Präambel geschrieben, Pretty Pseudo2 erhält die Endung
 * `.braced.pseudo2`, und jedes Graphviz-Artefakt verwendet den vom zentralen
 * Artefaktgenerator gelieferten Dateinamen.
 *
 * @param programAst Vollständig geparster Pseudo2-Programm-AST.
 * @param filePath Pfad der Quelldatei, aus dem Zielname und Standardverzeichnis entstehen.
 * @param options Auswahl und Ziel der zu schreibenden Artefakte.
 * @return Pfade aller tatsächlich geschriebenen Dateien in Erzeugungsreihenfolge.
 * @throws Error Wenn das Ausgabeverzeichnis oder eine Artefaktdatei nicht geschrieben werden kann.
 */
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

/**
 * @brief Schreibt ausschließlich eine mit geschweiften Klammern formatierte Pseudo2-Kopie.
 *
 * Das Zielverzeichnis wird bei Bedarf angelegt. Der Dateiname basiert auf der
 * Eingabedatei und endet stets auf `.braced.pseudo2`.
 *
 * @param programAst Vollständig geparster Pseudo2-Programm-AST.
 * @param filePath Pfad der ursprünglichen Pseudo2-Datei.
 * @param destination Optionales Ausgabeverzeichnis.
 * @return Pfad der erzeugten Pretty-Pseudo2-Datei.
 * @throws Error Wenn Verzeichnis oder Ausgabedatei nicht geschrieben werden können.
 */
export function generatePretty(programAst: Program, filePath: string, destination?: string): string {
  const data = extractDestinationAndName(filePath, destination);
  const generatedFilePath = path.join(data.destination, `${data.name}.braced.pseudo2`);

  if (!fs.existsSync(data.destination)) {
    fs.mkdirSync(data.destination, { recursive: true });
  }

  fs.writeFileSync(generatedFilePath, generatePrettyPseudo2(programAst));
  return generatedFilePath;
}
