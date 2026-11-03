/**
 * @file variables.ts
 * @brief Zeigt Pseudo2-Deklarationen und beobachtete Laufzeitwerte in VS Code.
 * @author Abdul
 */

import { Worker } from 'node:worker_threads';
import * as vscode from 'vscode';
import { EmptyFileSystem, URI } from 'langium';
import {
    OBSERVED_WORKER_SCRIPT,
    collectStructFieldNames,
    collectVariableDefinitions,
    createPseudo2Services,
    generateProgram,
    Pseudo2GeneratorContext,
    type ObservedExecutionResult,
    type Program,
    type VariableDefinition,
    type VariableValue
} from 'pseudo2-language';

const services = createPseudo2Services(EmptyFileSystem);
const RUN_TIMEOUT_MS = 5_000;
let documentCounter = 0;

/** Fuehrt das generierte Programm nur nach einer expliziten VS-Code-Aktion aus. */
function runInWorker(
    source: string,
    fieldNames: Record<string, string>,
    onVariable: (value: VariableValue) => void
): Promise<ObservedExecutionResult> {
    return new Promise(resolve => {
        const bootstrap = `const { parentPort } = require('node:worker_threads');\n`
            + `const self = { postMessage: message => parentPort.postMessage(message) };\n`
            + OBSERVED_WORKER_SCRIPT
            + `\nparentPort.on('message', data => self.onmessage({ data }));`;
        const worker = new Worker(bootstrap, {
            eval: true,
            resourceLimits: { maxOldGenerationSizeMb: 128 }
        });
        const lastValues = new Map<string, VariableValue>();
        let settled = false;
        const finish = (result: ObservedExecutionResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            void worker.terminate();
            resolve(result);
        };
        const timer = setTimeout(() => finish({
            output: [],
            error: `Zeitlimit von ${RUN_TIMEOUT_MS / 1000} Sekunden ueberschritten.`,
            variables: [...lastValues.values()]
        }), RUN_TIMEOUT_MS);
        worker.on('message', (message: ObservedExecutionResult & { type?: string; variable?: VariableValue }) => {
            if (message.type === 'variable' && message.variable) {
                lastValues.set(message.variable.id, message.variable);
                onVariable(message.variable);
            } else {
                finish({
                    output: Array.isArray(message.output) ? message.output.map(String) : [],
                    error: typeof message.error === 'string' ? message.error : undefined,
                    variables: Array.isArray(message.variables) ? message.variables : [...lastValues.values()]
                });
            }
        });
        worker.on('error', error => finish({
            output: [], error: `${error.name}: ${error.message}`, variables: [...lastValues.values()]
        }));
        worker.on('exit', code => {
            if (!settled) finish({
                output: [], error: `Ausfuehrungsprozess beendet (Code ${code}).`, variables: [...lastValues.values()]
            });
        });
        worker.postMessage({ source, fieldNames });
    });
}

/** Ein Eintrag der Explorer-Ansicht, der zur Deklaration springen kann. */
class VariableItem extends vscode.TreeItem {
    constructor(definition: VariableDefinition, observed: VariableValue | undefined, document: vscode.TextDocument) {
        super(definition.name, vscode.TreeItemCollapsibleState.None);
        this.description = `${observed?.value ?? 'Noch nicht ausgefuehrt'}  (${definition.scope}, Z. ${definition.line})`;
        this.tooltip = `${definition.name}: ${observed?.value ?? 'Noch nicht ausgefuehrt'}\n`
            + `${definition.scope}, definiert Zeile ${definition.line}`
            + (observed && observed.changedLine !== definition.line ? `, zuletzt gesetzt Zeile ${observed.changedLine}` : '')
            + (observed && !definition.global ? ' (letzter Wert)' : '');
        this.command = {
            command: 'pseudo2.revealVariable',
            title: 'Zur Deklaration springen',
            arguments: [document.uri, definition.line]
        };
    }
}

/** Haelt die Deklarationen und die zuletzt beobachteten Werte des aktiven Editors. */
class VariableProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly changed = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private document: vscode.TextDocument | undefined;
    private definitions: VariableDefinition[] = [];
    private readonly values = new Map<string, VariableValue>();
    private message = 'Pseudo2-Datei oeffnen';
    private revision = 0;
    private analysisTimer: ReturnType<typeof setTimeout> | undefined;
    private refreshTimer: ReturnType<typeof setTimeout> | undefined;

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (!this.document) return [new vscode.TreeItem(this.message)];
        if (element?.id === 'global' || element?.id === 'local') {
            const global = element.id === 'global';
            return this.definitions.filter(definition => definition.global === global)
                .map(definition => new VariableItem(definition, this.values.get(definition.id), this.document!));
        }
        if (element || this.definitions.length === 0) return [new vscode.TreeItem(this.message)];
        return ([true, false] as const).filter(global => this.definitions.some(definition => definition.global === global))
            .map(global => {
                const group = new vscode.TreeItem(global ? 'Global' : 'Lokal', vscode.TreeItemCollapsibleState.Expanded);
                group.id = global ? 'global' : 'local';
                return group;
            });
    }

    /** Verwirft alte Werte und liest Deklarationen des aktiven Pseudo2-Dokuments. */
    setDocument(document: vscode.TextDocument | undefined): void {
        this.document = document?.languageId === 'pseudo2' ? document : undefined;
        this.values.clear();
        this.definitions = [];
        this.message = this.document ? 'Deklarationen werden gelesen ...' : 'Pseudo2-Datei oeffnen';
        const revision = ++this.revision;
        if (this.analysisTimer) clearTimeout(this.analysisTimer);
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.changed.fire(undefined);
        if (!this.document) return;
        this.analysisTimer = setTimeout(() => {
            if (revision !== this.revision || !this.document) return;
            try {
                const uri = URI.parse(`memory:/vscode-variables-${documentCounter++}.pseudo2`);
                const parsed = services.shared.workspace.LangiumDocumentFactory.fromString(this.document.getText(), uri);
                this.definitions = collectVariableDefinitions(parsed.parseResult.value as Program);
                this.message = this.definitions.length ? '' : 'Keine Variablen';
            } catch {
                this.message = 'Variablen koennen erst nach gueltiger Syntax angezeigt werden';
            }
            this.changed.fire(undefined);
        }, 350);
    }

    /** Setzt die Werte eines gestarteten Laufs; lokale Werte sind zuletzt beobachtet. */
    setExecution(document: vscode.TextDocument, definitions: VariableDefinition[]): number {
        this.document = document;
        this.definitions = definitions;
        this.values.clear();
        if (this.analysisTimer) clearTimeout(this.analysisTimer);
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        const revision = ++this.revision;
        this.changed.fire(undefined);
        return revision;
    }

    updateValue(value: VariableValue, revision: number): void {
        if (revision !== this.revision) return;
        this.values.set(value.id, value);
        if (!this.refreshTimer) {
            this.refreshTimer = setTimeout(() => {
                this.refreshTimer = undefined;
                this.changed.fire(undefined);
            }, 50);
        }
    }

    isCurrent(revision: number): boolean { return revision === this.revision; }

    dispose(): void {
        if (this.analysisTimer) clearTimeout(this.analysisTimer);
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.changed.dispose();
    }
}

/** Registriert die Ansicht, Quellnavigation und den expliziten Ausfuehrungsbefehl. */
export function registerVariableInspector(context: vscode.ExtensionContext): void {
    const provider = new VariableProvider();
    const output = vscode.window.createOutputChannel('Pseudo2-Ausgabe');
    const view = vscode.window.createTreeView('pseudo2.variables', { treeDataProvider: provider });
    context.subscriptions.push(provider, output, view);
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => provider.setDocument(editor?.document)));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document === vscode.window.activeTextEditor?.document) provider.setDocument(event.document);
    }));
    provider.setDocument(vscode.window.activeTextEditor?.document);

    context.subscriptions.push(vscode.commands.registerCommand('pseudo2.revealVariable', async (uri: vscode.Uri, line: number) => {
        const editor = await vscode.window.showTextDocument(uri);
        const position = new vscode.Position(Math.max(0, line - 1), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pseudo2.inspectVariables', async () => {
        const document = vscode.window.activeTextEditor?.document;
        if (!document || document.languageId !== 'pseudo2') {
            void vscode.window.showWarningMessage('Bitte zuerst eine Pseudo2-Datei oeffnen.');
            return;
        }
        if (!vscode.workspace.isTrusted) {
            void vscode.window.showWarningMessage('Die Pseudo2-Ausfuehrung ist nur in einem vertrauenswuerdigen Workspace moeglich.');
            return;
        }
        const source = document.getText();
        const uri = URI.parse(`memory:/vscode-run-${documentCounter++}.pseudo2`);
        const langiumDocument = services.shared.workspace.LangiumDocumentFactory.fromString(source, uri);
        try {
            await services.shared.workspace.DocumentBuilder.build([langiumDocument], { validation: true });
            const errors = (langiumDocument.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
            if (errors.length) {
                output.clear();
                for (const error of errors) {
                    output.appendLine(`Zeile ${error.range.start.line + 1}: ${error.message}`);
                }
                output.show(true);
                return;
            }
            const program = langiumDocument.parseResult.value as Program;
            const generatorContext = Pseudo2GeneratorContext.fromProgram(program, true);
            const definitions = collectVariableDefinitions(program, generatorContext);
            const fieldNames = collectStructFieldNames(program, generatorContext);
            const javascript = generateProgram(program, generatorContext);
            const revision = provider.setExecution(document, definitions);
            output.clear();
            output.appendLine('Programm wird ausgefuehrt ...');
            const result = await runInWorker(javascript, fieldNames, variable => provider.updateValue(variable, revision));
            if (!provider.isCurrent(revision) || document.getText() !== source) return;
            for (const variable of result.variables) provider.updateValue(variable, revision);
            output.clear();
            output.append(result.output.join('') || '(keine Ausgabe)\n');
            if (result.error) output.appendLine(`\nLaufzeitfehler: ${result.error}`);
            output.show(true);
        } catch (error) {
            output.clear();
            output.appendLine(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
            output.show(true);
        } finally {
            services.shared.workspace.IndexManager.remove(uri);
            services.shared.workspace.LangiumDocuments.deleteDocument(uri);
        }
    }));
}
