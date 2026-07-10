/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getLocalizationServiceOverride from '@codingame/monaco-vscode-localization-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import { LogLevel } from '@codingame/monaco-vscode-api';
import { MessageTransports } from 'vscode-languageclient';
import { createDefaultLocaleConfiguration } from 'monaco-languageclient/vscodeApiLocales';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import type { LanguageClientConfig } from 'monaco-languageclient/lcwrapper';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';
import type { CodeContent, EditorAppConfig } from 'monaco-languageclient/editorApp';

// cannot be imported with assert as json contains comments
import languageConfig from './language-configuration.json?raw';
import responseDslTm from '../../../language/syntaxes/pseudo2.tmLanguage.json?raw'; //TBC
import type { ExampleAppConfig } from '../common/client/utils.js';

export const createLangiumGlobalConfig = (params: {
    languageServerId: string,
    codeContent: CodeContent,
    worker: Worker,
    messagePort?: MessagePort,
    messageTransports?: MessageTransports,
    htmlContainer?: HTMLElement
}): ExampleAppConfig => {
    const extensionFilesOrContents = new Map<string, string | URL>();
    extensionFilesOrContents.set(`/${params.languageServerId}-dsl-configuration.json`, languageConfig);
    extensionFilesOrContents.set(`/${params.languageServerId}-dsl-grammar.json`, responseDslTm);

    const languageClientConfig: LanguageClientConfig = {
        languageId: 'pseudo2',  //TBC
        clientOptions: {
            documentSelector: ['pseudo2']  //TBC
        },
        connection: {
            options: {
                $type: 'WorkerDirect',
                worker: params.worker,
                messagePort: params.messagePort,
            },
            messageTransports: params.messageTransports
        },
        logLevel: LogLevel.Off
    };

    const vscodeApiConfig: MonacoVscodeApiConfig = {
        $type: 'extended',
        viewsConfig: {
            $type: 'EditorService',
            htmlContainer: params.htmlContainer
        },
        logLevel: LogLevel.Off,
        serviceOverrides: {
            ...getThemeServiceOverride(),
            ...getTextmateServiceOverride(),
            ...getKeybindingsServiceOverride(),
            ...getLifecycleServiceOverride(),
            ...getLocalizationServiceOverride(createDefaultLocaleConfiguration()),
        },
        monacoWorkerFactory: configureDefaultWorkerFactory,
        userConfiguration: {
            json: JSON.stringify({
                // 'workbench.colorTheme': 'Default Dark Modern',
                'workbench.colorTheme': 'Default Light Modern',
                'editor.guides.bracketPairsHorizontal': 'active',
                'editor.wordBasedSuggestions': 'off',
                'editor.experimental.asyncTokenization': true
            })
        },
        extensions: [{
            config: {
                name: 'pseudo2-example', //TBC
                publisher: 'typefox',  //TBC
                version: '1.0.0',  //TBC
                engines: {
                    vscode: '*'
                },
                contributes: {
                    // should correspond with  "contributes"-section in ../extension/package.json
                    languages: [{
                        id: 'pseudo2',  //TBC
                        extensions: ['.pseudo2'],  //TBC
                        aliases: ['pseudo2', 'Pseudo2'],  //TBC
                        configuration: `./${params.languageServerId}-dsl-configuration.json`
                    }],
                    grammars: [{
                        language: 'pseudo2',  //TBC
                        scopeName: 'source.pseudo2',  //TBC
                        path: `./${params.languageServerId}-dsl-grammar.json`
                    }]
                }
            },
            filesOrContents: extensionFilesOrContents
        }]
    };

    const editorAppConfig: EditorAppConfig = {
        codeResources: {
            modified: params.codeContent
        },
        logLevel: LogLevel.Debug
        // logLevel: LogLevel.Info
    };

    return {
        editorAppConfig,
        vscodeApiConfig,
        languageClientConfig
    };
};
