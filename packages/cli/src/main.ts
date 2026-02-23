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

    program.parse(process.argv);
}
