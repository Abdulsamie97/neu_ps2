/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

import { LogLevel } from '@codingame/monaco-vscode-api';
import { ConsoleLogger } from 'monaco-languageclient/common';
import { EditorApp } from 'monaco-languageclient/editorApp';
import { BrowserMessageReader, BrowserMessageWriter } from 'vscode-languageclient/browser.js';
import text from '../resources/default.input?raw';
import { disableElement } from './common/client/utils.js';
import { createLangiumGlobalConfig } from './config/dslConfig.js';
import workerUrl from './worker/dsl-server?worker&url';
import { MonacoVscodeApiWrapper } from 'monaco-languageclient/vscodeApiWrapper';
import { LanguageClientWrapper } from 'monaco-languageclient/lcwrapper';
import { EmptyFileSystem, URI } from 'langium';

import {
    createPseudo2Services,
    generateProgram,
    getSummaryFromCode,
    type Program
} from 'pseudo2-language'; //TBC


let editorApp: EditorApp | undefined;
let lcWrapper: LanguageClientWrapper;
let executionDocCounter = 0;
let executionServices: ReturnType<typeof createPseudo2Services> | undefined;

const startEditor = async () => {
    disableElement('button-start', true);
    disableElement('button-dispose', false);



    const worker = loadWorkerRegular();
    const reader = new BrowserMessageReader(worker);
    const writer = new BrowserMessageWriter(worker);
    const logger = new ConsoleLogger(LogLevel.Off);
    reader.listen((message) => {
        logger.info('Received message from worker:', message);
    });


    const htmlContainer = document.getElementById('monaco-editor-root')!;
    // the configuration does not contain any text content
    const appConfig = createLangiumGlobalConfig({
        languageServerId: 'first',
        codeContent: {
            text,
            uri: '/workspace/example.pseudo2'   //TBC  (suffix might be important)
        },
        worker,
        messageTransports: { reader, writer },
        htmlContainer
    });

    // appConfig.languageClientConfig.enforceDispose = disposeLcState;

    editorApp = new EditorApp(appConfig.editorAppConfig);

    // perform global monaco-vscode-api init
    const apiWrapper = new MonacoVscodeApiWrapper(appConfig.vscodeApiConfig);
    await apiWrapper.start();

    // init language client
    lcWrapper = new LanguageClientWrapper(appConfig.languageClientConfig);
    await lcWrapper.start();

    // run editorApp
    await editorApp.start(htmlContainer);


};



const disposeEditor = async () => {
    disableElement('button-start', false);
    disableElement('button-dispose', true);

    lcWrapper.dispose();

    editorApp?.reportStatus();
    await editorApp?.dispose();
    console.log(editorApp?.reportStatus().join('\n'));

};

const updateSummary = async () => {
    //TODO: make it nicer
    const sumelem = document.querySelector("#summaryspan");
    if (sumelem != null) {
        const sum = await getSummaryFromCode(getCurrentCode());
        sumelem.textContent = sum;
    }
};

const updateCode = async () => {
    //TODO: make it nicer
    const codeelem = document.querySelector("#codespan");
    if (codeelem != null) {
        // const currentCode = (editorApp?.getEditor()?.getModel()?.getValue() ?? "Default code");
        const currentCode = getCurrentCode();
        codeelem.textContent = currentCode;
    }
};

const updateExecution = async () => {
    setTextContent('#exespan', 'Running...');
    setTextContent('#generatedspan', '');

    if (!editorApp?.getEditor()) {
        setTextContent('#exespan', 'Editor is not started yet.');
        return;
    }

    const currentCode = getCurrentCode();
    if (currentCode.trim().length === 0) {
        setTextContent('#exespan', 'No Pseudo2 code to execute.');
        return;
    }

    try {
        const { program, errors } = await parsePseudo2(currentCode);
        if (errors.length > 0 || !program) {
            setTextContent('#exespan', `Validation failed:\n${errors.join('\n')}`);
            return;
        }

        const generatedCode = generateProgram(program);
        setTextContent('#generatedspan', generatedCode);

        const result = executeJavaScript(generatedCode);
        const output = result.output.length > 0 ? result.output.join('\n') : '(no output)';
        const runtimeError = result.error ? `\nRuntime error:\n${result.error}` : '';
        setTextContent('#exespan', `${output}${runtimeError}`);
    } catch (error) {
        setTextContent('#exespan', `Execution failed:\n${formatError(error)}`);
    }
};

function getCurrentCode(): string {
    return editorApp?.getEditor()?.getModel()?.getValue() ?? "";
}

function getExecutionServices(): ReturnType<typeof createPseudo2Services> {
    executionServices ??= createPseudo2Services(EmptyFileSystem);
    return executionServices;
}

async function parsePseudo2(code: string): Promise<{ program?: Program; errors: string[] }> {
    const services = getExecutionServices();
    const documentFactory = services.shared.workspace.LangiumDocumentFactory;
    const documentBuilder = services.shared.workspace.DocumentBuilder;
    const uri = URI.parse(`memory:/web-execute-${executionDocCounter++}.pseudo2`);
    const document = documentFactory.fromString(code, uri);

    await documentBuilder.build([document], { validation: true });

    const errors = (document.diagnostics ?? [])
        .filter(diagnostic => diagnostic.severity === 1)
        .map(diagnostic => {
            const line = diagnostic.range.start.line + 1;
            const character = diagnostic.range.start.character + 1;
            return `Line ${line}, column ${character}: ${diagnostic.message}`;
        });

    if (errors.length > 0) {
        return { errors };
    }

    return {
        program: document.parseResult.value as Program,
        errors: []
    };
}

function executeJavaScript(source: string): { output: string[]; error?: string } {
    const output: string[] = [];
    const capturedConsole = {
        log: (...args: unknown[]) => output.push(args.map(formatValue).join(' ')),
        warn: (...args: unknown[]) => output.push(args.map(formatValue).join(' ')),
        error: (...args: unknown[]) => output.push(args.map(formatValue).join(' '))
    };

    try {
        const runner = new Function('console', `"use strict";\n${source}`);
        runner(capturedConsole);
        return { output };
    } catch (error) {
        return {
            output,
            error: formatError(error)
        };
    }
}

function formatValue(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof Error) {
        return `${value.name}: ${value.message}`;
    }
    if (value === undefined) {
        return 'undefined';
    }

    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return formatValue(error);
}

function setTextContent(selector: string, textContent: string): void {
    const element = document.querySelector(selector);
    if (element) {
        element.textContent = textContent;
    }
}


export const runDsl = async () => {
    try {
        document.querySelector('#button-start')?.addEventListener('click', startEditor);
        document.querySelector('#button-dispose')?.addEventListener('click', disposeEditor);
        document.querySelector('#button-summary')?.addEventListener('click', updateSummary);
        document.querySelector('#button-code')?.addEventListener('click', updateCode);
        document.querySelector('#button-execute')?.addEventListener('click', updateExecution);

    } catch (e) {
        console.error(e);
    }
};


const loadWorkerRegular = () => {
    // Language Server preparation
    console.log(`Langium worker URL: ${workerUrl}`);
    return new Worker(workerUrl, {
        type: 'module',
        name: 'Pseudo2 Server Regular',  //TBC
    });
};


