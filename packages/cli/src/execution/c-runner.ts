/**
 * @file c-runner.ts
 * @brief Erkennt lokale C-Compiler, kompiliert C-Quelltext und führt das erzeugte Programm kontrolliert aus.
 * @author Abdul
 */

import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** @brief Standardmäßige maximale Laufzeit eines kompilierten C-Programms in Millisekunden. */
const DEFAULT_RUN_TIMEOUT_MS = 10_000;
/** @brief Maximale Laufzeit eines Compilerprozesses in Millisekunden. */
const COMPILE_TIMEOUT_MS = 30_000;
/** @brief Maximale Anzahl erfasster Bytes je Standardausgabe und Fehlerausgabe. */
const MAX_CAPTURE_BYTES = 1024 * 1024;

/**
 * @brief Bezeichnet die unterstützten Familien von C-Compilern.
 *
 * GNU-kompatible Compiler verwenden Argumente im Stil von GCC und Clang. MSVC
 * benötigt dagegen Schalter im Format von `cl.exe`.
 */
export type CCompilerKind = 'gnu' | 'msvc';

/** @brief Beschreibt einen auf dem lokalen System ausführbaren C-Compiler. */
export type CCompiler = {
    /** @brief Enthält den auszuführenden Befehl oder absoluten Compilerpfad. */
    command: string;
    /** @brief Enthält den für Ausgaben bestimmten lesbaren Compilernamen. */
    displayName: string;
    /** @brief Bestimmt, welche Compilerargumente erzeugt werden müssen. */
    kind: CCompilerKind;
    /** @brief Überschreibt bei Bedarf die Prozessumgebung, beispielsweise für MSVC. */
    env?: NodeJS.ProcessEnv;
};

/** @brief Enthält das strukturierte Ergebnis der C-Kompilierung und Programmausführung. */
export type CExecutionResult = {
    /** @brief Gibt an, ob Kompilierung und Ausführung ohne Fehler und Zeitüberschreitung endeten. */
    ok: boolean;
    /** @brief Kennzeichnet die Phase, in der das Ergebnis oder ein Fehler entstanden ist. */
    stage: 'compiler' | 'compile' | 'run';
    /** @brief Nennt den tatsächlich verwendeten Compiler. */
    compiler?: string;
    /** @brief Enthält den Exitcode des fehlgeschlagenen oder zuletzt ausgeführten Prozesses. */
    exitCode: number;
    /** @brief Enthält die bereinigte Standardausgabe des C-Programms. */
    stdout: string;
    /** @brief Enthält die bereinigte Fehlerausgabe des C-Programms oder Compilers. */
    stderr: string;
    /** @brief Enthält bei Bedarf die Standardausgabe des Compilerprozesses. */
    compileStdout?: string;
    /** @brief Enthält bei Bedarf die Fehlerausgabe des Compilerprozesses. */
    compileStderr?: string;
    /** @brief Gibt an, ob der betreffende Prozess wegen einer Zeitüberschreitung beendet wurde. */
    timedOut?: boolean;
};

/** @brief Konfiguriert die Auswahl des Compilers und die Ausführung des C-Programms. */
export type CExecutionOptions = {
    /** @brief Legt einen Compilerbefehl oder Compilerpfad fest und deaktiviert damit die automatische Auswahl. */
    compiler?: string;
    /** @brief Legt die maximale Laufzeit des erzeugten Programms in Millisekunden fest. */
    timeoutMs?: number;
    /** @brief Stellt Text bereit, der an die Standardeingabe des C-Programms geschrieben wird. */
    stdin?: string;
};

/** @brief Internes Ergebnis eines gestarteten Betriebssystemprozesses. */
type ProcessResult = {
    /** @brief Enthält den normalisierten Exitcode des Prozesses. */
    exitCode: number;
    /** @brief Enthält die bis zur Größenbegrenzung erfasste Standardausgabe. */
    stdout: string;
    /** @brief Enthält die bis zur Größenbegrenzung erfasste Fehlerausgabe. */
    stderr: string;
    /** @brief Gibt an, ob der Prozess nach Ablauf seines Zeitlimits beendet wurde. */
    timedOut: boolean;
};

/**
 * @brief Ermittelt einen verwendbaren C-Compiler in definierter Prioritätsreihenfolge.
 *
 * Ein expliziter Wert beziehungsweise `PSEUDO2_C_COMPILER` oder `CC` wird zuerst
 * geprüft. Ohne Vorgabe werden GCC, Clang und `cc` gesucht. Unter Windows folgen
 * ein direkt erreichbares `cl.exe` und zuletzt eine Visual-Studio-Installation,
 * deren Build-Umgebung über `VsDevCmd.bat` geladen wird.
 *
 * @param preferred Optionaler Compilerbefehl oder absoluter Pfad zum Compiler.
 * @return Beschreibung des ersten ausführbaren Compilers oder `undefined`, wenn keiner gefunden wurde.
 */
export function resolveCCompiler(preferred = process.env.PSEUDO2_C_COMPILER ?? process.env.CC): CCompiler | undefined {
    if (preferred) {
        return resolveDirectCompiler(preferred);
    }

    for (const command of ['gcc', 'clang', 'cc']) {
        const compiler = resolveDirectCompiler(command);
        if (compiler) return compiler;
    }

    if (process.platform === 'win32') {
        const directMsvc = resolveDirectCompiler('cl.exe');
        if (directMsvc) return directMsvc;
        return resolveVisualStudioCompiler();
    }

    return undefined;
}

/**
 * @brief Schreibt C-Quelltext in ein temporäres Verzeichnis, kompiliert ihn und führt ihn aus.
 *
 * Das temporäre Verzeichnis wird unabhängig vom Ergebnis in einem `finally`-Block
 * entfernt. Compiler- und Laufzeitergebnis werden unverändert als strukturierter
 * Rückgabewert weitergereicht.
 *
 * @param code Vollständiger, ausführbarer C-Quelltext.
 * @param fileName Gewünschter Dateiname; unsichere Zeichen und Pfadanteile werden entfernt.
 * @param options Einstellungen für Compiler, Zeitlimit und Standardeingabe.
 * @return Ergebnis der Compilererkennung, Kompilierung oder Programmausführung.
 * @throws Error Wenn das temporäre Verzeichnis oder die C-Datei nicht angelegt werden kann.
 */
export async function runCSource(
    code: string,
    fileName = 'program.c',
    options: CExecutionOptions = {}
): Promise<CExecutionResult> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pseudo2-c-source-'));
    const sourceFile = path.join(tempDir, sanitizeCFileName(fileName));
    try {
        await fs.writeFile(sourceFile, code, 'utf8');
        return await compileAndRunCFile(sourceFile, options);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

/**
 * @brief Kompiliert eine vorhandene C-Datei und startet anschließend das erzeugte Programm.
 *
 * Die Funktion wählt zuerst einen Compiler, erzeugt dessen plattformspezifische
 * Argumente und führt den Compiler mit einem festen Zeitlimit aus. Nur bei einer
 * erfolgreichen Kompilierung wird das Programm gestartet. Temporäre Pfade werden
 * aus allen zurückgegebenen Ausgaben entfernt und das Build-Verzeichnis wird stets
 * gelöscht.
 *
 * @param sourceFile Pfad zur zu kompilierenden C-Datei.
 * @param options Einstellungen für Compiler, Programmlaufzeit und Standardeingabe.
 * @return Strukturiertes Ergebnis mit Phase, Exitcode und getrennten Prozessausgaben.
 * @throws Error Wenn das temporäre Build-Verzeichnis nicht erstellt oder gelöscht werden kann.
 */
export async function compileAndRunCFile(
    sourceFile: string,
    options: CExecutionOptions = {}
): Promise<CExecutionResult> {
    const compiler = resolveCCompiler(options.compiler);
    if (!compiler) {
        return {
            ok: false,
            stage: 'compiler',
            exitCode: 127,
            stdout: '',
            stderr: options.compiler
                ? `Configured C compiler was not found: ${options.compiler}`
                : 'No C compiler found. Install GCC, Clang, or Visual Studio C++ Build Tools, or set PSEUDO2_C_COMPILER.'
        };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pseudo2-c-run-'));
    const executable = path.join(tempDir, process.platform === 'win32' ? 'program.exe' : 'program');
    const compileArgs = compilerArguments(compiler, path.resolve(sourceFile), executable, tempDir);

    try {
        const compileResult = await runProcess(compiler.command, compileArgs, {
            cwd: tempDir,
            env: compiler.env,
            timeoutMs: COMPILE_TIMEOUT_MS
        });
        const hiddenPaths = [path.resolve(sourceFile), executable, tempDir];
        const compileStdout = scrubPaths(compileResult.stdout, hiddenPaths);
        const compileStderr = scrubPaths(compileResult.stderr, hiddenPaths);

        if (compileResult.exitCode !== 0 || compileResult.timedOut) {
            return {
                ok: false,
                stage: 'compile',
                compiler: compiler.displayName,
                exitCode: compileResult.exitCode,
                stdout: '',
                stderr: compileStderr || compileStdout || 'C compilation failed.',
                compileStdout,
                compileStderr,
                timedOut: compileResult.timedOut
            };
        }

        const runResult = await runProcess(executable, [], {
            cwd: tempDir,
            timeoutMs: normalizeTimeout(options.timeoutMs),
            stdin: options.stdin
        });
        return {
            ok: runResult.exitCode === 0 && !runResult.timedOut,
            stage: 'run',
            compiler: compiler.displayName,
            exitCode: runResult.exitCode,
            stdout: scrubPaths(runResult.stdout, hiddenPaths),
            stderr: scrubPaths(runResult.stderr, hiddenPaths),
            compileStdout,
            compileStderr,
            timedOut: runResult.timedOut
        };
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

/**
 * @brief Prüft einen konkreten Compilerbefehl durch einen kurzen synchronen Testaufruf.
 *
 * Für MSVC wird die Hilfeoption `/?`, für GNU-kompatible Compiler `--version`
 * verwendet. Der Test zeigt kein Konsolenfenster und verwirft sämtliche Ausgaben.
 *
 * @param command Zu prüfender Compilerbefehl oder Compilerpfad.
 * @return Compilerbeschreibung bei erfolgreichem Prozessstart, sonst `undefined`.
 */
function resolveDirectCompiler(command: string): CCompiler | undefined {
    const kind = compilerKind(command);
    const probe = spawnSync(command, kind === 'msvc' ? ['/?'] : ['--version'], {
        encoding: 'utf8',
        stdio: 'ignore',
        windowsHide: true
    });
    if (probe.error) return undefined;
    return {
        command,
        displayName: compilerDisplayName(command, kind),
        kind
    };
}

/**
 * @brief Sucht unter Windows die neueste Visual-Studio-C++-Toolchain.
 *
 * `vswhere.exe` liefert den Installationspfad. Anschließend wird die von
 * `VsDevCmd.bat` erzeugte Umgebung geladen und `cl.exe` zur Kontrolle gestartet.
 *
 * @return Vollständig konfigurierte MSVC-Beschreibung oder `undefined` bei fehlender Installation.
 */
function resolveVisualStudioCompiler(): CCompiler | undefined {
    const vswhere = path.join(
        process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
        'Microsoft Visual Studio',
        'Installer',
        'vswhere.exe'
    );
    const query = spawnSync(vswhere, [
        '-latest',
        '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'installationPath'
    ], {
        encoding: 'utf8',
        windowsHide: true
    });
    const installationPath = query.stdout?.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (query.error || !installationPath) return undefined;

    const vsDevCmd = path.join(installationPath, 'Common7', 'Tools', 'VsDevCmd.bat');
    const environment = loadVisualStudioEnvironment(vsDevCmd);
    if (!environment) return undefined;

    const probe = spawnSync('cl.exe', ['/?'], {
        env: environment,
        stdio: 'ignore',
        windowsHide: true
    });
    if (probe.error) return undefined;
    return {
        command: 'cl.exe',
        displayName: 'MSVC cl',
        kind: 'msvc',
        env: environment
    };
}

/**
 * @brief Liest die von `VsDevCmd.bat` gesetzten Visual-Studio-Umgebungsvariablen ein.
 *
 * Die Batchdatei wird in einem ausgeblendeten `cmd.exe` aufgerufen. Ihre Ausgabe
 * von `set` wird zeilenweise in eine Kopie der aktuellen Node-Prozessumgebung übernommen.
 *
 * @param vsDevCmd Absoluter Pfad zu `VsDevCmd.bat`.
 * @return Erweiterte Prozessumgebung oder `undefined`, wenn die Batchdatei fehlschlägt.
 */
function loadVisualStudioEnvironment(vsDevCmd: string): NodeJS.ProcessEnv | undefined {
    const result = spawnSync(
        process.env.ComSpec ?? 'cmd.exe',
        ['/d', '/s', '/c', `call "${vsDevCmd}" -no_logo -arch=x64 -host_arch=x64 >nul && set`],
        {
            encoding: 'utf8',
            windowsHide: true,
            windowsVerbatimArguments: true,
            maxBuffer: 4 * 1024 * 1024
        }
    );
    if (result.error || result.status !== 0) return undefined;

    const environment: NodeJS.ProcessEnv = { ...process.env };
    for (const line of result.stdout.split(/\r?\n/)) {
        const separator = line.indexOf('=');
        if (separator <= 0) continue;
        environment[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return environment;
}

/**
 * @brief Erzeugt die zur Compilerfamilie passenden Argumente für eine C11-Kompilierung.
 * @param compiler Ausgewählter Compiler samt Compilerfamilie.
 * @param sourceFile Absoluter Pfad zur C-Quelldatei.
 * @param executable Zielpfad des zu erzeugenden Programms.
 * @param tempDir Verzeichnis für temporäre MSVC-Objektdateien.
 * @return Argumentliste für `cl.exe` oder einen GNU-kompatiblen Compiler.
 */
function compilerArguments(compiler: CCompiler, sourceFile: string, executable: string, tempDir: string): string[] {
    if (compiler.kind === 'msvc') {
        return [
            '/nologo',
            '/TC',
            '/std:c11',
            sourceFile,
            `/Fo:${path.join(tempDir, 'program.obj')}`,
            `/Fe:${executable}`
        ];
    }
    return ['-std=c11', '-O0', sourceFile, '-o', executable, '-lm'];
}

/**
 * @brief Leitet aus dem Befehlsnamen die MSVC- oder GNU-kompatible Argumentfamilie ab.
 * @param command Compilerbefehl oder Compilerpfad.
 * @return `msvc` für `cl` und `clang-cl`, andernfalls `gnu`.
 */
function compilerKind(command: string): CCompilerKind {
    const name = path.basename(command).toLowerCase();
    return name === 'cl' || name === 'cl.exe' || name.startsWith('clang-cl') ? 'msvc' : 'gnu';
}

/**
 * @brief Erzeugt einen kurzen, pfadunabhängigen Namen für Status- und Fehlerausgaben.
 * @param command Compilerbefehl oder Compilerpfad.
 * @param kind Erkannte Compilerfamilie.
 * @return `MSVC cl` für Microsofts Compiler, sonst der Dateiname ohne `.exe`.
 */
function compilerDisplayName(command: string, kind: CCompilerKind): string {
    const name = path.basename(command).replace(/\.exe$/i, '');
    if (kind === 'msvc' && name.toLowerCase() === 'cl') return 'MSVC cl';
    return name;
}

/**
 * @brief Startet einen Prozess mit Zeitlimit und begrenzter Ausgabeerfassung.
 *
 * Standardausgabe und Fehlerausgabe werden getrennt gesammelt. Beim Ablauf des
 * Zeitlimits wird der Prozess beendet und Exitcode 124 zurückgegeben. Ein
 * Startfehler wird genau einmal in ein Ergebnis mit Exitcode 1 umgewandelt.
 *
 * @param command Auszuführender Befehl.
 * @param args Unverändert zu übergebende Prozessargumente.
 * @param options Arbeitsverzeichnis, Umgebung, Zeitlimit und optionale Standardeingabe.
 * @return Promise mit Exitcode, Ausgaben und Zeitüberschreitungsstatus.
 */
function runProcess(
    command: string,
    args: string[],
    options: {
        /** @brief Arbeitsverzeichnis, in dem der Prozess gestartet wird. */
        cwd: string;
        /** @brief Optional vollständig vorbereitete Prozessumgebung. */
        env?: NodeJS.ProcessEnv;
        /** @brief Maximale Prozesslaufzeit in Millisekunden. */
        timeoutMs: number;
        /** @brief Optional an den Prozess zu sendende Standardeingabe. */
        stdin?: string;
    }
): Promise<ProcessResult> {
    return new Promise(resolve => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            windowsHide: true
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;

        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, options.timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout = appendCaptured(stdout, chunk.toString('utf8'));
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr = appendCaptured(stderr, chunk.toString('utf8'));
        });
        child.on('error', error => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({
                exitCode: 1,
                stdout,
                stderr: appendCaptured(stderr, `${stderr ? '\n' : ''}${error.message}`),
                timedOut
            });
        });
        child.on('close', code => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({
                exitCode: timedOut ? 124 : (code ?? 1),
                stdout,
                stderr,
                timedOut
            });
        });

        if (options.stdin !== undefined) child.stdin.end(options.stdin);
        else child.stdin.end();
    });
}

/**
 * @brief Hängt Prozessausgabe bis zur konfigurierten Byteobergrenze an.
 *
 * Die Grenze wird in UTF-8-Bytes statt Zeichen gemessen. Überschüssige Ausgabe
 * wird abgeschnitten und einmalig mit einem sichtbaren Hinweis markiert.
 *
 * @param current Bereits erfasster Ausgabetext.
 * @param next Neu empfangener Ausgabetext.
 * @return Zusammengeführte, gegebenenfalls gekürzte Ausgabe.
 */
function appendCaptured(current: string, next: string): string {
    if (Buffer.byteLength(current, 'utf8') >= MAX_CAPTURE_BYTES) return current;
    const combined = current + next;
    if (Buffer.byteLength(combined, 'utf8') <= MAX_CAPTURE_BYTES) return combined;
    return `${Buffer.from(combined, 'utf8').subarray(0, MAX_CAPTURE_BYTES).toString('utf8')}\n[output truncated]`;
}

/**
 * @brief Ersetzt interne absolute Pfade in Prozessausgaben durch ihre Dateinamen.
 * @param value Zu bereinigende Compiler- oder Programmausgabe.
 * @param paths Interne Quell-, Programm- und Verzeichnispfade.
 * @return Ausgabe ohne Offenlegung der übergebenen absoluten Pfade.
 */
function scrubPaths(value: string, paths: string[]): string {
    return paths.reduce((result, candidate) => {
        if (!candidate) return result;
        return result.replaceAll(candidate, path.basename(candidate));
    }, value);
}

/**
 * @brief Wandelt einen vorgeschlagenen Namen in einen sicheren C-Dateinamen um.
 * @param fileName Vorgeschlagener Name, der auch Pfadanteile enthalten darf.
 * @return Basename mit erlaubten Zeichen und garantierter Dateiendung `.c`.
 */
function sanitizeCFileName(fileName: string): string {
    const baseName = path.basename(fileName).replace(/[^a-zA-Z0-9_.-]/g, '_');
    return baseName.endsWith('.c') ? baseName : `${baseName || 'program'}.c`;
}

/**
 * @brief Normalisiert ein optionales positives Laufzeitlimit.
 * @param timeoutMs Gewünschtes Zeitlimit in Millisekunden.
 * @return Abgerundeter positiver Wert oder das Standardzeitlimit.
 */
function normalizeTimeout(timeoutMs: number | undefined): number {
    return Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0 ? Math.floor(timeoutMs as number) : DEFAULT_RUN_TIMEOUT_MS;
}
