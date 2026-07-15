/**
 * @file generator-c.ts
 * @brief Schreibt den aus Pseudo2 erzeugten C-Code und seine Quellzeilenzuordnung in Dateien.
 * @author Abdul
 */

import type { Program } from 'pseudo2-language';
import { generateCProgramWithSourceMap } from 'pseudo2-language';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './util.js';

/** @brief Legt Zielverzeichnis und Runtime-Variante der C-Generierung fest. */
export type GenerateCOptions = {
  /** @brief Überschreibt das standardmäßig neben der Quelldatei angelegte Ausgabeverzeichnis. */
  destination?: string;
  /** @brief Wählt abstrakte VeriFast-Verträge oder eine konkret ausführbare C-Runtime. */
  runtime?: 'contracts' | 'implementation';
};

/**
 * @brief Erzeugt eine C-Datei und die zugehörige Pseudo2-Quellzeilenabbildung.
 *
 * Aus dem Namen der Eingabedatei wird ein sicherer Modulname gebildet. Der zentrale
 * C-Generator liefert Code und Source-Map; beide werden im Zielverzeichnis als
 * `<name>.c` und `<name>.c.map.json` gespeichert. Die Map enthält zusätzlich den
 * absoluten Pfad der ursprünglichen Pseudo2-Datei.
 *
 * @param program Vollständig geparster Pseudo2-Programm-AST.
 * @param sourceFileName Pfad der ursprünglichen Pseudo2-Quelldatei.
 * @param options Zielverzeichnis und gewünschte C-Runtime-Variante.
 * @return Pfad der geschriebenen C-Datei.
 * @throws Error Wenn Zielverzeichnis oder Ausgabedateien nicht geschrieben werden können.
 */
export function generateC(program: Program, sourceFileName: string, options: GenerateCOptions = {}): string {
  const data = extractDestinationAndName(sourceFileName, options.destination);
  const outDir = path.resolve(data.destination);

  fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `${data.name}.c`);
  const generated = generateCProgramWithSourceMap(program, undefined, {
    moduleName: data.name,
    runtime: options.runtime
  });
  fs.writeFileSync(outFile, generated.code, { encoding: 'utf8' });
  fs.writeFileSync(`${outFile}.map.json`, JSON.stringify({
    sourceFile: path.resolve(sourceFileName),
    mappings: generated.sourceMap
  }, null, 2), { encoding: 'utf8' });
  return outFile;
}
