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

import { getSummaryFromCode } from 'pseudo2-language'; //TBC


let editorApp: EditorApp | undefined;
let lcWrapper: LanguageClientWrapper;

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

function getCurrentCode(): string {
    return editorApp?.getEditor()?.getModel()?.getValue() ?? "";
}


export const runDsl = async () => {
    try {
        document.querySelector('#button-start')?.addEventListener('click', startEditor);
        document.querySelector('#button-dispose')?.addEventListener('click', disposeEditor);
        document.querySelector('#button-summary')?.addEventListener('click', updateSummary);
        document.querySelector('#button-code')?.addEventListener('click', updateCode);
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


