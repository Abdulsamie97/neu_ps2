/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import importMetaUrlPlugin from '@codingame/esbuild-import-meta-url-plugin';
import vsixPlugin from '@codingame/monaco-vscode-rollup-vsix-plugin';
import { runCSource } from './packages/cli/src/c-runner.js';
import { runVeriFast, type VeriFastResult } from './packages/cli/src/verifast.js';

/// <reference lib="rolldown-vite/config" />

const DEFAULT_VERIFAST_EXE = path.resolve(__dirname, 'verifast-26.01', 'bin', 'verifast.exe');
const VERIFIED_RUNTIME_FILES = [
    path.resolve(__dirname, 'runtime', 'c', 'pseudo2_heap_runtime.c'),
    path.resolve(__dirname, 'runtime', 'c', 'pseudo2_scalar_runtime.c')
];
const MAX_VERIFAST_BODY_BYTES = 5 * 1024 * 1024;
const DEFAULT_VERIFAST_TIMEOUT_MS = 60_000;
let cRunInProgress = false;

export const definedViteConfig = defineConfig({
    build: {
        rollupOptions: {
            input: {
                index: path.resolve(__dirname, 'index.html'),
                pseudo2Workbench: path.resolve(__dirname, 'packages/web/pseudo2-workbench.html'),
                // json_classic: path.resolve(__dirname, 'packages/examples/json_classic.html'),
                // json: path.resolve(__dirname, 'packages/examples/json.html'),
                // browser: path.resolve(__dirname, 'packages/examples/browser.html'),
                // langium_extended: path.resolve(__dirname, 'packages/examples/langium_extended.html'),
                // python: path.resolve(__dirname, 'packages/examples/python.html'),
                // groovy: path.resolve(__dirname, 'packages/examples/groovy.html'),
                // clangd: path.resolve(__dirname, 'packages/examples/clangd.html'),
                // appPlayground: path.resolve(__dirname, 'packages/examples/appPlayground.html'),
                // twoLangaugeClients: path.resolve(__dirname, 'packages/examples/two_langauge_clients.html'),
                // reactAppPlayground: path.resolve(__dirname, 'packages/examples/react_appPlayground.html'),
                // reactStatemachine: path.resolve(__dirname, 'packages/examples/react_statemachine.html'),
                // reactPython: path.resolve(__dirname, 'packages/examples/react_python.html'),
                // tsExtHost: path.resolve(__dirname, 'packages/examples/tsExtHost.html')
            }
        }
    },
    resolve: {
        // not needed here, see https://github.com/TypeFox/monaco-languageclient#vite-dev-server-troubleshooting
        // dedupe: ['vscode']
    },
    server: {
        port: 20002,
        cors: {
            origin: '*'
        },
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
        watch: {
            ignored: [
                '**/.chrome/**/*'
            ]
        }
    },
    optimizeDeps: {
        exclude: [
            '@codingame/monaco-vscode-textmate-service-override'
        ],
        esbuildOptions: {
            plugins: [
                importMetaUrlPlugin
            ]
        },
        // TB: no idea what is really needed here        
        include: [
            // '@codingame/monaco-vscode-standalone-languages',
            // '@codingame/monaco-vscode-standalone-css-language-features',
            // '@codingame/monaco-vscode-standalone-html-language-features',
            // '@codingame/monaco-vscode-standalone-json-language-features',
            // '@codingame/monaco-vscode-standalone-typescript-language-features',
            // '@testing-library/react',
            'langium',
            'langium/lsp',
            'langium/grammar',
            'vscode/localExtensionHost',
            'vscode-jsonrpc',
            'vscode-languageclient',
            'vscode-languageserver',
            'vscode-languageserver/browser.js',
            'vscode-languageserver-protocol',
            'vscode-oniguruma',
            'vscode-textmate'
        ]
    },
    plugins: [
        pseudo2WorkbenchRoutePlugin(),
        pseudo2VeriFastApiPlugin(),
        pseudo2CRunApiPlugin(),
        vsixPlugin()  // Enable to load VS Code extensions packaged as .vsix files,
        //    react()
    ],
    define: {
        rootDirectory: JSON.stringify(__dirname),
        // Server-provided Content-Length header may be gzipped, get the real size in build time
        // __WASM_SIZE__: fs.existsSync(clangdWasmLocation) ? fs.statSync(clangdWasmLocation).size : 0
    },
    worker: {
        format: 'es'
    }
});

export default definedViteConfig;

type VeriFastApiRequest = {
    code?: unknown;
    fileName?: unknown;
    sourceFile?: unknown;
    sourceMap?: unknown;
    extraArgs?: unknown;
    timeoutMs?: unknown;
};

type CRunApiRequest = {
    code?: unknown;
    fileName?: unknown;
    stdin?: unknown;
    timeoutMs?: unknown;
};

type VeriFastProcessResult = VeriFastResult;

type CSourceMapEntry = {
    generatedLine: number;
    sourceLine: number;
};

function pseudo2WorkbenchRoutePlugin(): Plugin {
    return {
        name: 'pseudo2-workbench-route',
        configureServer(server) {
            server.middlewares.use((req, _res, next) => {
                const requestPath = req.url?.split('?')[0];
                if (requestPath === '/pseudo2-workbench' || requestPath === '/pseudo2-workbench/') {
                    req.url = '/packages/web/pseudo2-workbench.html';
                }
                next();
            });

            server.httpServer?.once('listening', () => {
                setTimeout(() => {
                    const localUrls = server.resolvedUrls?.local ?? [];
                    const baseUrl = localUrls[0] ?? `http://localhost:${server.config.server.port ?? 20002}/`;
                    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
                    server.config.logger.info(`  -> Pseudo2 Workbench: ${normalizedBaseUrl}pseudo2-workbench`);
                    server.config.logger.info('     JavaScript execution, C execution, VeriFast verification, and Graphviz views.');
                }, 0);
            });
        }
    };
}

function pseudo2VeriFastApiPlugin(): Plugin {
    return {
        name: 'pseudo2-verifast-api',
        configureServer(server) {
            server.middlewares.use('/api/verifast', (req, res) => {
                void handleVeriFastApi(req, res);
            });
        }
    };
}

function pseudo2CRunApiPlugin(): Plugin {
    return {
        name: 'pseudo2-c-run-api',
        configureServer(server) {
            server.middlewares.use('/api/run-c', (req, res) => {
                void handleCRunApi(req, res);
            });
        }
    };
}

async function handleCRunApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Use POST /api/run-c.' });
        return;
    }
    if (!isTrustedLocalOrigin(req)) {
        sendJson(res, 403, { ok: false, error: 'Cross-origin local tool requests are not allowed.' });
        return;
    }
    let body: CRunApiRequest;
    try {
        body = await readJsonBody<CRunApiRequest>(req);
    } catch (error) {
        sendJson(res, 400, { ok: false, error: formatServerError(error) });
        return;
    }

    if (typeof body.code !== 'string' || body.code.trim().length === 0) {
        sendJson(res, 400, { ok: false, error: 'Request body must contain non-empty string property "code".' });
        return;
    }

    const requestedTimeout = typeof body.timeoutMs === 'number' ? body.timeoutMs : 10_000;
    const timeoutMs = Math.min(Math.max(Math.floor(requestedTimeout), 100), 60_000);
    if (cRunInProgress) {
        sendJson(res, 429, { ok: false, error: 'Another C program is already running.' });
        return;
    }
    cRunInProgress = true;
    try {
        const result = await runCSource(
            body.code,
            sanitizeCFileName(typeof body.fileName === 'string' ? body.fileName : 'program.c'),
            {
                timeoutMs,
                stdin: typeof body.stdin === 'string' ? body.stdin : undefined
            }
        );
        sendJson(res, 200, result);
    } catch (error) {
        sendJson(res, 200, {
            ok: false,
            stage: 'run',
            exitCode: 1,
            stdout: '',
            stderr: formatServerError(error)
        });
    } finally {
        cRunInProgress = false;
    }
}

async function handleVeriFastApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Use POST /api/verifast.' });
        return;
    }
    if (!isTrustedLocalOrigin(req)) {
        sendJson(res, 403, { ok: false, error: 'Cross-origin local tool requests are not allowed.' });
        return;
    }

    let body: VeriFastApiRequest;
    try {
        body = await readJsonBody(req);
    } catch (error) {
        sendJson(res, 400, { ok: false, error: formatServerError(error) });
        return;
    }

    if (typeof body.code !== 'string' || body.code.trim().length === 0) {
        sendJson(res, 400, { ok: false, error: 'Request body must contain non-empty string property "code".' });
        return;
    }

    const verifastExe = DEFAULT_VERIFAST_EXE;
    const extraArgs = Array.isArray(body.extraArgs) ? body.extraArgs.filter((arg): arg is string => typeof arg === 'string') : [];
    const timeoutMs = normalizeVeriFastTimeout(body.timeoutMs);
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pseudo2-verifast-'));
    const file = path.join(tempDir, sanitizeCFileName(typeof body.fileName === 'string' ? body.fileName : 'program.c'));

    await fs.promises.writeFile(file, body.code, 'utf8');

    if (!fs.existsSync(verifastExe)) {
        sendJson(res, 200, {
            ok: false,
            exitCode: 127,
            stdout: '',
            stderr: `VeriFast executable not found: ${verifastExe}`,
            errors: [],
            file,
            verifastExe
        });
        return;
    }

    const runtimeChecks: Array<{ component: string; ok: boolean; exitCode: number }> = [];
    for (const runtimeFile of VERIFIED_RUNTIME_FILES) {
        const runtimeResult = await runVeriFastProcess(verifastExe, runtimeFile, [], timeoutMs);
        runtimeChecks.push({
            component: path.basename(runtimeFile),
            ok: runtimeResult.ok,
            exitCode: runtimeResult.exitCode
        });
        if (!runtimeResult.ok) {
            sendJson(res, 200, { ...runtimeResult, runtimeChecks });
            return;
        }
    }

    const result = mapVeriFastResultToSource(
        await runVeriFastProcess(verifastExe, file, extraArgs, timeoutMs),
        parseSourceMap(body.sourceMap),
        typeof body.sourceFile === 'string' ? body.sourceFile : undefined
    );
    sendJson(res, 200, {
        ...result,
        runtimeChecks
    });
}

function parseSourceMap(value: unknown): CSourceMapEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap(entry => {
        if (
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as Partial<CSourceMapEntry>).generatedLine === 'number' &&
            typeof (entry as Partial<CSourceMapEntry>).sourceLine === 'number'
        ) {
            return [{
                generatedLine: (entry as CSourceMapEntry).generatedLine,
                sourceLine: (entry as CSourceMapEntry).sourceLine
            }];
        }
        return [];
    });
}

function mapVeriFastResultToSource(
    result: VeriFastProcessResult,
    sourceMap: CSourceMapEntry[],
    sourceFile: string | undefined
): VeriFastProcessResult {
    if (sourceMap.length === 0) {
        return result;
    }

    const byGeneratedLine = new Map(sourceMap.map(entry => [entry.generatedLine, entry]));
    return {
        ...result,
        errors: result.errors.map(error => {
            const mapped = byGeneratedLine.get(error.line);
            if (!mapped) {
                return error;
            }
            return {
                ...error,
                sourceFile,
                sourceLine: mapped.sourceLine
            };
        })
    };
}

function readJsonBody<T = VeriFastApiRequest>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;

        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_VERIFAST_BODY_BYTES) {
                reject(new Error('Request body is too large.'));
                destroyReadable(req);
                return;
            }
            chunks.push(chunk);
        });

        req.on('error', reject);
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
            } catch (error) {
                reject(error);
            }
        });
    });
}

function destroyReadable(stream: IncomingMessage): void {
    stream.destroy();
}

function runVeriFastProcess(
    verifastExe: string,
    file: string,
    extraArgs: string[],
    timeoutMs: number
): Promise<VeriFastProcessResult> {
    return runVeriFast({
        verifastExe,
        file,
        extraArgs,
        compileOnly: true,
        timeoutMs
    });
}

function normalizeVeriFastTimeout(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.min(Math.floor(value), 5 * 60_000)
        : DEFAULT_VERIFAST_TIMEOUT_MS;
}

function sanitizeCFileName(fileName: string): string {
    const baseName = path.basename(fileName).replace(/[^a-zA-Z0-9_.-]/g, '_');
    return baseName.endsWith('.c') ? baseName : `${baseName || 'program'}.c`;
}

function isTrustedLocalOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try {
        const url = new URL(origin);
        return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    } catch {
        return false;
    }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(value, null, 2));
}

function formatServerError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return String(error);
}
