/**
 * @file main.ts
 * @brief Definiert sämtliche Pseudo2-CLI-Befehle und verbindet Parser, Generatoren, C-Ausführung und VeriFast.
 * @author Abdul
 */

import type { Program } from 'pseudo2-language';
import { createPseudo2Services, generateCProgram, Pseudo2LanguageMetaData } from 'pseudo2-language';
import chalk from 'chalk';
import { Command } from 'commander';
import { extractAstNode } from './util.js';
import { generate, generatePretty } from './generator.js';
import { NodeFileSystem } from 'langium/node';
import * as url from 'node:url';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { applyCSourceMapToVeriFastResult, runVeriFast, runVeriFastBundle, type CSourceMapFile } from './verifast.js';
import { generateC } from './generator-c.js';
import { compileAndRunCFile, runCSource, type CExecutionResult } from './c-runner.js';

/** @brief Verzeichnis der kompilierten CLI-Datei, unabhängig vom aktuellen Arbeitsverzeichnis. */
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

/** @brief Pfad zur Paketbeschreibung, aus der die angezeigte CLI-Version gelesen wird. */
const packagePath = path.resolve(__dirname, '..', 'package.json');
/** @brief Unveränderter JSON-Inhalt der CLI-Paketbeschreibung. */
const packageContent = await fs.readFile(packagePath, 'utf-8');
/** @brief Absoluter Pfad zum Wurzelverzeichnis des Pseudo2-Workspaces. */
const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
/** @brief Standardpfad zur im Repository enthaltenen VeriFast-Programmdatei. */
const DEFAULT_VERIFAST_EXE = path.join(workspaceRoot, 'verifast-26.01', 'bin', 'verifast.exe');
/** @brief Konkrete C-Runtime-Kerne, die vor einem generierten Programm separat verifiziert werden. */
const VERIFIED_RUNTIME_FILES = [
    path.join(workspaceRoot, 'runtime', 'c', 'pseudo2_heap_runtime.c'),
    path.join(workspaceRoot, 'runtime', 'c', 'pseudo2_scalar_runtime.c')
];

/** @brief Beschreibt die Artefaktauswahl des allgemeinen `generate`-Befehls. */
export type GenerateOptions = {
    /** @brief Überschreibt das Standardausgabeverzeichnis. */
    destination?: string;
    /** @brief Aktiviert die JavaScript-Ausgabe; bei `false` wird sie übersprungen. */
    js?: boolean;
    /** @brief Aktiviert Graphviz-Artefakte; bei `false` werden sie übersprungen. */
    graphviz?: boolean;
    /** @brief Unterdrückt alle Artefakte außer JavaScript. */
    onlyJs?: boolean;
    /** @brief Fordert eine mit geschweiften Klammern formatierte Pseudo2-Kopie an. */
    pretty?: boolean;
    /** @brief Beschränkt die Graphausgabe auf den abstrakten Syntaxbaum. */
    ast?: boolean;
    /** @brief Beschränkt die Graphausgabe auf den Abhängigkeitsgraphen. */
    dep?: boolean;
    /** @brief Beschränkt die Graphausgabe auf Kontrollflussgraphen. */
    cfg?: boolean;
}

/**
 * @brief Lädt eine Pseudo2-Datei und erzeugt die über CLI-Optionen ausgewählten Artefakte.
 *
 * Die Aktion initialisiert die Langium-Dienste, parst und validiert die Eingabe
 * und übergibt den AST an den gemeinsamen Dateigenerator. `onlyJs` hat Vorrang
 * vor Pretty- und Graphviz-Optionen. Abschließend werden Anzahl und Pfade aller
 * geschriebenen Dateien ausgegeben.
 *
 * @param fileName Pfad zur Pseudo2-Quelldatei.
 * @param opts Von Commander ausgewertete Optionen des `generate`-Befehls.
 * @return Promise, das nach Abschluss sämtlicher Dateischreibvorgänge erfüllt wird.
 */
export const generateAction = async (fileName: string, opts: GenerateOptions): Promise<void> => {
    const services = createPseudo2Services(NodeFileSystem).Pseudo2;
    const programAst = await extractAstNode<Program>(fileName, services);
    const writtenFiles = generate(programAst, fileName, {
        destination: opts.destination,
        emitJavaScript: opts.js !== false,
        emitPrettyPseudo2: opts.onlyJs ? false : opts.pretty === true,
        emitGraphviz: opts.onlyJs ? false : opts.graphviz !== false,
        graphvizKinds: selectedGraphvizKinds(opts)
    });
    console.log(chalk.green(`Generated ${writtenFiles.length} file(s): ${writtenFiles.join(', ')}`));
};

/** @brief Beschreibt Zielverzeichnis und Runtime-Modus des Befehls `generate-c`. */
export type GenerateCActionOptions = {
    /** @brief Überschreibt das Standardausgabeverzeichnis. */
    destination?: string;
    /** @brief Enthält den ungeprüften CLI-Wert `contracts` oder `implementation`. */
    runtime?: string;
};

/** @brief Beschreibt Compiler und Zeitlimit des Befehls `run-c`. */
export type RunCOptions = {
    /** @brief Legt einen konkreten C-Compilerbefehl oder Compilerpfad fest. */
    cc?: string;
    /** @brief Enthält das noch als positive Millisekundenzahl zu prüfende Zeitlimit. */
    timeout?: string;
};

/**
 * @brief Erzeugt eine C-Datei samt Source-Map aus einer validierten Pseudo2-Datei.
 *
 * Der Runtime-Modus wird strikt auf `contracts` oder `implementation` begrenzt.
 * Nach erfolgreichem Schreiben wird der Pfad der C-Datei auf der Konsole ausgegeben.
 *
 * @param fileName Pfad zur Pseudo2-Quelldatei.
 * @param opts Zielverzeichnis und angeforderter Runtime-Modus.
 * @return Promise, das nach dem Schreiben von C-Datei und Source-Map erfüllt wird.
 */
export const generateCAction = async (fileName: string, opts: GenerateCActionOptions): Promise<void> => {
    const services = createPseudo2Services(NodeFileSystem).Pseudo2;
    const programAst = await extractAstNode<Program>(fileName, services);
    const generatedFilePath = generateC(programAst, fileName, {
        destination: opts.destination,
        runtime: parseCRuntime(opts.runtime)
    });
    console.log(chalk.green(`C code generated successfully: ${generatedFilePath}`));
};

/**
 * @brief Führt entweder vorhandenen C-Code oder eine Pseudo2-Datei über die C-Runtime aus.
 *
 * Eine `.c`-Datei wird direkt kompiliert. Für eine Pseudo2-Datei wird zunächst
 * ausführbarer C-Code mit der Runtime-Variante `implementation` im Speicher erzeugt.
 * Nicht unterstützte Dateiendungen liefern ein strukturiertes Fehlerergebnis.
 * Das Ergebnis wird in allen Fällen als JSON ausgegeben.
 *
 * @param fileName Pfad zu einer Pseudo2- oder C-Datei.
 * @param opts Optionaler Compiler und positives Ausführungszeitlimit.
 * @return Strukturiertes Ergebnis von Compilererkennung, Kompilierung und Ausführung.
 */
export const runCAction = async (fileName: string, opts: RunCOptions): Promise<CExecutionResult> => {
    const extension = path.extname(fileName).toLowerCase();
    const timeoutMs = parseTimeout(opts.timeout);
    let result: CExecutionResult;

    if (extension === '.c') {
        result = await compileAndRunCFile(fileName, { compiler: opts.cc, timeoutMs });
    } else if (Pseudo2LanguageMetaData.fileExtensions.some(candidate => candidate === extension)) {
        const services = createPseudo2Services(NodeFileSystem).Pseudo2;
        const programAst = await extractAstNode<Program>(fileName, services);
        const moduleName = path.basename(fileName, extension);
        const cCode = generateCProgram(programAst, undefined, {
            moduleName,
            runtime: 'implementation'
        });
        result = await runCSource(cCode, `${moduleName}.c`, { compiler: opts.cc, timeoutMs });
    } else {
        result = {
            ok: false,
            stage: 'compiler',
            exitCode: 2,
            stdout: '',
            stderr: `run-c expects a .pseudo2 or .c file, received: ${fileName}`
        };
    }

    console.log(JSON.stringify(result, null, 2));
    return result;
};

/**
 * @brief Erzeugt ausschließlich die formatierte Pseudo2-Variante mit geschweiften Klammern.
 * @param fileName Pfad zur zu parsenden und zu validierenden Pseudo2-Datei.
 * @param opts Optionales Zielverzeichnis für die erzeugte Datei.
 * @return Promise, das nach Ausgabe des erzeugten Dateipfads erfüllt wird.
 */
export const generatePrettyAction = async (fileName: string, opts: {
    /** @brief Optionales Zielverzeichnis der formatierten Pseudo2-Datei. */
    destination?: string
}): Promise<void> => {
    const services = createPseudo2Services(NodeFileSystem).Pseudo2;
    const programAst = await extractAstNode<Program>(fileName, services);
    const generatedFilePath = generatePretty(programAst, fileName, opts.destination);
    console.log(chalk.green(`Braced Pseudo2 generated successfully: ${generatedFilePath}`));
};

/**
 * @brief Konfiguriert die Commander-Anwendung und startet die Auswertung der CLI-Argumente.
 *
 * Registriert werden `generate`, `generate-c`, `generate-pretty`, `run-c` und
 * `verifast`. Die Funktion verbindet jede Commander-Option mit der passenden
 * typisierten Aktion und setzt für ausführende oder verifizierende Befehle einen
 * zum Ergebnis passenden Prozess-Exitcode.
 */
export default function(): void {
    const program = new Command();

    program.version(JSON.parse(packageContent).version);

    const fileExtensions = Pseudo2LanguageMetaData.fileExtensions.join(', ');
    program
        .command('generate')
        .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
        .option('-d, --destination <dir>', 'destination directory of generating')
        .option('--no-js', 'skip JavaScript output')
        .option('--no-graphviz', 'skip Graphviz artifacts')
        .option('--only-js', 'write only JavaScript output')
        .option('--pretty', 'write a braced pretty-printed Pseudo2 copy')
        .option('--ast', 'write AST Graphviz artifact')
        .option('--dep', 'write dependency Graphviz artifact')
        .option('--cfg', 'write CFG Graphviz artifacts')
        .description('generates code from a Pseudo2 source file')
        .action(generateAction);


    program
        .command('verifast')
        .argument('<file>', 'C file to verify (e.g. out/generated.c)')
        .option('--vf <path>', 'path to verifast.exe; defaults to repo-local verifast-26.01')
        .option('--extra <args...>', 'extra args passed to verifast (optional)')
        .option('--timeout <ms>', 'maximum VeriFast runtime in milliseconds', '60000')
        .option('--link', 'enable VeriFast link checking; default verifies generated C only with -c')
        .option('--no-runtime', 'skip verification of the repo-local concrete runtime kernels')
        .description('runs VeriFast on a C file and prints JSON result')
        /**
         * @brief Verifiziert zuerst die konkreten Runtime-Kerne und danach die angegebene C-Datei.
         *
         * Prüft den VeriFast-Pfad, normalisiert das Zeitlimit, vermeidet eine doppelte
         * Runtime-Prüfung und bildet Diagnosen des generierten C-Codes über eine optionale
         * Source-Map auf Pseudo2-Zeilen ab.
         */
        .action(async (file: string, opts: {
            /** @brief Optionaler Pfad zu einer abweichenden VeriFast-Installation. */
            vf?: string;
            /** @brief Zusätzliche, unverändert an VeriFast weitergegebene Argumente. */
            extra?: string[];
            /** @brief Maximale VeriFast-Laufzeit als CLI-Textwert. */
            timeout?: string;
            /** @brief Aktiviert die Linkprüfung, indem der Compile-only-Modus deaktiviert wird. */
            link?: boolean;
            /** @brief Deaktiviert bei `false` die separate Prüfung der konkreten Runtime-Kerne. */
            runtime?: boolean
        }) => {
            const verifastExe = opts.vf ?? DEFAULT_VERIFAST_EXE;
            const timeoutMs = parseVeriFastTimeout(opts.timeout);
            try {
                await fs.access(verifastExe);
            } catch {
                console.error(
                    JSON.stringify({
                        ok: false,
                        error:
                            `VeriFast executable not found: ${verifastExe}. Use --vf <path> or place VeriFast at ${DEFAULT_VERIFAST_EXE}.`,
                    })
                );
                process.exit(2);
            }

            const runtimeFiles = opts.runtime === false || VERIFIED_RUNTIME_FILES.some(runtime => path.resolve(runtime) === path.resolve(file))
                ? []
                : VERIFIED_RUNTIME_FILES;
            const result = runtimeFiles.length > 0
                ? await runVeriFastBundle({
                    verifastExe,
                    file,
                    runtimeFiles,
                    extraArgs: opts.extra ?? [],
                    compileOnly: opts.link !== true,
                    timeoutMs,
                })
                : await runVeriFast({
                    verifastExe,
                    file,
                    extraArgs: opts.extra ?? [],
                    compileOnly: opts.link !== true,
                    timeoutMs,
            });
            const sourceMap = await readCSourceMap(file);
            const mapsProgramDiagnostics = !('verificationTarget' in result) || result.verificationTarget === 'program';
            const mappedResult = sourceMap && mapsProgramDiagnostics
                ? applyCSourceMapToVeriFastResult(result, sourceMap)
                : result;

            // JSON auf stdout (ideal für Web-UI)
            console.log(JSON.stringify(mappedResult, null, 2));
            process.exit(mappedResult.ok ? 0 : 1);
        });

        program
            .command('generate-c')
            .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
            .option('-d, --destination <dir>', 'destination directory of generating')
            .option('--runtime <mode>', 'runtime mode: contracts for VeriFast or implementation for execution', 'contracts')
            .description('generates VeriFast-ready C code from a Pseudo2 source file')
            .action(generateCAction);

        program
            .command('run-c')
            .argument('<file>', 'Pseudo2 source or runnable C implementation file')
            .option('--cc <path>', 'C compiler command or path; otherwise auto-detect GCC, Clang, or MSVC')
            .option('--timeout <ms>', 'program timeout in milliseconds', '10000')
            .description('generates implementation C when needed, compiles it, and runs the executable')
            /** @brief Führt `runCAction` aus und überträgt dessen Erfolgsstatus auf den Prozess-Exitcode. */
            .action(async (file: string, opts: RunCOptions) => {
                const result = await runCAction(file, opts);
                process.exitCode = result.ok ? 0 : 1;
            });

        program
            .command('generate-pretty')
            .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
            .option('-d, --destination <dir>', 'destination directory of generating')
            .description('generates a braced pretty-printed Pseudo2 copy')
            .action(generatePrettyAction);
        program.parse(process.argv);
}

/**
 * @brief Lädt die neben einer C-Datei gespeicherte Pseudo2-Source-Map.
 *
 * Ungültiges JSON, fehlende Dateien und Maps ohne `mappings` werden bewusst wie
 * eine nicht vorhandene Source-Map behandelt, damit die Verifikation fortgesetzt wird.
 *
 * @param cFile Pfad der C-Datei, zu der `<datei>.map.json` gesucht wird.
 * @return Gültige Source-Map oder `undefined`, wenn keine verwendbare Map vorliegt.
 */
async function readCSourceMap(cFile: string): Promise<CSourceMapFile | undefined> {
    const mapFile = `${cFile}.map.json`;
    try {
        const text = await fs.readFile(mapFile, 'utf-8');
        const parsed = JSON.parse(text) as CSourceMapFile;
        return Array.isArray(parsed.mappings) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

/**
 * @brief Ermittelt die explizit ausgewählten Graphviz-Artefaktarten.
 * @param opts Optionen des allgemeinen Generatorbefehls.
 * @return Auswahl in der Reihenfolge AST, Abhängigkeit, CFG oder `undefined` für die Standardauswahl.
 */
function selectedGraphvizKinds(opts: GenerateOptions): Array<'ast' | 'dep' | 'cfg'> | undefined {
    const selected: Array<'ast' | 'dep' | 'cfg'> = [];
    if (opts.ast) selected.push('ast');
    if (opts.dep) selected.push('dep');
    if (opts.cfg) selected.push('cfg');
    return selected.length > 0 ? selected : undefined;
}

/**
 * @brief Prüft und typisiert den als Text übergebenen C-Runtime-Modus.
 * @param value CLI-Wert der Option `--runtime`.
 * @return `contracts` als Standard oder der ausdrücklich gewählte Implementierungsmodus.
 * @throws Error Wenn der Wert weder `contracts` noch `implementation` ist.
 */
function parseCRuntime(value: string | undefined): 'contracts' | 'implementation' {
    if (value === undefined || value === 'contracts') return 'contracts';
    if (value === 'implementation') return 'implementation';
    throw new Error(`Unsupported C runtime mode "${value}". Use "contracts" or "implementation".`);
}

/**
 * @brief Wandelt das C-Ausführungszeitlimit in eine positive ganze Millisekundenzahl um.
 * @param value Textwert der CLI-Option `--timeout`.
 * @return Abgerundetes Zeitlimit; ohne Angabe werden 10000 Millisekunden verwendet.
 * @throws Error Bei nicht numerischen, unendlichen oder nicht positiven Werten.
 */
function parseTimeout(value: string | undefined): number {
    const timeout = Number(value ?? 10_000);
    if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new Error(`Invalid C execution timeout: ${value}`);
    }
    return Math.floor(timeout);
}

/**
 * @brief Wandelt das VeriFast-Zeitlimit in eine positive ganze Millisekundenzahl um.
 * @param value Textwert der CLI-Option `--timeout`.
 * @return Abgerundetes Zeitlimit; ohne Angabe werden 60000 Millisekunden verwendet.
 * @throws Error Bei nicht numerischen, unendlichen oder nicht positiven Werten.
 */
function parseVeriFastTimeout(value: string | undefined): number {
    const timeout = Number(value ?? 60_000);
    if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new Error(`Invalid VeriFast timeout: ${value}`);
    }
    return Math.floor(timeout);
}
