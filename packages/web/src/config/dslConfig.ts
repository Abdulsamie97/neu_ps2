/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * @file dslConfig.ts
 * @brief Erzeugt die Monaco-, VS-Code- und Langium-Clientkonfiguration der Pseudo2-Workbench.
 */

import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getLocalizationServiceOverride from '@codingame/monaco-vscode-localization-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import { LogLevel } from '@codingame/monaco-vscode-api';
import { createDefaultLocaleConfiguration } from 'monaco-languageclient/vscodeApiLocales';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import { LcWorker, type LanguageClientConfig } from 'monaco-languageclient/lcwrapper';
import { useWorkerFactory, Worker as MonacoWorker } from 'monaco-languageclient/workerFactory';
import type { CodeContent, EditorAppConfig } from 'monaco-languageclient/editorApp';
import editorWorkerUrl from '@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js?worker&url';
import extensionHostWorkerUrl from '@codingame/monaco-vscode-api/workers/extensionHost.worker?worker&url';
import textMateWorkerUrl from '@codingame/monaco-vscode-textmate-service-override/worker?worker&url';

// cannot be imported with assert as json contains comments
import languageConfig from './language-configuration.json?raw';
import responseDslTm from '../../../language/syntaxes/pseudo2.tmLanguage.json?raw'; //TBC
import type { ExampleAppConfig } from '../common/client/utils.js';

/**
 * @brief Erstellt die aufeinander abgestimmten Konfigurationen für Editor, VS-Code-Dienste und Language Client.
 *
 * Die Funktion registriert Pseudo2-Sprachkonfiguration und TextMate-Grammatik als
 * virtuelle Erweiterungsdateien. Sie richtet Monaco-Service-Overrides für Theme,
 * TextMate, Tastenkürzel, Lebenszyklus und Lokalisierung ein und verbindet den
 * Language Client direkt mit dem angegebenen Web Worker. Der übergebene Quelltext
 * wird als veränderte Editorressource geöffnet.
 *
 * @param params Kennung, Editorinhalt, Worker-URL und Editorcontainer.
 * @return Konsistentes Konfigurationsbündel zum Start aller Workbench-Komponenten.
 */
export const createLangiumGlobalConfig = (params: {
    /** @brief Eindeutige Kennung zur Benennung der virtuellen Erweiterungsdateien. */
    languageServerId: string,
    /** @brief Anfangsinhalt und URI des im Editor zu öffnenden Pseudo2-Dokuments. */
    codeContent: CodeContent,
    /** @brief URL des gebuendelten Pseudo2-Language-Server-Workers. */
    workerUrl: URL,
    /** @brief Optionaler DOM-Container, in den der Monaco-Editor eingebettet wird. */
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
                $family: 'Worker',
                realization: () => new LcWorker(),
                workerUrl: params.workerUrl,
                type: 'module',
                workerName: 'Pseudo2 Language Server'
            }
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
        // Resolve workers in Vite before dependency optimization can rebase their URLs.
        monacoWorkerFactory: logger => useWorkerFactory({
            logger,
            workerLoaders: {
                editorWorkerService: () => new MonacoWorker(editorWorkerUrl, { type: 'module' }),
                extensionHostWorkerMain: () => new MonacoWorker(extensionHostWorkerUrl, { type: 'module' }),
                TextMateWorker: () => new MonacoWorker(textMateWorkerUrl, { type: 'module' })
            }
        }),
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
