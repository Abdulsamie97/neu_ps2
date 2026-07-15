/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * @file main.ts
 * @brief Steuert Lebenszyklus, Generatoren, Programmausführung, VeriFast, Graphviz und Layout der Pseudo2-Workbench.
 */

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


/** @brief Aktive Editor-Anwendung; vor dem Start und nach dem Dispose ist sie nicht gesetzt. */
let editorApp: EditorApp | undefined;
/** @brief Aktiver Language-Client-Wrapper für die Kommunikation mit dem Pseudo2-Worker. */
let lcWrapper: LanguageClientWrapper;
/** @brief Liefert eindeutige In-Memory-URIs für unabhängig gebaute Ausführungsdokumente. */
let executionDocCounter = 0;
/** @brief Wiederverwendete, dateisystemunabhängige Langium-Dienste für Generierung und Ausführung. */
let executionServices: ReturnType<typeof createPseudo2Services> | undefined;
/** @brief Zuletzt erzeugter C-Code mit abstrakten Runtime-Verträgen für VeriFast. */
let lastGeneratedCCode = '';
/** @brief Zuletzt erzeugter C-Code mit konkreter Runtime zur nativen Ausführung. */
let lastGeneratedCExecutableCode = '';
/** @brief Zeilenabbildung des zuletzt erzeugten VeriFast-C-Codes auf den Pseudo2-Editor. */
let lastGeneratedCSourceMap: CSourceMapEntry[] = [];
/** @brief Aktuell verfügbare AST-, Abhängigkeits- und Kontrollflussgraphen. */
let graphArtifacts: GeneratedArtifact[] = [];
/** @brief Zwischengespeicherte asynchrone Initialisierung der Viz.js-Instanz. */
let vizPromise: Promise<Viz> | undefined;
/** @brief Gemeinsamer Dispose-Handler der zusätzlich installierten Monaco-Dekorationen. */
let keywordDecorationDisposable: monaco.IDisposable | undefined;
/** @brief Local-Storage-Schlüssel für das Größenverhältnis des Ergebnisbereichs. */
const RESULT_PANE_RATIO_KEY = 'pseudo2.resultPaneRatio';
/** @brief Standardbreite des rechten Ergebnisbereichs in Pixeln. */
const DEFAULT_RESULT_PANE_WIDTH = 430;
/** @brief Kleinste erlaubte Breite sowohl des Editors als auch des Ergebnisbereichs. */
const MIN_WORKSPACE_PANE_WIDTH = 320;

/** @brief Typisiert die optional verfügbare File-System-Access-API des Browsers. */
type SaveFilePicker = (options: {
    /** @brief Dateiname, den der Speicherdialog anfänglich vorschlägt. */
    suggestedName?: string;
    /** @brief Im Dialog angebotene Dateitypen und deren akzeptierte Erweiterungen. */
    types?: Array<{
        /** @brief Lesbare Beschreibung des angebotenen Dateityps. */
        description: string;
        /** @brief Ordnet MIME-Typen den erlaubten Dateiendungen zu. */
        accept: Record<string, string[]>;
    }>;
}) => Promise<{
    /** @brief Tatsächlich ausgewählter Dateiname. */
    name: string;
    /** @brief Öffnet einen schreibbaren Stream für die ausgewählte Datei. */
    createWritable: () => Promise<{
        /** @brief Schreibt Binär- oder Textdaten in den geöffneten Dateistream. */
        write: (data: BlobPart) => Promise<void>;
        /** @brief Schließt den Stream und bestätigt damit den Schreibvorgang. */
        close: () => Promise<void>;
    }>;
}>;

/** @brief Beschreibt die JSON-Antwort des lokalen `/api/verifast`-Endpunkts. */
type VeriFastApiResult = {
    /** @brief Gibt an, ob Runtime-Kerne und Programm erfolgreich verifiziert wurden. */
    ok: boolean;
    /** @brief Enthält den VeriFast-Exitcode oder einen synthetischen Server-Exitcode. */
    exitCode: number;
    /** @brief Enthält die unveränderte VeriFast-Standardausgabe. */
    stdout: string;
    /** @brief Enthält die VeriFast-Fehlerausgabe oder Serverfehlermeldungen. */
    stderr: string;
    /** @brief Enthält strukturierte C-Diagnosen mit optionaler Pseudo2-Zuordnung. */
    errors?: Array<{
        /** @brief Von VeriFast gemeldete C-Datei. */
        file: string;
        /** @brief Einsbasierte Zeile in der generierten C-Datei. */
        line: number;
        /** @brief Erste betroffene C-Spalte. */
        colFrom: number;
        /** @brief Letzte betroffene C-Spalte. */
        colTo: number;
        /** @brief Unterscheidet Fehler von ergänzenden Hinweisen. */
        kind: 'error' | 'note';
        /** @brief Lesbarer Diagnoseinhalt. */
        message: string;
        /** @brief Ursprüngliche Pseudo2-Datei nach erfolgreichem Source-Mapping. */
        sourceFile?: string;
        /** @brief Einsbasierte Pseudo2-Zeile nach erfolgreichem Source-Mapping. */
        sourceLine?: number;
    }>;
    /** @brief Ergebnisse der vor dem Programm geprüften konkreten Runtime-Kerne. */
    runtimeChecks?: Array<{
        /** @brief Dateiname der geprüften Runtime-Komponente. */
        component: string;
        /** @brief Erfolg dieser einzelnen Runtime-Verifikation. */
        ok: boolean;
        /** @brief Exitcode der Runtime-Verifikation. */
        exitCode: number;
    }>;
    /** @brief Optionaler serverseitig verwendeter temporärer C-Dateiname. */
    file?: string;
    /** @brief Optionaler vollständiger VeriFast-Befehlsaufruf. */
    command?: string;
    /** @brief Optionaler serverseitig verwendeter VeriFast-Pfad. */
    verifastExe?: string;
};

/** @brief Beschreibt die JSON-Antwort des lokalen `/api/run-c`-Endpunkts. */
type CExecutionApiResult = {
    /** @brief Gibt an, ob Compiler und Programm erfolgreich endeten. */
    ok: boolean;
    /** @brief Kennzeichnet Compilererkennung, Kompilierung oder Programmlauf als Ergebnisphase. */
    stage: 'compiler' | 'compile' | 'run';
    /** @brief Lesbarer Name des tatsächlich eingesetzten Compilers. */
    compiler?: string;
    /** @brief Exitcode der fehlgeschlagenen oder zuletzt ausgeführten Phase. */
    exitCode: number;
    /** @brief Standardausgabe des C-Programms. */
    stdout: string;
    /** @brief Fehlerausgabe des Compilers oder C-Programms. */
    stderr: string;
    /** @brief Optionale Standardausgabe der Kompilierungsphase. */
    compileStdout?: string;
    /** @brief Optionale Fehlerausgabe der Kompilierungsphase. */
    compileStderr?: string;
    /** @brief Gibt an, ob Kompilierung oder Ausführung wegen Zeitüberschreitung beendet wurde. */
    timedOut?: boolean;
    /** @brief Optionaler Fehlertext des HTTP-Endpunkts vor dem eigentlichen Prozessstart. */
    error?: string;
};

/**
 * @brief Initialisiert Monaco, VS-Code-Dienste, Language Client und den Pseudo2-Editor.
 *
 * Erstellt den Language-Server-Worker samt direkten Browsertransporten, baut daraus
 * die gemeinsame Anwendungskonfiguration und startet die Komponenten in notwendiger
 * Reihenfolge: VS-Code-API, Language Client und EditorApp. Nach dem Editorstart wird
 * das zusätzliche Pseudo2-Highlighting installiert. Fehler stellen den Buttonzustand
 * wieder her und erscheinen im JavaScript-Ausgabefeld.
 */
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



/**
 * @brief Beendet Language Client, Syntaxdekorationen und Editor-Anwendung geordnet.
 *
 * Setzt zuerst die Bedienelemente auf den nicht gestarteten Zustand, entfernt alle
 * zusätzlich verwalteten Monaco-Dekorationen und gibt anschließend die EditorApp
 * asynchron frei. Der abschließende Komponentenstatus wird zur Diagnose protokolliert.
 */
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

/**
 * @brief Berechnet eine strukturelle Zusammenfassung des aktuellen Pseudo2-Programms.
 *
 * Wechselt in die JavaScript-Ansicht und schreibt die vom Sprachpaket asynchron
 * erzeugte Zusammenfassung in den dafür vorgesehenen Detailbereich.
 */
const updateSummary = async () => {
    await showResultView('javascript');
    //TODO: make it nicer
    const sumelem = document.querySelector("#summaryspan");
    if (sumelem != null) {
        const sum = await getSummaryFromCode(getCurrentCode());
        sumelem.textContent = sum;
    }
};

/**
 * @brief Spiegelt den unveränderten Inhalt des Monaco-Modells in der Quelltextausgabe.
 *
 * Die Funktion dient der expliziten Source-Echo-Ansicht und verändert weder das
 * Editor-Modell noch das Pseudo2-Programm.
 */
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

/**
 * @brief Speichert den aktuellen Pseudo2-Editorinhalt über die bestmögliche Browser-API.
 *
 * Bei verfügbarer File-System-Access-API wird ein Speicherdialog mit `.pseudo2`-
 * Filter geöffnet und der Stream korrekt geschlossen. Andernfalls erzeugt die
 * Funktion einen klassischen Blob-Download. Abbruch und Fehler werden getrennt
 * im Statusfeld angezeigt; ohne gestarteten Editor findet kein Speicherversuch statt.
 */
const saveCurrentCode = async () => {
    if (!editorApp?.getEditor()) {
        setSaveStatus('Start the editor before saving.');
        return;
    }

    const currentCode = getCurrentCode();
    const suggestedName = getSuggestedFileName();

    try {
        const saveFilePicker = (window as Window & {
            /** @brief Optional vom Browser bereitgestellte File-System-Access-Speicherfunktion. */
            showSaveFilePicker?: SaveFilePicker
        }).showSaveFilePicker;
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

/**
 * @brief Generiert JavaScript aus dem Editorinhalt und führt es im Browser aus.
 *
 * Leere oder noch nicht gestartete Editoren werden früh abgewiesen. Der Pseudo2-
 * Quelltext wird in einem temporären Langium-Dokument vollständig validiert. Nur
 * ein fehlerfreier AST gelangt zum JavaScript-Generator. Generierter Code und
 * abgefangene Konsolenausgabe werden getrennt dargestellt; Laufzeitfehler bleiben
 * zusammen mit bereits erzeugter Ausgabe sichtbar.
 */
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

/**
 * @brief Erzeugt C-Code aus dem aktuellen Editorinhalt und startet danach VeriFast.
 *
 * Die C-/VeriFast-Ansicht wird zuerst aktiviert. Eine Verifikation erfolgt nur,
 * wenn Parsing, Validierung und beide C-Generatorvarianten erfolgreich waren.
 */
const updateCGeneration = async () => {
    await showResultView('c');
    const generated = await generateCCodeFromEditor();
    if (generated) {
        await verifyLastGeneratedCCode();
    }
};

/**
 * @brief Aktiviert genau eine der Ergebnisansichten JavaScript, C/VeriFast oder Graphen.
 *
 * Aktualisiert sowohl die `hidden`-Zustände der Panels als auch CSS- und ARIA-
 * Zustände ihrer Tabs. Beim ersten Öffnen der Graphansicht werden die Graphviz-
 * Artefakte automatisch erzeugt.
 *
 * @param view Kennung der anzuzeigenden Ergebnisansicht.
 */
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

/**
 * @brief Synchronisiert sichtbare und barrierefreie Aktivzustände eines Ergebnis-Tabs.
 * @param button Zu aktualisierender Tab oder `null`, falls er im DOM fehlt.
 * @param active Neuer Aktivzustand für CSS-Klasse und `aria-selected`.
 */
function setActiveResultTab(button: HTMLButtonElement | null, active: boolean): void {
    button?.classList.toggle('is-active', active);
    button?.setAttribute('aria-selected', String(active));
}

/**
 * @brief Validiert das aktuelle Programm und erzeugt sämtliche verfügbaren Graphviz-Artefakte neu.
 *
 * Setzt zunächst Status und bisherige Darstellung zurück. Bei erfolgreicher
 * Langium-Validierung entstehen AST-, Abhängigkeits- und CFG-DOT-Artefakte über den
 * gemeinsamen Generator. Auswahlliste und SVG-Ansicht werden konsistent aktualisiert;
 * Validierungs- und Renderfehler löschen veraltete Artefakte und erscheinen im Status.
 */
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

/**
 * @brief Baut die Graphauswahlliste aus den aktuell erzeugten Artefakten neu auf.
 *
 * Der zuvor gewählte Dateiname bleibt ausgewählt, sofern das Artefakt weiterhin
 * existiert. Ohne Artefakte wird das Select deaktiviert.
 */
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

/**
 * @brief Übersetzt technische Graphviz-Dateinamen in lesbare Bezeichnungen.
 * @param fileName Vom Artefaktgenerator gelieferter DOT-Dateiname.
 * @return Feste AST-/Abhängigkeitsbezeichnung, funktionsbezogenes CFG-Label oder der Originalname.
 */
function graphArtifactLabel(fileName: string): string {
    if (fileName === 'graphvizAST.dot') return 'Abstract Syntax Tree (AST)';
    if (fileName === 'graphvizDep.dot') return 'Dependency graph';
    const cfg = fileName.match(/^graphvizCfg_(.+)\.dot$/);
    return cfg ? `Control Flow Graph: ${cfg[1]}` : fileName;
}

/**
 * @brief Rendert das ausgewählte DOT-Artefakt mit Viz.js als SVG.
 *
 * Verwendet bei fehlender Auswahl das erste Artefakt, zeigt parallel den DOT-
 * Quelltext und initialisiert Viz.js höchstens einmal. Das erzeugte SVG ersetzt
 * den bisherigen Canvas-Inhalt. Bei einem Renderfehler bleibt der DOT-Text erhalten,
 * während die fehlerhafte grafische Darstellung entfernt wird.
 */
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

/**
 * @brief Entfernt die gerenderte SVG-Grafik und optional den angezeigten DOT-Quelltext.
 * @param clearDot Bestimmt, ob neben dem Canvas auch die DOT-Ausgabe geleert wird.
 */
function clearRenderedGraph(clearDot = true): void {
    document.querySelector('#graph-canvas')?.replaceChildren();
    if (clearDot) setTextContent('#graph-dot-source', '');
}

/**
 * @brief Setzt Meldung und Fehlerdarstellung des Graphbereichs.
 * @param message Anzuzeigender Status- oder Fehlertext.
 * @param error Aktiviert die CSS-Fehlerklasse für die Meldung.
 */
function setGraphStatus(message: string, error = false): void {
    const status = document.querySelector<HTMLElement>('#graph-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', error);
}

/**
 * @brief Erzeugt aus dem Editorinhalt getrennten VeriFast- und ausführbaren C-Code.
 *
 * Löscht zuerst alle vorherigen C-Ergebnisse und VeriFast-Marker. Nach erfolgreicher
 * Pseudo2-Validierung erzeugt der Generator eine Vertragsvariante samt Source-Map
 * sowie eine zweite Variante mit konkreter Runtime. Beide Texte und die Map werden
 * für Speichern, native Ausführung und Verifikation zwischengespeichert.
 *
 * @return `true`, wenn beide C-Varianten vollständig erzeugt wurden, sonst `false`.
 */
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

/**
 * @brief Kompiliert und startet die ausführbare C-Variante über den lokalen Vite-Endpunkt.
 *
 * Erzeugt den C-Code immer frisch aus dem Editor, deaktiviert während der Anfrage
 * den Run-Button und sendet Code, Dateiname und Zeitlimit als JSON an `/api/run-c`.
 * HTTP-Fehler, ungültige Antworten und nicht verfügbare lokale Endpunkte werden im
 * C-Ausgabebereich angezeigt. Der Button wird in einem `finally`-Block stets reaktiviert.
 */
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

/**
 * @brief Stellt VeriFast-C-Code sicher und delegiert dessen Prüfung an die zentrale Verifikationsfunktion.
 *
 * Bereits erzeugter Vertragscode wird wiederverwendet. Fehlt er, versucht die
 * Funktion zuerst eine vollständige C-Generierung und beendet sich bei deren Fehler.
 */
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

/**
 * @brief Sendet den zuletzt erzeugten Vertragscode samt Source-Map an `/api/verifast`.
 *
 * Die Anfrage enthält C-Code, C-/Pseudo2-Dateinamen und die Zeilenabbildung. Eine
 * erfolgreiche Antwort wird in Monaco-Marker umgesetzt, springt zur ersten auf
 * Pseudo2 abgebildeten Diagnose und wird ohne lokale Dateipfade formatiert. Netzwerk-
 * oder JSON-Fehler erklären, dass der lokale Vite-Endpunkt benötigt wird.
 */
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

/**
 * @brief Speichert den zuletzt erzeugten VeriFast-C-Code über Dateidialog oder Download.
 *
 * Falls noch kein C-Code existiert, wird er zuerst aus dem aktuellen Editorinhalt
 * erzeugt. Die File-System-Access-API erhält einen `.c`-Filter; als Fallback dient
 * ein Blob-Download. Abbruch, Erfolg und Fehler erscheinen im gemeinsamen Speicherstatus.
 */
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
        const saveFilePicker = (window as Window & {
            /** @brief Optional vom Browser bereitgestellte File-System-Access-Speicherfunktion. */
            showSaveFilePicker?: SaveFilePicker
        }).showSaveFilePicker;
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

/**
 * @brief Liest den vollständigen Text des aktiven Monaco-Modells.
 * @return Aktueller Pseudo2-Quelltext oder ein leerer String ohne gestarteten Editor.
 */
function getCurrentCode(): string {
    return editorApp?.getEditor()?.getModel()?.getValue() ?? "";
}

/**
 * @brief Leitet einen sicheren Pseudo2-Dateivorschlag aus der URI des Editor-Modells ab.
 * @return Vorhandener `.pseudo2`-Dateiname oder `program.pseudo2` als Fallback.
 */
function getSuggestedFileName(): string {
    const path = editorApp?.getEditor()?.getModel()?.uri?.path ?? '';
    const parts = path.split('/').filter(Boolean);
    const fileName = parts[parts.length - 1] ?? '';
    return fileName.endsWith('.pseudo2') ? fileName : 'program.pseudo2';
}

/**
 * @brief Ersetzt die Pseudo2-Endung des aktuellen Dateivorschlags durch `.c`.
 * @return Zum Editorinhalt passender C-Dateiname.
 */
function getSuggestedCFileName(): string {
    return getSuggestedFileName().replace(/\.pseudo2$/i, '.c');
}

/**
 * @brief Erzeugt die kompakte Benutzeranzeige eines vollständigen VeriFast-Ergebnisses.
 *
 * Kombiniert Gesamtstatus, Exitcode, optionalen Erfolg der Runtime-Kerne und die
 * auf Pseudo2-Zeilen konzentrierte Diagnoseliste. Serverpfade und Befehlszeilen
 * werden bewusst nicht in die Benutzeroberfläche übernommen.
 *
 * @param result Strukturierte Antwort des VeriFast-Endpunkts.
 * @return Mehrzeiliger Text für das VeriFast-Ausgabefeld.
 */
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

/**
 * @brief Formatiert Compilererkennung, Kompilierung oder C-Programmlauf phasengerecht.
 *
 * Fehlende Compiler und Kompilierungsfehler erhalten eigene Überschriften. Bei
 * erfolgreichem Programmlauf wird ausschließlich die eigentliche Programmausgabe
 * samt `stderr` gezeigt; technische Erfolgszeilen werden unterdrückt. Nur Fehlerfälle
 * ergänzen Exitcode, Compilername und Timeoutstatus.
 *
 * @param result Strukturierte Antwort des C-Ausführungsendpunkts.
 * @return Für die C-Ausgabe geeigneter mehrzeiliger Text.
 */
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

/**
 * @brief Wählt die für Pseudo2-Benutzer relevanten VeriFast-Diagnosen aus.
 *
 * Sobald abgebildete Pseudo2-Zeilen existieren, werden ausschließlich diese
 * Meldungen gezeigt. Andernfalls bleiben echte Fehler erhalten, reine Hinweise
 * werden zu einer verständlichen Statusmeldung zusammengefasst.
 *
 * @param result Strukturierte VeriFast-Antwort.
 * @return Formatierte Diagnosen oder eine eindeutige Meldung ohne Diagnose.
 */
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

/**
 * @brief Formatiert genau eine VeriFast-Diagnose mit bevorzugter Pseudo2-Zeilennummer.
 * @param error Zu formatierender Fehler oder Hinweis.
 * @return Meldung mit Pseudo2-Zeile, sofern sie durch die Source-Map bekannt ist.
 */
function formatVeriFastDiagnostic(error: NonNullable<VeriFastApiResult['errors']>[number]): string {
    if (typeof error.sourceLine === 'number') {
        return `${error.kind}: Pseudo2 line ${error.sourceLine}: ${error.message}`;
    }

    return `${error.kind}: ${error.message}`;
}

/**
 * @brief Positioniert und fokussiert Monaco auf der ersten abgebildeten VeriFast-Diagnose.
 * @param result VeriFast-Ergebnis mit optionalen Pseudo2-Quellzeilen.
 */
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

/**
 * @brief Überträgt abgebildete VeriFast-Fehler als Monaco-Marker in das Pseudo2-Modell.
 *
 * Hinweise und nicht auf Pseudo2 abgebildete C-Meldungen werden nicht markiert.
 * Jede betroffene Pseudo2-Zeile erhält einen Fehlerbereich über ihre gesamte Länge.
 *
 * @param result VeriFast-Ergebnis mit strukturierter Source-Map-Zuordnung.
 */
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

/** @brief Entfernt alle von VeriFast gesetzten Marker aus dem aktiven Monaco-Modell. */
function clearVeriFastEditorDiagnostics(): void {
    const model = editorApp?.getEditor()?.getModel();
    if (model) {
        monaco.editor.setModelMarkers(model, 'verifast', []);
    }
}

/**
 * @brief Installiert und verwaltet zusätzliche Monaco-Dekorationen für Pseudo2-Tokens.
 *
 * Eine vorhandene Installation wird zuerst vollständig freigegeben. Für das aktive
 * Modell werden Schlüsselwörter, Zahlen, Strings, Zeichen und Kommentare zeilenweise
 * klassifiziert. Änderungen am Inhalt oder Modell berechnen die Dekorationen neu;
 * der gemeinsame Disposable entfernt Dekorationen und beide Ereignisabonnements.
 *
 * @param editor Zu erweiternde Monaco-Instanz oder `undefined` während des Lebenszykluswechsels.
 */
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

    /**
     * @brief Berechnet alle Pseudo2-Dekorationen des aktuellen Modells vollständig neu.
     *
     * Bei einem Modellwechsel ohne neues Modell werden bestehende Dekorationen
     * entfernt. Andernfalls sammelt die Funktion die Tokenbereiche jeder Zeile und
     * ersetzt sie atomar über `deltaDecorations`.
     */
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

/**
 * @brief Erkennt hervorzuhebende Pseudo2-Tokens in genau einer Quelltextzeile.
 *
 * Der Scanner arbeitet von links nach rechts. Kommentare beenden die Analyse der
 * restlichen Zeile. Strings und Zeichen berücksichtigen Escape-Sequenzen, Zahlen
 * erlauben Dezimalpunkte und Bezeichner werden nur bei einem Eintrag in der
 * Schlüsselwortmenge markiert. Alle Monaco-Spalten werden von null- auf einsbasiert umgerechnet.
 *
 * @param line Inhalt einer einzelnen Monaco-Modellzeile.
 * @param lineNumber Einsbasierte Zeilennummer im Editor.
 * @param keywords Menge aller hervorzuhebenden Pseudo2- und VeriFast-Schlüsselwörter.
 * @param decorations Zielsammlung, an die erkannte Monaco-Dekorationen angehängt werden.
 */
function collectPseudo2Decorations(
    line: string,
    lineNumber: number,
    keywords: Set<string>,
    decorations: monaco.editor.IModelDeltaDecoration[]
): void {
    let index = 0;

    /**
     * @brief Fügt für einen nullbasierten Zeichenbereich eine Monaco-Inline-Dekoration hinzu.
     * @param startIndex Nullbasierter Anfang einschließlich.
     * @param endIndex Nullbasiertes Ende ausschließlich.
     * @param inlineClassName CSS-Klasse der erkannten Tokenart.
     */
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

/**
 * @brief Liefert eine einmalig erzeugte, dateisystemunabhängige Pseudo2-Serviceinstanz.
 * @return Für alle Browser-Generierungen wiederverwendete Langium-Dienste.
 */
function getExecutionServices(): ReturnType<typeof createPseudo2Services> {
    executionServices ??= createPseudo2Services(EmptyFileSystem);
    return executionServices;
}

/**
 * @brief Parst und validiert Pseudo2-Quelltext in einem isolierten In-Memory-Dokument.
 *
 * Jede Ausführung erhält eine eindeutige URI, damit Langium keine älteren Dokumente
 * wiederverwendet. Der DocumentBuilder führt die vollständige Validierung aus.
 * Fehler werden mit einsbasierter Zeile und Spalte formatiert; ein AST wird nur bei
 * vollständig fehlerfreier Eingabe zurückgegeben.
 *
 * @param code Aktueller Pseudo2-Quelltext aus Monaco.
 * @return Validierter Programm-AST oder Liste aller Fehlerdiagnosen.
 */
async function parsePseudo2(code: string): Promise<{
    /** @brief Validierter Programm-AST; bei mindestens einem Fehler bleibt er leer. */
    program?: Program;
    /** @brief Formatierte Langium-Fehlerdiagnosen mit Zeile und Spalte. */
    errors: string[]
}> {
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

/**
 * @brief Führt generierten JavaScript-Code mit einer lokalen Konsolenabstraktion aus.
 *
 * `log`, `warn` und `error` werden in derselben geordneten Textliste gesammelt,
 * sodass keine Ausgabe in die Browserkonsole verloren geht. Der Code läuft im
 * Strict Mode über einen dynamischen Funktionskörper. Ausnahmen werden formatiert
 * zurückgegeben, ohne bereits erzeugte Programmausgabe zu verwerfen.
 *
 * @param source Vollständiger, vom Pseudo2-Generator erzeugter JavaScript-Quelltext.
 * @return Erfasste Konsolenausgaben und optionaler Laufzeitfehler.
 */
function executeJavaScript(source: string): {
    /** @brief In Aufrufreihenfolge erfasste Ausgaben von `console.log`, `warn` und `error`. */
    output: string[];
    /** @brief Formatierter Laufzeitfehler, sofern die JavaScript-Ausführung fehlschlug. */
    error?: string
} {
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

/**
 * @brief Wandelt beliebige JavaScript-Werte robust in sichtbaren Ausgabetext um.
 *
 * Strings bleiben unverändert, Error-Objekte behalten Name und Meldung, und
 * `undefined` wird ausdrücklich dargestellt. Für übrige Werte wird JSON bevorzugt;
 * zyklische oder nicht serialisierbare Werte fallen auf die Standardkonvertierung zurück.
 *
 * @param value Zu formatierender Laufzeit- oder Serverwert.
 * @return Lesbare Textdarstellung ohne auslösbare JSON-Ausnahme.
 */
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

/**
 * @brief Formatiert einen unbekannten Fehlerwert für die Benutzeroberfläche.
 * @param error Gefangener JavaScript-Fehler oder beliebiger geworfener Wert.
 * @return Name und Meldung eines Errors, sonst die allgemeine Wertformatierung.
 */
function formatError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return formatValue(error);
}

/**
 * @brief Setzt sicher den Textinhalt des ersten Elements eines CSS-Selektors.
 * @param selector CSS-Selektor des Zielelements.
 * @param textContent Uninterpretiert einzusetzender Text; HTML wird nicht ausgewertet.
 */
function setTextContent(selector: string, textContent: string): void {
    const element = document.querySelector(selector);
    if (element) {
        element.textContent = textContent;
    }
}

/**
 * @brief Zeigt den aktuellen Speicher- oder Downloadstatus in der Werkzeugleiste.
 * @param textContent Anzuzeigende Erfolgs-, Abbruch- oder Fehlermeldung.
 */
function setSaveStatus(textContent: string): void {
    setTextContent('#save-status', textContent);
}

/**
 * @brief Löst einen Browserdownload für Textcode ohne File-System-Access-API aus.
 *
 * Erzeugt kurzzeitig Blob, Objekt-URL und unsichtbaren Link, startet dessen Download
 * programmatisch und gibt danach DOM-Knoten sowie Objekt-URL sofort wieder frei.
 *
 * @param code Vollständiger zu speichernder Quelltext.
 * @param fileName Vom Browser zu verwendender Downloadname.
 */
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

/**
 * @brief Erkennt den standardisierten Benutzerabbruch eines Browser-Dateidialogs.
 * @param error Im Speichervorgang gefangener Fehlerwert.
 * @return `true` ausschließlich für eine DOMException mit Namen `AbortError`.
 */
function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * @brief Richtet den per Maus und Tastatur bedienbaren Splitter zwischen Editor und Ergebnis ein.
 *
 * Beide Bereiche behalten eine Mindestbreite. Pointerbewegungen verändern die rechte
 * Breite relativ zur Layoutkante; Pointerende persistiert das Verhältnis im Local
 * Storage. Doppelklick setzt die Standardbreite zurück. Pfeiltasten, Home und End
 * unterstützen barrierefreie Größenänderung, während Fensteränderungen das gespeicherte
 * Verhältnis beibehalten und Monaco nach jeder Anpassung neu layoutet wird.
 */
function installWorkspaceSplitter(): void {
    const layout = document.querySelector<HTMLElement>('.workspace-layout');
    const splitter = document.querySelector<HTMLElement>('#workspace-splitter');
    if (!layout || !splitter) return;

    let resultRatio = readStoredResultPaneRatio();
    let resultWidth = DEFAULT_RESULT_PANE_WIDTH;
    let dragging = false;

    /**
     * @brief Begrenzt und übernimmt eine gewünschte Ergebnisbreite in CSS und ARIA.
     * @param requestedWidth Gewünschte Breite des rechten Bereichs in Pixeln.
     * @param persist Speichert das daraus entstehende Verhältnis dauerhaft.
     */
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

    /**
     * @brief Berechnet während eines aktiven Ziehvorgangs die Breite aus der Pointerposition.
     * @param event Aktuelles Pointermove-Ereignis des Browserfensters.
     */
    const resizeFromPointer = (event: PointerEvent) => {
        if (!dragging) return;
        const layoutBounds = layout.getBoundingClientRect();
        applyWidth(layoutBounds.right - event.clientX);
    };

    /**
     * @brief Beendet einen Ziehvorgang, entfernt visuelle Zustände und persistiert die Endbreite.
     */
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

/**
 * @brief Passt Monacos interne Renderfläche an die aktuelle Größe des Editorbereichs an.
 */
function layoutEditorToPane(): void {
    const editor = editorApp?.getEditor();
    const container = document.querySelector<HTMLElement>('#monaco-editor-root');
    if (!editor || !container) return;
    editor.layout({
        width: container.clientWidth,
        height: container.clientHeight
    });
}

/**
 * @brief Liest ein gültiges Größenverhältnis des Ergebnisbereichs aus dem Local Storage.
 * @return Wert strikt zwischen 0 und 1 oder 0 bei fehlenden, ungültigen oder gesperrten Daten.
 */
function readStoredResultPaneRatio(): number {
    try {
        const stored = Number(localStorage.getItem(RESULT_PANE_RATIO_KEY));
        return Number.isFinite(stored) && stored > 0 && stored < 1 ? stored : 0;
    } catch {
        return 0;
    }
}


/**
 * @brief Initialisiert die Interaktion der vollständigen Pseudo2-Workbench.
 *
 * Installiert zuerst den Splitter und bindet danach alle Buttons, Tabs und die
 * Graphauswahl an ihre fachlichen Aktionen. Die anfänglichen C- und VeriFast-
 * Ausgabefelder werden geleert. Initialisierungsfehler werden abgefangen und in
 * der Browserkonsole protokolliert, damit das Modul den Seitenstart nicht abbricht.
 */
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

/** @brief Öffentlicher, fachlich benannter Alias zum Starten der Pseudo2-Workbench. */
export const runPseudo2 = runDsl;


/**
 * @brief Erzeugt den dedizierten Modul-Worker des Pseudo2-Language-Servers.
 * @return Noch nicht anderweitig verwendete Workerinstanz mit lesbarem Debugnamen.
 */
const loadWorkerRegular = () => {
    // Language Server preparation
    console.log(`Langium worker URL: ${workerUrl}`);
    return new Worker(workerUrl, {
        type: 'module',
        name: 'Pseudo2 Server Regular',  //TBC
    });
};


