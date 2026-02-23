import type { Program } from './generated/ast.js';

/**
 * Step 1: Block-only generator.
 * For now we just return an empty string so the project builds.
 * Later we will generate real output (e.g., VeriFast C/Java).
 */
export function generateProgram(_program: Program): string {
  return '';
}



/*import type { Model } from './generated/ast.js';
import { createPseudo2Services } from './pseudo2-module.js';
import { EmptyFileSystem } from 'langium';
import { isModel } from './generated/ast.js';
import { parseHelper } from 'langium/test';


export function getSummary(model: Model): string {
    const greetings = model.greetings.map(greeting => greeting.person.ref?.name ?? 'unknown').join(', ');
    return `Model with ${model.greetings.length} greeting(s) to: ${greetings}`;
}

export const getSummaryFromCode = async (code: string) => {
    const model = await parseTextToModel(code);

    if (!isModel(model)) {
        throw new Error('Invalid Model.');
    }

    return getSummary(model);
}


async function parseTextToModel(text: string): Promise<Model> {
    // 1. Create the language services
    const services = createPseudo2Services(EmptyFileSystem).Pseudo2; // Use the correct language name property

    // 2. Get the parse helper configured for your Model type
    const parse = parseHelper<Model>(services);

    // 3. Parse the text
    const document = await parse(text);

    // 4. Return the resulting AST model
    const model = document.parseResult.value;
    return model;
}
*/