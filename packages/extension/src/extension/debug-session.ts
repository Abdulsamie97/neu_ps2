/**
 * @file debug-session.ts
 * @brief Verbindet den Pseudo2-Live-Worker mit dem VS-Code-Debug-Adapter-Protokoll.
 * @author Abdul
 */

import type { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import {
    Breakpoint, ContinuedEvent, DebugSession, ExitedEvent, Handles, InitializedEvent,
    OutputEvent, Scope, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread, Variable
} from '@vscode/debugadapter';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { EmptyFileSystem, URI } from 'langium';
import {
    collectStructFieldNames, createPseudo2Services,
    generateProgram, Pseudo2GeneratorContext,
    type ObservedExecutionResult, type PausedExecutionStep, type Program, type VariableValue
} from 'pseudo2-language';
import { createObservedWorker } from './observed-worker.js';

const THREAD_ID = 1;
const DEFAULT_TIMEOUT_MS = 5_000;
let documentCounter = 0;

interface LaunchArguments extends DebugProtocol.LaunchRequestArguments {
    program: string;
    timeoutMs?: number;
}

interface WorkerMessage extends ObservedExecutionResult {
    type?: 'paused' | 'output' | 'variable';
    step?: PausedExecutionStep;
    text?: string;
    variable?: VariableValue;
}

/** Vergleicht Quellpfade auch unter Windows mit dessen ueblicher Gross-/Kleinschreibung. */
function sourceKey(sourcePath: string): string {
    const normalized = path.normalize(sourcePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Implementiert eine Pseudo2-Debug-Sitzung fuer genau eine Quelldatei.
 * Die Quelle wird vom Host geladen; die Sitzung selbst benoetigt keine VS-Code-API.
 */
export class Pseudo2DebugSession extends DebugSession {
    private readonly services = createPseudo2Services(EmptyFileSystem);
    private readonly breakpointLines = new Map<string, Set<number>>();
    private readonly variableHandles = new Handles<VariableValue[]>();
    private completeConfiguration!: () => void;
    private readonly configurationDone = new Promise<void>(resolve => { this.completeConfiguration = resolve; });
    private worker: Worker | undefined;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private paused: PausedExecutionStep | undefined;
    private programPath: string | undefined;
    private timeoutMs = DEFAULT_TIMEOUT_MS;
    private finished = false;
    private noDebug = false;

    constructor(private readonly loadSource: (programPath: string) => Promise<string>) {
        super();
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
    }

    /** Meldet die unterstuetzten DAP-Funktionen und startet die Haltepunktkonfiguration. */
    protected override initializeRequest(response: DebugProtocol.InitializeResponse): void {
        response.body = {
            supportsConfigurationDoneRequest: true,
            supportsTerminateRequest: true,
            supportsEvaluateForHovers: true
        };
        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    /** Ersetzt die Haltepunkte einer Quelldatei und uebertraegt Aenderungen an den Worker. */
    protected override setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): void {
        const sourcePath = args.source.path && this.convertClientPathToDebugger(args.source.path);
        const lines = (args.breakpoints ?? []).map(point => this.convertClientLineToDebugger(point.line));
        if (sourcePath) this.breakpointLines.set(sourceKey(sourcePath), new Set(lines));
        response.body = {
            breakpoints: lines.map(line => new Breakpoint(
                Boolean(sourcePath && line > 0 && (!this.programPath || sourceKey(sourcePath) === sourceKey(this.programPath))),
                this.convertDebuggerLineToClient(line)
            ))
        };
        this.sendResponse(response);
        if (this.worker && !this.noDebug && sourcePath && this.programPath && sourceKey(sourcePath) === sourceKey(this.programPath)) {
            this.worker.postMessage({ command: 'setBreakpoints', breakpoints: this.currentBreakpoints() });
        }
    }

    /** Loest die DAP-Startbarriere nach Uebertragung aller Haltepunkte. */
    protected override configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse): void {
        this.sendResponse(response);
        this.completeConfiguration();
    }

    /** Validiert und generiert Pseudo2 erst nach Abschluss der Debug-Konfiguration. */
    protected override launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: DebugProtocol.LaunchRequestArguments
    ): void {
        void this.launch(response, args as LaunchArguments);
    }

    private async launch(response: DebugProtocol.LaunchResponse, args: LaunchArguments): Promise<void> {
        let launchResponded = false;
        try {
            if (typeof args.program !== 'string' || !args.program.trim()) {
                throw new Error('Eine gespeicherte .pseudo2-Datei muss als program angegeben werden.');
            }
            const programPath = path.resolve(args.program);
            const source = await this.loadSource(programPath);
            const uri = URI.parse(`memory:/vscode-debug-${documentCounter++}.pseudo2`);
            const document = this.services.shared.workspace.LangiumDocumentFactory.fromString(source, uri);
            let javascript: string;
            let fieldNames: Record<string, string>;
            try {
                await this.services.shared.workspace.DocumentBuilder.build([document], { validation: true });
                const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
                if (errors.length) {
                    throw new Error(errors.map(error => `Zeile ${error.range.start.line + 1}: ${error.message}`).join('\n'));
                }
                const program = document.parseResult.value as Program;
                const context = Pseudo2GeneratorContext.fromProgram(program, true, false, true);
                javascript = generateProgram(program, context);
                fieldNames = collectStructFieldNames(program, context);
            } finally {
                this.services.shared.workspace.IndexManager.remove(uri);
                this.services.shared.workspace.LangiumDocuments.deleteDocument(uri);
            }
            await this.configurationDone;
            if (this.finished) return;
            this.programPath = programPath;
            this.timeoutMs = typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
                ? Math.min(120_000, Math.max(100, Math.floor(args.timeoutMs))) : DEFAULT_TIMEOUT_MS;
            this.noDebug = args.noDebug === true;
            this.sendResponse(response);
            launchResponded = true;
            this.startWorker(javascript, fieldNames);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.sendEvent(new OutputEvent(`${message}\n`, 'stderr'));
            if (!launchResponded) this.sendErrorResponse(response, 1001, message);
            this.finish(1);
        }
    }

    /** Leitet Worker-Zwischenmeldungen an Debug Console und VS-Code-Ansichten weiter. */
    private startWorker(javascript: string, fieldNames: Record<string, string>): void {
        const worker = createObservedWorker();
        this.worker = worker;
        worker.on('message', (message: WorkerMessage) => {
            if (this.finished) return;
            if (message.type === 'output' && typeof message.text === 'string') {
                this.sendEvent(new OutputEvent(message.text, 'stdout'));
            } else if (message.type === 'paused' && message.step) {
                this.clearTimeout();
                if (this.noDebug) {
                    this.armTimeout();
                    worker.postMessage({ command: 'continue' });
                } else {
                    this.paused = message.step;
                    this.variableHandles.reset();
                    const reason = message.step.reason === 'entry' ? 'entry'
                        : message.step.reason === 'breakpoint' ? 'breakpoint'
                            : message.step.reason === 'pause' ? 'pause' : 'step';
                    this.sendEvent(new StoppedEvent(reason, THREAD_ID));
                }
            } else if (!message.type) {
                if (message.error) this.sendEvent(new OutputEvent(`Laufzeitfehler: ${message.error}\n`, 'stderr'));
                this.finish(message.error ? 1 : 0);
            }
        });
        worker.on('error', error => {
            if (this.finished) return;
            this.sendEvent(new OutputEvent(`${error.name}: ${error.message}\n`, 'stderr'));
            this.finish(1);
        });
        worker.on('exit', code => {
            if (this.finished) return;
            this.sendEvent(new OutputEvent(`Ausfuehrungsprozess beendet (Code ${code}).\n`, 'stderr'));
            this.finish(1);
        });
        this.armTimeout();
        worker.postMessage({
            source: javascript,
            fieldNames,
            debugMode: true,
            breakpoints: this.noDebug ? [] : this.currentBreakpoints()
        });
    }

    private currentBreakpoints(): number[] {
        return [...(this.breakpointLines.get(sourceKey(this.programPath ?? '')) ?? [])];
    }

    /** Zeitlimit gilt nur waehrend der Ausfuehrung, nicht waehrend einer Debug-Pause. */
    private armTimeout(): void {
        this.clearTimeout();
        this.timer = setTimeout(() => {
            this.sendEvent(new OutputEvent(`Zeitlimit von ${this.timeoutMs / 1000} Sekunden ueberschritten.\n`, 'stderr'));
            this.finish(1);
        }, this.timeoutMs);
    }

    private clearTimeout(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
    }

    /** Liefert den einen Pseudo2-Ausfuehrungsthread fuer die Debug-Ansicht. */
    protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = { threads: [new Thread(THREAD_ID, 'Pseudo2-Programm')] };
        this.sendResponse(response);
    }

    /** Zeigt echte Pseudo2-Aufrufrahmen, beginnend mit dem aktuellsten. */
    protected override stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments
    ): void {
        const source = this.programPath
            ? new Source(path.basename(this.programPath), this.convertDebuggerPathToClient(this.programPath))
            : undefined;
        const frames = [...(this.paused?.frames ?? [])].reverse().map(frame =>
            new StackFrame(frame.id, frame.name, source, this.convertDebuggerLineToClient(frame.line), 1)
        );
        response.body = {
            stackFrames: frames.slice(args.startFrame ?? 0, (args.startFrame ?? 0) + (args.levels || frames.length)),
            totalFrames: frames.length
        };
        this.sendResponse(response);
    }

    /** Trennt lokale Werte des gewaehlten Aufrufs von globalen Variablen. */
    protected override scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        const frame = this.paused?.frames.find(item => item.id === args.frameId);
        const scopes: Scope[] = [];
        if (frame) {
            if (frame.id !== 0) scopes.push(new Scope('Lokal', this.variableHandles.create(frame.variables)));
            scopes.push(new Scope('Global', this.variableHandles.create(this.paused!.globals)));
        }
        response.body = { scopes };
        this.sendResponse(response);
    }

    /** Gibt den bei der letzten Pause beobachteten Pseudo2-Wert als Variable aus. */
    protected override variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
        response.body = {
            variables: (this.variableHandles.get(args.variablesReference) ?? []).map(item => new Variable(item.name, item.value))
        };
        this.sendResponse(response);
    }

    /** Unterstuetzt Hover und Watches fuer Variablennamen, ohne Quellausdruecke auszufuehren. */
    protected override evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
        const name = args.expression?.trim();
        const local = this.paused?.frames.find(frame => frame.id === args.frameId)?.variables;
        const value = local?.find(item => item.name === name) ?? this.paused?.globals.find(item => item.name === name);
        if (!value) {
            this.sendErrorResponse(response, 1002, `Keine beobachtete Variable: ${name ?? ''}`);
            return;
        }
        response.body = { result: value.value, variablesReference: 0 };
        this.sendResponse(response);
    }

    /** Setzt den angehaltenen Worker mit der gewaehlten Schrittart fort. */
    private resume(response: DebugProtocol.Response, command: 'continue' | 'step' | 'over' | 'out'): void {
        if (!this.worker || !this.paused || this.finished) {
            this.sendErrorResponse(response, 1003, 'Das Programm ist nicht angehalten.');
            return;
        }
        this.paused = undefined;
        this.variableHandles.reset();
        this.sendResponse(response);
        this.sendEvent(new ContinuedEvent(THREAD_ID, true));
        this.armTimeout();
        this.worker.postMessage({ command });
    }

    protected override continueRequest(response: DebugProtocol.ContinueResponse): void {
        response.body = { allThreadsContinued: true };
        this.resume(response, 'continue');
    }

    protected override nextRequest(response: DebugProtocol.NextResponse): void { this.resume(response, 'over'); }
    protected override stepInRequest(response: DebugProtocol.StepInResponse): void { this.resume(response, 'step'); }
    protected override stepOutRequest(response: DebugProtocol.StepOutResponse): void { this.resume(response, 'out'); }

    /** Fordert eine Pause bei der naechsten instrumentierten Pseudo2-Zeile an. */
    protected override pauseRequest(response: DebugProtocol.PauseResponse): void {
        this.worker?.postMessage({ command: 'pause' });
        this.sendResponse(response);
    }

    protected override terminateRequest(response: DebugProtocol.TerminateResponse): void {
        this.sendResponse(response);
        this.finish(0);
    }

    protected override disconnectRequest(response: DebugProtocol.DisconnectResponse): void {
        this.sendResponse(response);
        this.finish(0);
    }

    /** Schliesst den Worker und meldet das Sitzungsende genau einmal. */
    private finish(exitCode: number): void {
        if (this.finished) return;
        this.finished = true;
        this.completeConfiguration();
        this.clearTimeout();
        this.paused = undefined;
        this.variableHandles.reset();
        if (this.worker) void this.worker.terminate();
        this.worker = undefined;
        this.sendEvent(new ExitedEvent(exitCode));
        this.sendEvent(new TerminatedEvent());
    }

    override dispose(): void {
        this.finish(0);
        super.dispose();
    }
}
