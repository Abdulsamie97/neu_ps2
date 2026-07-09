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
    generateCProgram,
    generateProgram,
    getSummaryFromCode,
    type Program
} from 'pseudo2-language'; //TBC


let editorApp: EditorApp | undefined;
let lcWrapper: LanguageClientWrapper;
let executionDocCounter = 0;
let executionServices: ReturnType<typeof createPseudo2Services> | undefined;
let lastGeneratedCCode = '';

const DEFAULT_VERIFAST_EXE = '.\\verifast-26.01\\bin\\verifast.exe';

type SaveFilePicker = (options: {
    suggestedName?: string;
    types?: Array<{
        description: string;
        accept: Record<string, string[]>;
    }>;
}) => Promise<{
    name: string;
    createWritable: () => Promise<{
        write: (data: BlobPart) => Promise<void>;
        close: () => Promise<void>;
    }>;
}>;

type VeriFastApiResult = {
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    errors?: Array<{
        file: string;
        line: number;
        colFrom: number;
        colTo: number;
        kind: 'error' | 'note';
        message: string;
    }>;
    file?: string;
    command?: string;
    verifastExe?: string;
};

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

const saveCurrentCode = async () => {
    if (!editorApp?.getEditor()) {
        setSaveStatus('Start the editor before saving.');
        return;
    }

    const currentCode = getCurrentCode();
    const suggestedName = getSuggestedFileName();

    try {
        const saveFilePicker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
        if (saveFilePicker) {
            const fileHandle = await saveFilePicker({
                suggestedName,
                types: [
                    {
                        description: 'Pseudo2 file',
                        accept: {
                            'text/plain': ['.pseudo2']
                        }
                    }
                ]
            });
            const writable = await fileHandle.createWritable();
            await writable.write(currentCode);
            await writable.close();
            setSaveStatus(`Saved: ${fileHandle.name}`);
            return;
        }

        downloadCode(currentCode, suggestedName);
        setSaveStatus(`Downloaded: ${suggestedName}`);
    } catch (error) {
        if (isAbortError(error)) {
            setSaveStatus('Save canceled.');
            return;
        }
        setSaveStatus(`Save failed: ${formatError(error)}`);
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

const updateCGeneration = async () => {
    setTextContent('#cspan', 'Generating C...');
    setTextContent('#verifastspan', '');
    lastGeneratedCCode = '';

    if (!editorApp?.getEditor()) {
        setTextContent('#cspan', 'Editor is not started yet.');
        return;
    }

    const currentCode = getCurrentCode();
    if (currentCode.trim().length === 0) {
        setTextContent('#cspan', 'No Pseudo2 code to generate.');
        return;
    }

    try {
        const { program, errors } = await parsePseudo2(currentCode);
        if (errors.length > 0 || !program) {
            setTextContent('#cspan', `Validation failed:\n${errors.join('\n')}`);
            return;
        }

        lastGeneratedCCode = generateCProgram(program);
        setTextContent('#cspan', lastGeneratedCCode);
        setTextContent('#verifastspan', buildVeriFastHelp(getSuggestedCFileName()));
    } catch (error) {
        setTextContent('#cspan', `C generation failed:\n${formatError(error)}`);
    }
};

const runVeriFastFromWeb = async () => {
    if (!lastGeneratedCCode) {
        await updateCGeneration();
    }

    if (!lastGeneratedCCode) {
        setTextContent('#verifastspan', 'No C code generated.');
        return;
    }

    setTextContent('#verifastspan', 'Running VeriFast...');

    try {
        const response = await fetch('/api/verifast', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                code: lastGeneratedCCode,
                fileName: getSuggestedCFileName()
            })
        });
        const text = await response.text();
        const result = JSON.parse(text) as VeriFastApiResult;

        if (!response.ok) {
            setTextContent('#verifastspan', `VeriFast request failed (${response.status}):\n${formatValue(result)}`);
            return;
        }

        setTextContent('#verifastspan', formatVeriFastResult(result));
    } catch (error) {
        setTextContent('#verifastspan', [
            `VeriFast request failed: ${formatError(error)}`,
            '',
            buildVeriFastHelp(getSuggestedCFileName())
        ].join('\n'));
    }
};

const saveCurrentCCode = async () => {
    if (!lastGeneratedCCode) {
        await updateCGeneration();
    }

    if (!lastGeneratedCCode) {
        setSaveStatus('No C code generated.');
        return;
    }

    const suggestedName = getSuggestedCFileName();

    try {
        const saveFilePicker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
        if (saveFilePicker) {
            const fileHandle = await saveFilePicker({
                suggestedName,
                types: [
                    {
                        description: 'C file',
                        accept: {
                            'text/plain': ['.c']
                        }
                    }
                ]
            });
            const writable = await fileHandle.createWritable();
            await writable.write(lastGeneratedCCode);
            await writable.close();
            setSaveStatus(`Saved: ${fileHandle.name}`);
            setTextContent('#verifastspan', buildVeriFastHelp(fileHandle.name));
            return;
        }

        downloadCode(lastGeneratedCCode, suggestedName);
        setSaveStatus(`Downloaded: ${suggestedName}`);
        setTextContent('#verifastspan', buildVeriFastHelp(suggestedName));
    } catch (error) {
        if (isAbortError(error)) {
            setSaveStatus('Save canceled.');
            return;
        }
        setSaveStatus(`Save failed: ${formatError(error)}`);
    }
};

function getCurrentCode(): string {
    return editorApp?.getEditor()?.getModel()?.getValue() ?? "";
}

function getSuggestedFileName(): string {
    const path = editorApp?.getEditor()?.getModel()?.uri?.path ?? '';
    const parts = path.split('/').filter(Boolean);
    const fileName = parts[parts.length - 1] ?? '';
    return fileName.endsWith('.pseudo2') ? fileName : 'program.pseudo2';
}

function getSuggestedCFileName(): string {
    return getSuggestedFileName().replace(/\.pseudo2$/i, '.c');
}

function buildVeriFastHelp(cFileName: string): string {
    const outFile = `.\\out\\${cFileName}`;
    return [
        'Run VeriFast uses the local Vite/Node endpoint /api/verifast.',
        'If the web app is served without that endpoint, use the CLI fallback below.',
        '',
        'Generate and verify from PowerShell:',
        `npm run build`,
        `node .\\packages\\cli\\bin\\cli.js generate-c .\\examples\\test1.pseudo2 -d .\\out`,
        `node .\\packages\\cli\\bin\\cli.js verifast ${outFile}`,
        '',
        `Default VeriFast path: ${DEFAULT_VERIFAST_EXE}`,
        'Override with VERIFAST_EXE only if you want a different VeriFast installation.',
        '',
        'The CLI uses VeriFast compile-only mode (-c) by default for generated C runtime contracts.',
        'Use --link only if you provide concrete runtime manifests/implementations.'
    ].join('\n');
}

function formatVeriFastResult(result: VeriFastApiResult): string {
    const diagnostics = result.errors && result.errors.length > 0
        ? result.errors.map(error =>
            `${error.kind}: ${error.file}(${error.line},${error.colFrom}-${error.colTo}): ${error.message}`
        ).join('\n')
        : '(no parsed diagnostics)';

    return [
        result.ok ? 'VeriFast OK' : 'VeriFast failed',
        `Exit code: ${result.exitCode}`,
        result.command ? `Command: ${result.command}` : undefined,
        result.file ? `Temporary file: ${result.file}` : undefined,
        result.verifastExe ? `VeriFast: ${result.verifastExe}` : undefined,
        '',
        'Diagnostics:',
        diagnostics,
        result.stdout.trim().length > 0 ? `\nstdout:\n${result.stdout.trim()}` : undefined,
        result.stderr.trim().length > 0 ? `\nstderr:\n${result.stderr.trim()}` : undefined
    ].filter((line): line is string => line !== undefined).join('\n');
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

function setSaveStatus(textContent: string): void {
    setTextContent('#save-status', textContent);
}

function downloadCode(code: string, fileName: string): void {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}


export const runDsl = async () => {
    try {
        document.querySelector('#button-start')?.addEventListener('click', startEditor);
        document.querySelector('#button-dispose')?.addEventListener('click', disposeEditor);
        document.querySelector('#button-summary')?.addEventListener('click', updateSummary);
        document.querySelector('#button-code')?.addEventListener('click', updateCode);
        document.querySelector('#button-save')?.addEventListener('click', saveCurrentCode);
        document.querySelector('#button-execute')?.addEventListener('click', updateExecution);
        document.querySelector('#button-generate-c')?.addEventListener('click', updateCGeneration);
        document.querySelector('#button-save-c')?.addEventListener('click', saveCurrentCCode);
        document.querySelector('#button-run-verifast')?.addEventListener('click', runVeriFastFromWeb);
        setTextContent('#verifastspan', buildVeriFastHelp(getSuggestedCFileName()));

    } catch (e) {
        console.error(e);
    }
};

export const runPseudo2 = runDsl;


const loadWorkerRegular = () => {
    // Language Server preparation
    console.log(`Langium worker URL: ${workerUrl}`);
    return new Worker(workerUrl, {
        type: 'module',
        name: 'Pseudo2 Server Regular',  //TBC
    });
};


