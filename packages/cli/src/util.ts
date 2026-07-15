/**
 * @file util.ts
 * @brief Lädt, validiert und zerlegt Pseudo2-Eingabepfade für die CLI-Generatoren.
 * @author Abdul
 */

import type { AstNode, LangiumCoreServices, LangiumDocument } from 'langium';
import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { URI } from 'langium';

/**
 * @brief Lädt eine Pseudo2-Datei als vollständig aufgebautes und validiertes Langium-Dokument.
 *
 * Vor dem Laden werden Dateiendung und Existenz geprüft. Danach erstellt oder
 * übernimmt Langium das Dokument und führt den DocumentBuilder einschließlich
 * Validierung aus. Alle Fehlerdiagnosen werden mit Quellzeile und betroffenem
 * Text ausgegeben; bei ungültiger Eingabe beendet die Funktion die CLI mit Exitcode 1.
 *
 * @param fileName Pfad der einzulesenden Pseudo2-Datei.
 * @param services Sprachspezifische Langium-Dienste mit Metadaten und Workspace-Verwaltung.
 * @return Erfolgreich aufgebautes Langium-Dokument ohne Fehlerdiagnosen.
 */
export async function extractDocument(fileName: string, services: LangiumCoreServices): Promise<LangiumDocument> {
    const extensions = services.LanguageMetaData.fileExtensions;
    if (!extensions.includes(path.extname(fileName))) {
        console.error(chalk.yellow(`Please choose a file with one of these extensions: ${extensions}.`));
        process.exit(1);
    }

    if (!fs.existsSync(fileName)) {
        console.error(chalk.red(`File ${fileName} does not exist.`));
        process.exit(1);
    }

    const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.file(path.resolve(fileName)));
    await services.shared.workspace.DocumentBuilder.build([document], { validation: true });

    const validationErrors = (document.diagnostics ?? []).filter(e => e.severity === 1);
    if (validationErrors.length > 0) {
        console.error(chalk.red('There are validation errors:'));
        for (const validationError of validationErrors) {
            console.error(chalk.red(
                `line ${validationError.range.start.line + 1}: ${validationError.message} [${document.textDocument.getText(validationError.range)}]`
            ));
        }
        process.exit(1);
    }

    return document;
}

/**
 * @brief Liefert den typisierten Wurzelknoten einer validierten Pseudo2-Datei.
 *
 * Die Funktion verwendet `extractDocument`, sodass Erweiterungs-, Existenz- und
 * Validierungsprüfungen identisch für alle CLI-Befehle ausgeführt werden.
 *
 * @typeParam T Erwarteter Typ des AST-Wurzelknotens, üblicherweise `Program`.
 * @param fileName Pfad der einzulesenden Pseudo2-Datei.
 * @param services Zu verwendende Langium-Sprachdienste.
 * @return Typisierter Wert aus dem Parse-Ergebnis des validierten Dokuments.
 */
export async function extractAstNode<T extends AstNode>(fileName: string, services: LangiumCoreServices): Promise<T> {
    return (await extractDocument(fileName, services)).parseResult?.value as T;
}

/** @brief Enthält das berechnete Zielverzeichnis und den bereinigten Ausgabebasisnamen. */
interface FilePathData {
    /** @brief Verzeichnis, in das Generatorartefakte geschrieben werden. */
    destination: string,
    /** @brief Basisname ohne Erweiterung, Punkte und Bindestriche. */
    name: string
}

/**
 * @brief Leitet aus einer Quelldatei Zielverzeichnis und sicheren Artefaktnamen ab.
 *
 * Ohne explizites Ziel wird das Unterverzeichnis `generated` neben der Quelldatei
 * verwendet. Punkte und Bindestriche werden aus dem Basisnamen entfernt, damit der
 * Name auch als C-Modul- oder Artefaktname eingesetzt werden kann.
 *
 * @param filePath Pfad der ursprünglichen Pseudo2-Datei.
 * @param destination Optionales, vom Benutzer gewähltes Zielverzeichnis.
 * @return Berechnetes Zielverzeichnis und bereinigter Basisname.
 */
export function extractDestinationAndName(filePath: string, destination: string | undefined): FilePathData {
    const sourceDir = path.dirname(filePath);
    const name = path.basename(filePath, path.extname(filePath)).replace(/[.-]/g, '');
    return {
        destination: destination ?? path.join(sourceDir, 'generated'),
        name
    };
}
