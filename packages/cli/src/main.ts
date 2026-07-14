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

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageContent = await fs.readFile(packagePath, 'utf-8');
const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_VERIFAST_EXE = path.join(workspaceRoot, 'verifast-26.01', 'bin', 'verifast.exe');
const VERIFIED_RUNTIME_FILES = [
    path.join(workspaceRoot, 'runtime', 'c', 'pseudo2_heap_runtime.c'),
    path.join(workspaceRoot, 'runtime', 'c', 'pseudo2_scalar_runtime.c')
];

export type GenerateOptions = {
    destination?: string;
    js?: boolean;
    graphviz?: boolean;
    onlyJs?: boolean;
    pretty?: boolean;
    ast?: boolean;
    dep?: boolean;
    cfg?: boolean;
}

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

export type GenerateCActionOptions = {
    destination?: string;
    runtime?: string;
};

export type RunCOptions = {
    cc?: string;
    timeout?: string;
};

export const generateCAction = async (fileName: string, opts: GenerateCActionOptions): Promise<void> => {
    const services = createPseudo2Services(NodeFileSystem).Pseudo2;
    const programAst = await extractAstNode<Program>(fileName, services);
    const generatedFilePath = generateC(programAst, fileName, {
        destination: opts.destination,
        runtime: parseCRuntime(opts.runtime)
    });
    console.log(chalk.green(`C code generated successfully: ${generatedFilePath}`));
};

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

export const generatePrettyAction = async (fileName: string, opts: { destination?: string }): Promise<void> => {
    const services = createPseudo2Services(NodeFileSystem).Pseudo2;
    const programAst = await extractAstNode<Program>(fileName, services);
    const generatedFilePath = generatePretty(programAst, fileName, opts.destination);
    console.log(chalk.green(`Braced Pseudo2 generated successfully: ${generatedFilePath}`));
};

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
        .option('--link', 'enable VeriFast link checking; default verifies generated C only with -c')
        .option('--no-runtime', 'skip verification of the repo-local concrete runtime kernels')
        .description('runs VeriFast on a C file and prints JSON result')
        .action(async (file: string, opts: { vf?: string; extra?: string[]; link?: boolean; runtime?: boolean }) => {
            const verifastExe = opts.vf ?? DEFAULT_VERIFAST_EXE;
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
                })
                : await runVeriFast({
                    verifastExe,
                    file,
                    extraArgs: opts.extra ?? [],
                    compileOnly: opts.link !== true,
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

function selectedGraphvizKinds(opts: GenerateOptions): Array<'ast' | 'dep' | 'cfg'> | undefined {
    const selected: Array<'ast' | 'dep' | 'cfg'> = [];
    if (opts.ast) selected.push('ast');
    if (opts.dep) selected.push('dep');
    if (opts.cfg) selected.push('cfg');
    return selected.length > 0 ? selected : undefined;
}

function parseCRuntime(value: string | undefined): 'contracts' | 'implementation' {
    if (value === undefined || value === 'contracts') return 'contracts';
    if (value === 'implementation') return 'implementation';
    throw new Error(`Unsupported C runtime mode "${value}". Use "contracts" or "implementation".`);
}

function parseTimeout(value: string | undefined): number {
    const timeout = Number(value ?? 10_000);
    if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new Error(`Invalid C execution timeout: ${value}`);
    }
    return Math.floor(timeout);
}
