import { readFile, writeFile } from 'node:fs/promises';

const syntaxFile = new URL('../syntaxes/pseudo2.tmLanguage.json', import.meta.url);
const syntax = JSON.parse(await readFile(syntaxFile, 'utf8'));
const comments = syntax.repository?.comments?.patterns;
if (!Array.isArray(comments)) {
    throw new Error('Generated Pseudo2 TextMate grammar has no comment patterns.');
}

// Langium's TextMate generator misreads the (?!@) lookahead in SL_COMMENT as a literal @.
if (!comments.some(pattern => pattern.begin === '//(?!@)')) {
    comments.unshift({
        name: 'comment.line.pseudo2',
        begin: '//(?!@)',
        beginCaptures: {
            0: { name: 'punctuation.definition.comment.pseudo2' }
        },
        end: '(?=$)'
    });
    await writeFile(syntaxFile, `${JSON.stringify(syntax, null, 2)}\n`);
}
