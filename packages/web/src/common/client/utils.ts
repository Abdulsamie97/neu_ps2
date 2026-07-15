/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * @file utils.ts
 * @brief Stellt gemeinsame Browser-Hilfen für Bedienelemente und virtuelle VS-Code-Workspaces bereit.
 */

import type { EditorAppConfig } from 'monaco-languageclient/editorApp';
import type { LanguageClientConfig } from 'monaco-languageclient/lcwrapper';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';

/**
 * @brief Aktiviert oder deaktiviert ein Schaltflächen- beziehungsweise Eingabeelement anhand seiner ID.
 *
 * Fehlt das Element im aktuellen Dokument, beendet sich die Funktion ohne Fehler.
 * Dadurch kann dieselbe Initialisierungslogik auch auf Seiten mit reduzierter
 * Werkzeugleiste verwendet werden.
 *
 * @param id DOM-ID des zu ändernden Elements.
 * @param disabled Neuer Wert der nativen `disabled`-Eigenschaft.
 */
export const disableElement = (id: string, disabled: boolean) => {
    const button = document.getElementById(id) as HTMLButtonElement | HTMLInputElement | null;
    if (button !== null) {
        button.disabled = disabled;
    }
};

/**
 * @brief Erzeugt den JSON-Inhalt einer VS-Code-Workspace-Datei mit genau einem Ordner.
 * @param workspacePath Pfad, der als einziger Workspace-Ordner eingetragen wird.
 * @return Mit zwei Leerzeichen formatiertes Workspace-JSON.
 */
export const createDefaultWorkspaceContent = (workspacePath: string) => {
    return JSON.stringify(
        {
            folders: [
                {
                    path: workspacePath
                }
            ]
        },
        null,
        2
    );
};

/** @brief Bündelt die drei Konfigurationen, die zum Start der Monaco-Langium-Anwendung benötigt werden. */
export type ExampleAppConfig = {
    /** @brief Konfiguriert VS-Code-Dienste, Themes, TextMate und Worker für Monaco. */
    vscodeApiConfig: MonacoVscodeApiConfig;
    /** @brief Konfiguriert Sprache, Transport und Lebenszyklus des Language Clients. */
    languageClientConfig: LanguageClientConfig;
    /** @brief Konfiguriert Editorinhalt, Ressourcen und Protokollierung der Editor-Anwendung. */
    editorAppConfig: EditorAppConfig;
};
