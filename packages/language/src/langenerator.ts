import type { Block, IfStatement, Instruction, Program } from './generated/ast.js';
import { isBlock, isIfStatement } from './generated/ast.js';

export function generateProgram(program: Program): string {
    return program.instructions.map(instruction => generateInstruction(instruction)).join('\n');
}

function generateInstruction(instruction: Instruction, indent = 0): string {
    if (isBlock(instruction)) {
        return generateBlock(instruction, indent);
    }

    if (isIfStatement(instruction)) {
        return generateIfStatement(instruction, indent);
    }

    return '';
}

function generateBlock(block: Block, indent = 0): string {
    const padding = ' '.repeat(indent);

    if (block.instructions.length === 0) {
        return `${padding}{}`;
    }

    const nested = block.instructions
        .map(instruction => generateInstruction(instruction, indent + 2))
        .join('\n');

    return `${padding}{\n${nested}\n${padding}}`;
}

function generateIfStatement(ifStatement: IfStatement, indent = 0): string {
    const padding = ' '.repeat(indent);
    const condition = ifStatement.condition.value;
    const thenBlock = generateBlock(ifStatement.thenBlock, indent + 2);
    const elsePart = ifStatement.elseBlock
        ? `\n${padding}else\n${generateBlock(ifStatement.elseBlock, indent + 2)}`
        : '';

    return `${padding}if ${condition} then\n${thenBlock}${elsePart}\n${padding}end`;
}
