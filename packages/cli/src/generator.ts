import type { Program, Instruction } from 'pseudo2-language';
import { expandToNode, toString } from 'langium/generate';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './util.js';

// Optional: falls dein generated/ast Typeguards exportiert (meist ja)
import { isBracedBlock, isIndentedBlock } from 'pseudo2-language';

export function generate(programAst: Program, filePath: string, destination: string | undefined): string {
    const data = extractDestinationAndName(filePath, destination);
    const generatedFilePath = `${path.join(data.destination, data.name)}.js`;

    // Step 1: Wir generieren erstmal nur ein leer laufendes JS-File + Kommentar,
    // aber traversieren die AST-Struktur, damit Block "komplett funktioniert".
    const fileNode = expandToNode`
        "use strict";

        // Pseudo2 generator (Step 1: blocks only)
        ${programAst.instructions.map(i => genInstruction(i)).join('')}
    `.appendNewLineIfNotEmpty();

    if (!fs.existsSync(data.destination)) {
        fs.mkdirSync(data.destination, { recursive: true });
    }
    fs.writeFileSync(generatedFilePath, toString(fileNode));
    return generatedFilePath;
}

function genInstruction(i: Instruction, indent = ''): string {
    // Block-Handling: BracedBlock / IndentedBlock in deinem AST
    if (isBracedBlock(i)) return genBracedBlock(i, indent);
    if (isIndentedBlock(i)) return genIndentedBlock(i, indent);

    // Step 1: andere Instructions existieren noch nicht / werden später ergänzt
    return `${indent}// TODO: instruction\n`;
}

function genBracedBlock(b: any, indent = ''): string {
    let out = `${indent}{\n`;
    const inner = indent + '  ';
    for (const instr of b.instructions ?? []) {
        out += genInstruction(instr, inner);
    }
    out += `${indent}}\n`;
    return out;
}

function genIndentedBlock(b: any, indent = ''): string {
    // IndentedBlock hat auch instructions, nur anderer Node-Typ
    let out = `${indent}{\n`;
    const inner = indent + '  ';
    for (const instr of b.instructions ?? []) {
        out += genInstruction(instr, inner);
    }
    out += `${indent}}\n`;
    return out;
}
