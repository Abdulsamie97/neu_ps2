/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 TypeFox and others.
 * Licensed under the MIT License. See LICENSE in the package root for license information.
 * ------------------------------------------------------------------------------------------ */

import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import importMetaUrlPlugin from '@codingame/esbuild-import-meta-url-plugin';
import vsixPlugin from '@codingame/monaco-vscode-rollup-vsix-plugin';

/// <reference lib="rolldown-vite/config" />

const DEFAULT_VERIFAST_EXE = path.resolve(__dirname, 'verifast-26.01', 'bin', 'verifast.exe');
const MAX_VERIFAST_BODY_BYTES = 5 * 1024 * 1024;
const VF_LINE_RE = /^(.*)\((\d+),(\d+)-(\d+)\):\s*(error|note):\s*(.*)$/;

export const definedViteConfig = defineConfig({
    build: {
        rollupOptions: {
            input: {
                index: path.resolve(__dirname, 'index.html'),
                // json_classic: path.resolve(__dirname, 'packages/examples/json_classic.html'),
                // json: path.resolve(__dirname, 'packages/examples/json.html'),
                // browser: path.resolve(__dirname, 'packages/examples/browser.html'),
                // langium_extended: path.resolve(__dirname, 'packages/examples/langium_extended.html'),
                // helloworld: path.resolve(__dirname, 'web/helloworld.html'),
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
        pseudo2VeriFastApiPlugin(),
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
    verifastExe?: unknown;
    extraArgs?: unknown;
};

type VeriFastError = {
    file: string;
    line: number;
    colFrom: number;
    colTo: number;
    kind: 'error' | 'note';
    message: string;
};

type VeriFastProcessResult = {
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    errors: VeriFastError[];
};

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

async function handleVeriFastApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Use POST /api/verifast.' });
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

    const verifastExe = typeof body.verifastExe === 'string' && body.verifastExe.trim().length > 0
        ? body.verifastExe
        : process.env.VERIFAST_EXE ?? DEFAULT_VERIFAST_EXE;
    const extraArgs = Array.isArray(body.extraArgs) ? body.extraArgs.filter((arg): arg is string => typeof arg === 'string') : [];
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

    const result = await runVeriFastProcess(verifastExe, file, extraArgs);
    sendJson(res, 200, {
        ...result,
        file,
        verifastExe,
        command: [quoteForDisplay(verifastExe), '-c', ...extraArgs, quoteForDisplay(file)].join(' ')
    });
}

function readJsonBody(req: NodeJS.ReadableStream): Promise<VeriFastApiRequest> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;

        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_VERIFAST_BODY_BYTES) {
                reject(new Error('Request body is too large.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('error', reject);
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as VeriFastApiRequest);
            } catch (error) {
                reject(error);
            }
        });
    });
}

function runVeriFastProcess(verifastExe: string, file: string, extraArgs: string[]): Promise<VeriFastProcessResult> {
    return new Promise(resolve => {
        const child = spawn(verifastExe, ['-c', ...extraArgs, file], {
            windowsHide: true,
            shell: false
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', error => {
            if (settled) {
                return;
            }
            settled = true;
            resolve({
                ok: false,
                exitCode: 1,
                stdout,
                stderr: `${stderr}${stderr ? '\n' : ''}${formatServerError(error)}`,
                errors: parseVeriFastErrors(stdout, stderr)
            });
        });
        child.on('close', code => {
            if (settled) {
                return;
            }
            settled = true;
            const exitCode = code ?? 1;
            resolve({
                ok: exitCode === 0,
                exitCode,
                stdout,
                stderr,
                errors: parseVeriFastErrors(stdout, stderr)
            });
        });
    });
}

function parseVeriFastErrors(stdout: string, stderr: string): VeriFastError[] {
    const errors: VeriFastError[] = [];
    for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
        const match = line.match(VF_LINE_RE);
        if (!match) {
            continue;
        }
        errors.push({
            file: match[1],
            line: Number(match[2]),
            colFrom: Number(match[3]),
            colTo: Number(match[4]),
            kind: match[5] as 'error' | 'note',
            message: match[6].trim()
        });
    }
    return errors;
}

function sanitizeCFileName(fileName: string): string {
    const baseName = path.basename(fileName).replace(/[^a-zA-Z0-9_.-]/g, '_');
    return baseName.endsWith('.c') ? baseName : `${baseName || 'program'}.c`;
}

function quoteForDisplay(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
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
