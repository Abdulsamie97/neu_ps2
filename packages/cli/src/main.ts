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

export type GenerateOptions = {
    destination?: string;
}

export const generateAction = async (fileName: string, opts: GenerateOptions): Promise<void> => {
    const services = createPseudo2Services(NodeFileSystem).Pseudo2;
    const programAst = await extractAstNode<Program>(fileName, services);
    const generatedFilePath = generate(programAst, fileName, opts.destination);
    console.log(chalk.green(`Code generated successfully: ${generatedFilePath}`));
};

export default function(): void {
    const program = new Command();

    program.version(JSON.parse(packageContent).version);

    const fileExtensions = Pseudo2LanguageMetaData.fileExtensions.join(', ');
    program
        .command('generate')
        .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
        .option('-d, --destination <dir>', 'destination directory of generating')
        .description('generates code from a Pseudo2 source file')
        .action(generateAction);


    program
        .command('verifast')
        .argument('<file>', 'C file to verify (e.g. out/generated.c)')
        .option('--vf <path>', 'path to verifast.exe (or use VERIFAST_EXE env var)')
        .option('--extra <args...>', 'extra args passed to verifast (optional)')
        .description('runs VeriFast on a C file and prints JSON result')
        .action(async (file: string, opts: { vf?: string; extra?: string[] }) => {
            const verifastExe = opts.vf ?? process.env.VERIFAST_EXE;
            if (!verifastExe) {
            console.error(
                JSON.stringify({
                ok: false,
                error:
                    'Missing verifast path. Use --vf <path> or set VERIFAST_EXE.',
                })
            );
            process.exit(2);
            }

            const result = await runVeriFast({
            verifastExe,
            file,
            extraArgs: opts.extra ?? [],
            });

            // JSON auf stdout (ideal für Web-UI)
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.ok ? 0 : 1);
        });

    program
            .command('generate-c')
            .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
            .option('-d, --destination <dir>', 'destination directory of generating')
            .description('generates C code (VeriFast-ready, v0 supports only blocks)')
            .action(async (fileName: string, opts: { destination?: string }) => {
                const services = createPseudo2Services(NodeFileSystem).Pseudo2;
                const programAst = await extractAstNode<Program>(fileName, services);

                const generatedFilePath = generateC(programAst, fileName, opts.destination);
                console.log(chalk.green(`C code generated successfully: ${generatedFilePath}`));
            });
        program.parse(process.argv);
}
