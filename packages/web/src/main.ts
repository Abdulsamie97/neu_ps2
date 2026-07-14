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
import * as monaco from '@codingame/monaco-vscode-editor-api';
import { EmptyFileSystem, URI } from 'langium';

import {
    createPseudo2Services,
    generateCProgram,
    generateCProgramWithSourceMap,
    generateGraphvizArtifacts,
    generateProgram,
    getSummaryFromCode,
    type CSourceMapEntry,
    type GeneratedArtifact,
    type Program
} from 'pseudo2-language'; //TBC
import { instance, type Viz } from '@viz-js/viz';


let editorApp: EditorApp | undefined;
let lcWrapper: LanguageClientWrapper;
let executionDocCounter = 0;
let executionServices: ReturnType<typeof createPseudo2Services> | undefined;
let lastGeneratedCCode = '';
let lastGeneratedCExecutableCode = '';
let lastGeneratedCSourceMap: CSourceMapEntry[] = [];
let graphArtifacts: GeneratedArtifact[] = [];
let vizPromise: Promise<Viz> | undefined;
let keywordDecorationDisposable: monaco.IDisposable | undefined;
const RESULT_PANE_RATIO_KEY = 'pseudo2.resultPaneRatio';
const DEFAULT_RESULT_PANE_WIDTH = 430;
const MIN_WORKSPACE_PANE_WIDTH = 320;

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
        sourceFile?: string;
        sourceLine?: number;
    }>;
    runtimeChecks?: Array<{
        component: string;
        ok: boolean;
        exitCode: number;
    }>;
    file?: string;
    command?: string;
    verifastExe?: string;
};

type CExecutionApiResult = {
    ok: boolean;
    stage: 'compiler' | 'compile' | 'run';
    compiler?: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    compileStdout?: string;
    compileStderr?: string;
    timedOut?: boolean;
    error?: string;
};

const startEditor = async () => {
    disableElement('button-start', true);
    disableElement('button-dispose', false);

    try {


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
                uri: '/workspace/example.pseudo2',   //TBC  (suffix might be important)
                enforceLanguageId: 'pseudo2'
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
        installPseudo2KeywordDecorations(editorApp.getEditor());
    } catch (error) {
        disableElement('button-start', false);
        disableElement('button-dispose', true);
        setTextContent('#exespan', `Editor start failed:\n${formatError(error)}`);
        console.error(error);
    }


};



const disposeEditor = async () => {
    disableElement('button-start', false);
    disableElement('button-dispose', true);

    lcWrapper.dispose();
    keywordDecorationDisposable?.dispose();
    keywordDecorationDisposable = undefined;

    editorApp?.reportStatus();
    await editorApp?.dispose();
    console.log(editorApp?.reportStatus().join('\n'));

};

const updateSummary = async () => {
    await showResultView('javascript');
    //TODO: make it nicer
    const sumelem = document.querySelector("#summaryspan");
    if (sumelem != null) {
        const sum = await getSummaryFromCode(getCurrentCode());
        sumelem.textContent = sum;
    }
};

const updateCode = async () => {
    await showResultView('javascript');
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
    await showResultView('javascript');
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
    await showResultView('c');
    const generated = await generateCCodeFromEditor();
    if (generated) {
        await verifyLastGeneratedCCode();
    }
};

const showResultView = async (view: 'javascript' | 'c' | 'graphs') => {
    const javascriptView = document.querySelector<HTMLElement>('#javascript-view');
    const cView = document.querySelector<HTMLElement>('#c-view');
    const graphView = document.querySelector<HTMLElement>('#graph-view');
    const javascriptButton = document.querySelector<HTMLButtonElement>('#button-view-javascript');
    const cButton = document.querySelector<HTMLButtonElement>('#button-view-c');
    const graphButton = document.querySelector<HTMLButtonElement>('#button-view-graphs');

    if (javascriptView) javascriptView.hidden = view !== 'javascript';
    if (cView) cView.hidden = view !== 'c';
    if (graphView) graphView.hidden = view !== 'graphs';
    setActiveResultTab(javascriptButton, view === 'javascript');
    setActiveResultTab(cButton, view === 'c');
    setActiveResultTab(graphButton, view === 'graphs');

    if (view === 'graphs' && graphArtifacts.length === 0) {
        await updateGraphvizArtifacts();
    }
};

function setActiveResultTab(button: HTMLButtonElement | null, active: boolean): void {
    button?.classList.toggle('is-active', active);
    button?.setAttribute('aria-selected', String(active));
}

const updateGraphvizArtifacts = async () => {
    setGraphStatus('Generating graphs...');
    clearRenderedGraph();

    if (!editorApp?.getEditor()) {
        setGraphStatus('Start the editor before generating graphs.', true);
        return;
    }

    const currentCode = getCurrentCode();
    if (currentCode.trim().length === 0) {
        setGraphStatus('No Pseudo2 code to analyze.', true);
        return;
    }

    try {
        const { program, errors } = await parsePseudo2(currentCode);
        if (errors.length > 0 || !program) {
            graphArtifacts = [];
            updateGraphSelect();
            setGraphStatus(`Validation failed:\n${errors.join('\n')}`, true);
            return;
        }

        graphArtifacts = generateGraphvizArtifacts(program);
        updateGraphSelect();
        if (graphArtifacts.length === 0) {
            setGraphStatus('No graphs are available for this program.');
            return;
        }
        await renderSelectedGraph();
    } catch (error) {
        graphArtifacts = [];
        updateGraphSelect();
        setGraphStatus(`Graph generation failed: ${formatError(error)}`, true);
    }
};

function updateGraphSelect(): void {
    const select = document.querySelector<HTMLSelectElement>('#graph-select');
    if (!select) return;

    const previous = select.value;
    select.replaceChildren(...graphArtifacts.map(artifact => {
        const option = document.createElement('option');
        option.value = artifact.fileName;
        option.textContent = graphArtifactLabel(artifact.fileName);
        return option;
    }));
    select.disabled = graphArtifacts.length === 0;
    if (graphArtifacts.some(artifact => artifact.fileName === previous)) {
        select.value = previous;
    }
}

function graphArtifactLabel(fileName: string): string {
    if (fileName === 'graphvizAST.dot') return 'Abstract Syntax Tree (AST)';
    if (fileName === 'graphvizDep.dot') return 'Dependency graph';
    const cfg = fileName.match(/^graphvizCfg_(.+)\.dot$/);
    return cfg ? `Control Flow Graph: ${cfg[1]}` : fileName;
}

const renderSelectedGraph = async () => {
    const select = document.querySelector<HTMLSelectElement>('#graph-select');
    const artifact = graphArtifacts.find(candidate => candidate.fileName === select?.value) ?? graphArtifacts[0];
    if (!artifact) {
        clearRenderedGraph();
        return;
    }

    setGraphStatus(`Rendering ${graphArtifactLabel(artifact.fileName)}...`);
    setTextContent('#graph-dot-source', artifact.code);
    try {
        vizPromise ??= instance();
        const viz = await vizPromise;
        const svg = viz.renderSVGElement(artifact.code, { engine: 'dot' });
        const canvas = document.querySelector<HTMLElement>('#graph-canvas');
        canvas?.replaceChildren(svg);
        setGraphStatus(`${graphArtifactLabel(artifact.fileName)} rendered.`);
    } catch (error) {
        clearRenderedGraph(false);
        setGraphStatus(`Graph rendering failed: ${formatError(error)}`, true);
    }
};

function clearRenderedGraph(clearDot = true): void {
    document.querySelector('#graph-canvas')?.replaceChildren();
    if (clearDot) setTextContent('#graph-dot-source', '');
}

function setGraphStatus(message: string, error = false): void {
    const status = document.querySelector<HTMLElement>('#graph-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', error);
}

const generateCCodeFromEditor = async (): Promise<boolean> => {
    setTextContent('#c-outputspan', '');
    setTextContent('#cspan', 'Generating C...');
    setTextContent('#c-runtimespan', 'Generating runnable C...');
    setTextContent('#verifastspan', '');
    clearVeriFastEditorDiagnostics();
    lastGeneratedCCode = '';
    lastGeneratedCExecutableCode = '';
    lastGeneratedCSourceMap = [];

    if (!editorApp?.getEditor()) {
        setTextContent('#cspan', 'Editor is not started yet.');
        return false;
    }

    const currentCode = getCurrentCode();
    if (currentCode.trim().length === 0) {
        setTextContent('#cspan', 'No Pseudo2 code to generate.');
        return false;
    }

    try {
        const { program, errors } = await parsePseudo2(currentCode);
        if (errors.length > 0 || !program) {
            setTextContent('#cspan', `Validation failed:\n${errors.join('\n')}`);
            return false;
        }

        const moduleName = getSuggestedCFileName();
        const generated = generateCProgramWithSourceMap(program, undefined, { moduleName });
        lastGeneratedCCode = generated.code;
        lastGeneratedCExecutableCode = generateCProgram(program, undefined, {
            moduleName,
            runtime: 'implementation'
        });
        lastGeneratedCSourceMap = generated.sourceMap;
        setTextContent('#cspan', lastGeneratedCCode);
        setTextContent('#c-runtimespan', lastGeneratedCExecutableCode);
        return true;
    } catch (error) {
        setTextContent('#cspan', `C generation failed:\n${formatError(error)}`);
        setTextContent('#c-runtimespan', '');
        return false;
    }
};

const runCFromWeb = async () => {
    await showResultView('c');
    setTextContent('#c-outputspan', 'Generating and compiling C...');
    disableElement('button-run-c', true);

    try {
        const generated = await generateCCodeFromEditor();
        if (!generated || !lastGeneratedCExecutableCode) {
            setTextContent('#c-outputspan', 'No runnable C code generated.');
            return;
        }

        setTextContent('#c-outputspan', 'Compiling and running C...');
        const response = await fetch('/api/run-c', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                code: lastGeneratedCExecutableCode,
                fileName: getSuggestedCFileName(),
                timeoutMs: 10_000
            })
        });
        const responseText = await response.text();
        const result = JSON.parse(responseText) as CExecutionApiResult;
        if (!response.ok) {
            setTextContent('#c-outputspan', `C execution request failed (${response.status}):\n${result.error ?? formatValue(result)}`);
            return;
        }
        setTextContent('#c-outputspan', formatCExecutionResult(result));
    } catch (error) {
        setTextContent(
            '#c-outputspan',
            `C execution request failed: ${formatError(error)}\n` +
            'Open the app through the local Vite server so /api/run-c is available.'
        );
    } finally {
        disableElement('button-run-c', false);
    }
};

const runVeriFastFromWeb = async () => {
    await showResultView('c');
    if (!lastGeneratedCCode) {
        const generated = await generateCCodeFromEditor();
        if (!generated) {
            return;
        }
    }

    if (!lastGeneratedCCode) {
        setTextContent('#verifastspan', 'No C code generated.');
        return;
    }

    await verifyLastGeneratedCCode();
};

const verifyLastGeneratedCCode = async () => {
    await showResultView('c');
    setTextContent('#verifastspan', 'Running VeriFast...');

    try {
        const response = await fetch('/api/verifast', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                code: lastGeneratedCCode,
                fileName: getSuggestedCFileName(),
                sourceFile: getSuggestedFileName(),
                sourceMap: lastGeneratedCSourceMap
            })
        });
        const text = await response.text();
        const result = JSON.parse(text) as VeriFastApiResult;

        if (!response.ok) {
            setTextContent('#verifastspan', `VeriFast request failed (${response.status}):\n${formatValue(result)}`);
            return;
        }

        updateVeriFastEditorDiagnostics(result);
        focusFirstVeriFastDiagnostic(result);
        setTextContent('#verifastspan', formatVeriFastResult(result));
    } catch (error) {
        setTextContent(
            '#verifastspan',
            `VeriFast request failed: ${formatError(error)}\n` +
            'Open the app through the local Vite server so /api/verifast is available.'
        );
    }
};

const saveCurrentCCode = async () => {
    await showResultView('c');
    if (!lastGeneratedCCode) {
        await generateCCodeFromEditor();
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
            return;
        }

        downloadCode(lastGeneratedCCode, suggestedName);
        setSaveStatus(`Downloaded: ${suggestedName}`);
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

function formatVeriFastResult(result: VeriFastApiResult): string {
    const diagnostics = formatVeriFastDiagnostics(result);
    const runtimeChecks = result.runtimeChecks ?? [];
    const runtimeSummary = runtimeChecks.length > 0
        ? `Runtime kernels: ${runtimeChecks.filter(check => check.ok).length}/${runtimeChecks.length} verified`
        : undefined;

    return [
        result.ok ? 'VeriFast OK' : 'VeriFast failed',
        `Exit code: ${result.exitCode}`,
        runtimeSummary,
        '',
        'Diagnostics:',
        diagnostics
    ].filter((line): line is string => line !== undefined).join('\n');
}

function formatCExecutionResult(result: CExecutionApiResult): string {
    if (result.stage === 'compiler') {
        return `C compiler unavailable\n\n${result.stderr || result.error || 'No compiler was found.'}`;
    }

    if (result.stage === 'compile') {
        return [
            result.timedOut ? 'C compilation timed out' : 'C compilation failed',
            `Exit code: ${result.exitCode}`,
            '',
            result.stderr || result.stdout || 'No compiler diagnostic was produced.'
        ].join('\n');
    }

    const output = result.stdout.trim().length > 0 ? result.stdout.trimEnd() : '(no output)';
    const runtimeError = result.stderr.trim().length > 0 ? `\n\nstderr:\n${result.stderr.trimEnd()}` : '';
    if (result.ok) {
        return output + runtimeError;
    }

    return [
        result.timedOut ? 'C execution timed out' : 'C execution failed',
        `Exit code: ${result.exitCode}`,
        result.compiler ? `Compiler: ${result.compiler}` : undefined,
        '',
        output + runtimeError
    ].filter((line): line is string => line !== undefined).join('\n');
}

function formatVeriFastDiagnostics(result: VeriFastApiResult): string {
    const errors = result.errors ?? [];
    if (errors.length === 0) {
        return result.ok
            ? 'No errors found.'
            : 'VeriFast failed, but no Pseudo2 diagnostic could be mapped.';
    }

    const mappedDiagnostics = errors.filter(error => typeof error.sourceLine === 'number');
    const diagnostics = mappedDiagnostics.length > 0
        ? mappedDiagnostics
        : errors.filter(error => error.kind === 'error');

    if (diagnostics.length === 0) {
        return 'VeriFast reported notes only. No Pseudo2 error line was mapped.';
    }

    return diagnostics.map(formatVeriFastDiagnostic).join('\n');
}

function formatVeriFastDiagnostic(error: NonNullable<VeriFastApiResult['errors']>[number]): string {
    if (typeof error.sourceLine === 'number') {
        return `${error.kind}: Pseudo2 line ${error.sourceLine}: ${error.message}`;
    }

    return `${error.kind}: ${error.message}`;
}

function focusFirstVeriFastDiagnostic(result: VeriFastApiResult): void {
    const line = result.errors?.find(error => typeof error.sourceLine === 'number')?.sourceLine;
    if (!line) {
        return;
    }

    const editor = editorApp?.getEditor();
    editor?.setPosition({ lineNumber: line, column: 1 });
    editor?.revealLineInCenter(line);
    editor?.focus();
}

function updateVeriFastEditorDiagnostics(result: VeriFastApiResult): void {
    const editor = editorApp?.getEditor();
    const model = editor?.getModel();
    if (!model) {
        return;
    }

    const markers = (result.errors ?? [])
        .filter(error => error.kind === 'error' && typeof error.sourceLine === 'number')
        .map(error => {
            const lineNumber = error.sourceLine ?? 1;
            return {
                severity: monaco.MarkerSeverity.Error,
                message: error.message,
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: model.getLineMaxColumn(lineNumber)
            };
        });

    monaco.editor.setModelMarkers(model, 'verifast', markers);
}

function clearVeriFastEditorDiagnostics(): void {
    const model = editorApp?.getEditor()?.getModel();
    if (model) {
        monaco.editor.setModelMarkers(model, 'verifast', []);
    }
}

function installPseudo2KeywordDecorations(editor: monaco.editor.IStandaloneCodeEditor | undefined): void {
    keywordDecorationDisposable?.dispose();
    keywordDecorationDisposable = undefined;

    if (!editor) {
        return;
    }

    let decorationIds: string[] = [];
    const keywords = new Set([
        'assert',
        'assume',
        'bool',
        'by',
        'call',
        'close',
        'decreases',
        'do',
        'downto',
        'else',
        'ensures',
        'false',
        'for',
        'func',
        'if',
        'invariant',
        'leak',
        'mod',
        'new',
        'null',
        'num',
        'open',
        'print',
        'requires',
        'result',
        'return',
        'string',
        'struct',
        'terminates',
        'this',
        'throw',
        'to',
        'true',
        'var',
        'vf_array',
        'vf_bool',
        'vf_elem',
        'vf_field',
        'vf_in_bounds',
        'vf_integer',
        'vf_int',
        'vf_len',
        'vf_null',
        'vf_number',
        'vf_real',
        'vf_ratio',
        'vf_same',
        'vf_string',
        'vf_truthy',
        'vf_struct',
        'vf_undefined',
        'vf_value',
        'while'
    ]);

    const updateDecorations = () => {
        const model = editor.getModel();
        if (!model) {
            decorationIds = editor.deltaDecorations(decorationIds, []);
            return;
        }

        const decorations: monaco.editor.IModelDeltaDecoration[] = [];
        for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber++) {
            const line = model.getLineContent(lineNumber);
            collectPseudo2Decorations(line, lineNumber, keywords, decorations);
        }

        decorationIds = editor.deltaDecorations(decorationIds, decorations);
    };

    updateDecorations();

    const contentDisposable = editor.onDidChangeModelContent(updateDecorations);
    const modelDisposable = editor.onDidChangeModel(updateDecorations);
    keywordDecorationDisposable = {
        dispose: () => {
            decorationIds = editor.deltaDecorations(decorationIds, []);
            contentDisposable.dispose();
            modelDisposable.dispose();
        }
    };
}

function collectPseudo2Decorations(
    line: string,
    lineNumber: number,
    keywords: Set<string>,
    decorations: monaco.editor.IModelDeltaDecoration[]
): void {
    let index = 0;

    const addDecoration = (startIndex: number, endIndex: number, inlineClassName: string) => {
        decorations.push({
            range: new monaco.Range(lineNumber, startIndex + 1, lineNumber, endIndex + 1),
            options: {
                inlineClassName
            }
        });
    };

    while (index < line.length) {
        const char = line[index];

        if (char === '#' || (char === '/' && line[index + 1] === '/')) {
            addDecoration(index, line.length, 'pseudo2-comment-token');
            return;
        }

        if (char === '"' || char === "'") {
            const quote = char;
            let end = index + 1;
            while (end < line.length) {
                if (line[end] === '\\') {
                    end += 2;
                    continue;
                }
                if (line[end] === quote) {
                    end++;
                    break;
                }
                end++;
            }
            addDecoration(index, Math.min(end, line.length), quote === "'" ? 'pseudo2-char-token' : 'pseudo2-string-token');
            index = Math.max(end, index + 1);
            continue;
        }

        if (/\d/.test(char)) {
            const start = index;
            index++;
            while (index < line.length && /[\d.]/.test(line[index])) {
                index++;
            }
            addDecoration(start, index, 'pseudo2-number-token');
            continue;
        }

        if (/[a-zA-Z_]/.test(char)) {
            const start = index;
            index++;
            while (index < line.length && /[\w]/.test(line[index])) {
                index++;
            }
            const word = line.slice(start, index);
            if (keywords.has(word)) {
                addDecoration(start, index, 'pseudo2-keyword-token');
            }
            continue;
        }

        index++;
    }
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

function installWorkspaceSplitter(): void {
    const layout = document.querySelector<HTMLElement>('.workspace-layout');
    const splitter = document.querySelector<HTMLElement>('#workspace-splitter');
    if (!layout || !splitter) return;

    let resultRatio = readStoredResultPaneRatio();
    let resultWidth = DEFAULT_RESULT_PANE_WIDTH;
    let dragging = false;

    const applyWidth = (requestedWidth: number, persist = false) => {
        const layoutWidth = layout.getBoundingClientRect().width;
        const splitterWidth = splitter.getBoundingClientRect().width || 7;
        const availableWidth = Math.max(0, layoutWidth - splitterWidth);
        const maxResultWidth = Math.max(
            MIN_WORKSPACE_PANE_WIDTH,
            availableWidth - MIN_WORKSPACE_PANE_WIDTH
        );
        resultWidth = Math.min(Math.max(requestedWidth, MIN_WORKSPACE_PANE_WIDTH), maxResultWidth);
        const editorWidth = Math.max(MIN_WORKSPACE_PANE_WIDTH, availableWidth - resultWidth);
        resultRatio = availableWidth > 0 ? resultWidth / availableWidth : 0.5;
        layout.style.setProperty('--editor-pane-width', `${Math.round(editorWidth)}px`);
        layout.style.setProperty('--result-pane-width', `${Math.round(resultWidth)}px`);
        splitter.setAttribute('aria-valuemin', String(MIN_WORKSPACE_PANE_WIDTH));
        splitter.setAttribute('aria-valuemax', String(Math.round(maxResultWidth)));
        splitter.setAttribute('aria-valuenow', String(Math.round(resultWidth)));
        splitter.setAttribute('aria-valuetext', `${Math.round(resultWidth)} pixels`);

        if (persist) {
            try {
                localStorage.setItem(RESULT_PANE_RATIO_KEY, String(resultRatio));
            } catch {
                // Storage can be unavailable in restricted browser contexts.
            }
        }
        requestAnimationFrame(layoutEditorToPane);
    };

    const resizeFromPointer = (event: PointerEvent) => {
        if (!dragging) return;
        const layoutBounds = layout.getBoundingClientRect();
        applyWidth(layoutBounds.right - event.clientX);
    };

    const stopDragging = () => {
        if (!dragging) return;
        dragging = false;
        splitter.classList.remove('is-dragging');
        document.body.classList.remove('is-resizing-workspace');
        applyWidth(resultWidth, true);
    };

    splitter.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragging = true;
        splitter.classList.add('is-dragging');
        document.body.classList.add('is-resizing-workspace');
    });
    window.addEventListener('pointermove', resizeFromPointer);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    splitter.addEventListener('dblclick', () => applyWidth(DEFAULT_RESULT_PANE_WIDTH, true));
    splitter.addEventListener('keydown', event => {
        const step = event.shiftKey ? 64 : 16;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            applyWidth(resultWidth + step, true);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            applyWidth(resultWidth - step, true);
        } else if (event.key === 'Home') {
            event.preventDefault();
            applyWidth(MIN_WORKSPACE_PANE_WIDTH, true);
        } else if (event.key === 'End') {
            event.preventDefault();
            applyWidth(Number.MAX_SAFE_INTEGER, true);
        }
    });
    window.addEventListener('resize', () => {
        const availableWidth = Math.max(0, layout.getBoundingClientRect().width - 7);
        applyWidth(availableWidth * resultRatio);
    });
    requestAnimationFrame(() => {
        const availableWidth = Math.max(0, layout.getBoundingClientRect().width - 7);
        applyWidth(resultRatio ? availableWidth * resultRatio : resultWidth);
    });
}

function layoutEditorToPane(): void {
    const editor = editorApp?.getEditor();
    const container = document.querySelector<HTMLElement>('#monaco-editor-root');
    if (!editor || !container) return;
    editor.layout({
        width: container.clientWidth,
        height: container.clientHeight
    });
}

function readStoredResultPaneRatio(): number {
    try {
        const stored = Number(localStorage.getItem(RESULT_PANE_RATIO_KEY));
        return Number.isFinite(stored) && stored > 0 && stored < 1 ? stored : 0;
    } catch {
        return 0;
    }
}


export const runDsl = async () => {
    try {
        installWorkspaceSplitter();
        document.querySelector('#button-start')?.addEventListener('click', startEditor);
        document.querySelector('#button-dispose')?.addEventListener('click', disposeEditor);
        document.querySelector('#button-summary')?.addEventListener('click', updateSummary);
        document.querySelector('#button-code')?.addEventListener('click', updateCode);
        document.querySelector('#button-save')?.addEventListener('click', saveCurrentCode);
        document.querySelector('#button-execute')?.addEventListener('click', updateExecution);
        document.querySelector('#button-generate-c')?.addEventListener('click', updateCGeneration);
        document.querySelector('#button-run-c')?.addEventListener('click', runCFromWeb);
        document.querySelector('#button-save-c')?.addEventListener('click', saveCurrentCCode);
        document.querySelector('#button-run-verifast')?.addEventListener('click', runVeriFastFromWeb);
        document.querySelector('#button-view-javascript')?.addEventListener('click', () => void showResultView('javascript'));
        document.querySelector('#button-view-c')?.addEventListener('click', () => void showResultView('c'));
        document.querySelector('#button-view-graphs')?.addEventListener('click', () => void showResultView('graphs'));
        document.querySelector('#button-generate-graphs')?.addEventListener('click', () => void updateGraphvizArtifacts());
        document.querySelector('#graph-select')?.addEventListener('change', () => void renderSelectedGraph());
        setTextContent('#verifastspan', '');
        setTextContent('#c-outputspan', '');

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


