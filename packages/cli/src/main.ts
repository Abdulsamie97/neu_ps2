import type { Program } from 'pseudo2-language';
import { createPseudo2Services, Pseudo2LanguageMetaData } from 'pseudo2-language';
import chalk from 'chalk';
import { Command } from 'commander';
import { extractAstNode } from './util.js';
import { generate } from './generator.js';
import { NodeFileSystem } from 'langium/node';
import * as url from 'node:url';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runVeriFast } from './verifast.js';
import { generateC } from './generator-c.js';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageContent = await fs.readFile(packagePath, 'utf-8');
const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_VERIFAST_EXE = path.join(workspaceRoot, 'verifast-26.01', 'bin', 'verifast.exe');

export type GenerateOptions = {
    destination?: string;
    js?: boolean;
    graphviz?: boolean;
    onlyJs?: boolean;
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
        emitGraphviz: opts.onlyJs ? false : opts.graphviz !== false,
        graphvizKinds: selectedGraphvizKinds(opts)
    });
    console.log(chalk.green(`Generated ${writtenFiles.length} file(s): ${writtenFiles.join(', ')}`));
};

export const generateCAction = async (fileName: string, opts: { destination?: string }): Promise<void> => {
    const services = createPseudo2Services(NodeFileSystem).Pseudo2;
    const programAst = await extractAstNode<Program>(fileName, services);
    const generatedFilePath = generateC(programAst, fileName, opts.destination);
    console.log(chalk.green(`C code generated successfully: ${generatedFilePath}`));
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
        .option('--ast', 'write AST Graphviz artifact')
        .option('--dep', 'write dependency Graphviz artifact')
        .option('--cfg', 'write CFG Graphviz artifacts')
        .description('generates code from a Pseudo2 source file')
        .action(generateAction);


    program
        .command('verifast')
        .argument('<file>', 'C file to verify (e.g. out/generated.c)')
        .option('--vf <path>', 'path to verifast.exe; defaults to VERIFAST_EXE or repo-local verifast-26.01')
        .option('--extra <args...>', 'extra args passed to verifast (optional)')
        .option('--link', 'enable VeriFast link checking; default verifies generated C only with -c')
        .description('runs VeriFast on a C file and prints JSON result')
        .action(async (file: string, opts: { vf?: string; extra?: string[]; link?: boolean }) => {
            const verifastExe = opts.vf ?? process.env.VERIFAST_EXE ?? DEFAULT_VERIFAST_EXE;
            try {
                await fs.access(verifastExe);
            } catch {
                console.error(
                    JSON.stringify({
                        ok: false,
                        error:
                            `VeriFast executable not found: ${verifastExe}. Use --vf <path>, set VERIFAST_EXE, or place VeriFast at ${DEFAULT_VERIFAST_EXE}.`,
                    })
                );
                process.exit(2);
            }

            const result = await runVeriFast({
                verifastExe,
                file,
                extraArgs: opts.extra ?? [],
                compileOnly: opts.link !== true,
            });

            // JSON auf stdout (ideal für Web-UI)
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.ok ? 0 : 1);
        });

        program
            .command('generate-c')
            .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
            .option('-d, --destination <dir>', 'destination directory of generating')
            .description('generates VeriFast-ready C code from a Pseudo2 source file')
            .action(generateCAction);
        program.parse(process.argv);
}

function selectedGraphvizKinds(opts: GenerateOptions): Array<'ast' | 'dep' | 'cfg'> | undefined {
    const selected: Array<'ast' | 'dep' | 'cfg'> = [];
    if (opts.ast) selected.push('ast');
    if (opts.dep) selected.push('dep');
    if (opts.cfg) selected.push('cfg');
    return selected.length > 0 ? selected : undefined;
}
