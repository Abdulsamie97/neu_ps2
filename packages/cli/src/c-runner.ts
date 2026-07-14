import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const DEFAULT_RUN_TIMEOUT_MS = 10_000;
const COMPILE_TIMEOUT_MS = 30_000;
const MAX_CAPTURE_BYTES = 1024 * 1024;

export type CCompilerKind = 'gnu' | 'msvc';

export type CCompiler = {
    command: string;
    displayName: string;
    kind: CCompilerKind;
    env?: NodeJS.ProcessEnv;
};

export type CExecutionResult = {
    ok: boolean;
    stage: 'compiler' | 'compile' | 'run';
    compiler?: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    compileStdout?: string;
    compileStderr?: string;
    timedOut?: boolean;
};

export type CExecutionOptions = {
    compiler?: string;
    timeoutMs?: number;
    stdin?: string;
};

type ProcessResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
};

export function resolveCCompiler(preferred = process.env.PSEUDO2_C_COMPILER ?? process.env.CC): CCompiler | undefined {
    if (preferred) {
        return resolveDirectCompiler(preferred);
    }

    for (const command of ['gcc', 'clang', 'cc']) {
        const compiler = resolveDirectCompiler(command);
        if (compiler) return compiler;
    }

    if (process.platform === 'win32') {
        const directMsvc = resolveDirectCompiler('cl.exe');
        if (directMsvc) return directMsvc;
        return resolveVisualStudioCompiler();
    }

    return undefined;
}

export async function runCSource(
    code: string,
    fileName = 'program.c',
    options: CExecutionOptions = {}
): Promise<CExecutionResult> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pseudo2-c-source-'));
    const sourceFile = path.join(tempDir, sanitizeCFileName(fileName));
    try {
        await fs.writeFile(sourceFile, code, 'utf8');
        return await compileAndRunCFile(sourceFile, options);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

export async function compileAndRunCFile(
    sourceFile: string,
    options: CExecutionOptions = {}
): Promise<CExecutionResult> {
    const compiler = resolveCCompiler(options.compiler);
    if (!compiler) {
        return {
            ok: false,
            stage: 'compiler',
            exitCode: 127,
            stdout: '',
            stderr: options.compiler
                ? `Configured C compiler was not found: ${options.compiler}`
                : 'No C compiler found. Install GCC, Clang, or Visual Studio C++ Build Tools, or set PSEUDO2_C_COMPILER.'
        };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pseudo2-c-run-'));
    const executable = path.join(tempDir, process.platform === 'win32' ? 'program.exe' : 'program');
    const compileArgs = compilerArguments(compiler, path.resolve(sourceFile), executable, tempDir);

    try {
        const compileResult = await runProcess(compiler.command, compileArgs, {
            cwd: tempDir,
            env: compiler.env,
            timeoutMs: COMPILE_TIMEOUT_MS
        });
        const hiddenPaths = [path.resolve(sourceFile), executable, tempDir];
        const compileStdout = scrubPaths(compileResult.stdout, hiddenPaths);
        const compileStderr = scrubPaths(compileResult.stderr, hiddenPaths);

        if (compileResult.exitCode !== 0 || compileResult.timedOut) {
            return {
                ok: false,
                stage: 'compile',
                compiler: compiler.displayName,
                exitCode: compileResult.exitCode,
                stdout: '',
                stderr: compileStderr || compileStdout || 'C compilation failed.',
                compileStdout,
                compileStderr,
                timedOut: compileResult.timedOut
            };
        }

        const runResult = await runProcess(executable, [], {
            cwd: tempDir,
            timeoutMs: normalizeTimeout(options.timeoutMs),
            stdin: options.stdin
        });
        return {
            ok: runResult.exitCode === 0 && !runResult.timedOut,
            stage: 'run',
            compiler: compiler.displayName,
            exitCode: runResult.exitCode,
            stdout: scrubPaths(runResult.stdout, hiddenPaths),
            stderr: scrubPaths(runResult.stderr, hiddenPaths),
            compileStdout,
            compileStderr,
            timedOut: runResult.timedOut
        };
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

function resolveDirectCompiler(command: string): CCompiler | undefined {
    const kind = compilerKind(command);
    const probe = spawnSync(command, kind === 'msvc' ? ['/?'] : ['--version'], {
        encoding: 'utf8',
        stdio: 'ignore',
        windowsHide: true
    });
    if (probe.error) return undefined;
    return {
        command,
        displayName: compilerDisplayName(command, kind),
        kind
    };
}

function resolveVisualStudioCompiler(): CCompiler | undefined {
    const vswhere = path.join(
        process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
        'Microsoft Visual Studio',
        'Installer',
        'vswhere.exe'
    );
    const query = spawnSync(vswhere, [
        '-latest',
        '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'installationPath'
    ], {
        encoding: 'utf8',
        windowsHide: true
    });
    const installationPath = query.stdout?.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (query.error || !installationPath) return undefined;

    const vsDevCmd = path.join(installationPath, 'Common7', 'Tools', 'VsDevCmd.bat');
    const environment = loadVisualStudioEnvironment(vsDevCmd);
    if (!environment) return undefined;

    const probe = spawnSync('cl.exe', ['/?'], {
        env: environment,
        stdio: 'ignore',
        windowsHide: true
    });
    if (probe.error) return undefined;
    return {
        command: 'cl.exe',
        displayName: 'MSVC cl',
        kind: 'msvc',
        env: environment
    };
}

function loadVisualStudioEnvironment(vsDevCmd: string): NodeJS.ProcessEnv | undefined {
    const result = spawnSync(
        process.env.ComSpec ?? 'cmd.exe',
        ['/d', '/s', '/c', `call "${vsDevCmd}" -no_logo -arch=x64 -host_arch=x64 >nul && set`],
        {
            encoding: 'utf8',
            windowsHide: true,
            windowsVerbatimArguments: true,
            maxBuffer: 4 * 1024 * 1024
        }
    );
    if (result.error || result.status !== 0) return undefined;

    const environment: NodeJS.ProcessEnv = { ...process.env };
    for (const line of result.stdout.split(/\r?\n/)) {
        const separator = line.indexOf('=');
        if (separator <= 0) continue;
        environment[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return environment;
}

function compilerArguments(compiler: CCompiler, sourceFile: string, executable: string, tempDir: string): string[] {
    if (compiler.kind === 'msvc') {
        return [
            '/nologo',
            '/TC',
            '/std:c11',
            sourceFile,
            `/Fo:${path.join(tempDir, 'program.obj')}`,
            `/Fe:${executable}`
        ];
    }
    return ['-std=c11', '-O0', sourceFile, '-o', executable, '-lm'];
}

function compilerKind(command: string): CCompilerKind {
    const name = path.basename(command).toLowerCase();
    return name === 'cl' || name === 'cl.exe' || name.startsWith('clang-cl') ? 'msvc' : 'gnu';
}

function compilerDisplayName(command: string, kind: CCompilerKind): string {
    const name = path.basename(command).replace(/\.exe$/i, '');
    if (kind === 'msvc' && name.toLowerCase() === 'cl') return 'MSVC cl';
    return name;
}

function runProcess(
    command: string,
    args: string[],
    options: {
        cwd: string;
        env?: NodeJS.ProcessEnv;
        timeoutMs: number;
        stdin?: string;
    }
): Promise<ProcessResult> {
    return new Promise(resolve => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            windowsHide: true
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;

        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, options.timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout = appendCaptured(stdout, chunk.toString('utf8'));
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr = appendCaptured(stderr, chunk.toString('utf8'));
        });
        child.on('error', error => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({
                exitCode: 1,
                stdout,
                stderr: appendCaptured(stderr, `${stderr ? '\n' : ''}${error.message}`),
                timedOut
            });
        });
        child.on('close', code => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({
                exitCode: timedOut ? 124 : (code ?? 1),
                stdout,
                stderr,
                timedOut
            });
        });

        if (options.stdin !== undefined) child.stdin.end(options.stdin);
        else child.stdin.end();
    });
}

function appendCaptured(current: string, next: string): string {
    if (Buffer.byteLength(current, 'utf8') >= MAX_CAPTURE_BYTES) return current;
    const combined = current + next;
    if (Buffer.byteLength(combined, 'utf8') <= MAX_CAPTURE_BYTES) return combined;
    return `${Buffer.from(combined, 'utf8').subarray(0, MAX_CAPTURE_BYTES).toString('utf8')}\n[output truncated]`;
}

function scrubPaths(value: string, paths: string[]): string {
    return paths.reduce((result, candidate) => {
        if (!candidate) return result;
        return result.replaceAll(candidate, path.basename(candidate));
    }, value);
}

function sanitizeCFileName(fileName: string): string {
    const baseName = path.basename(fileName).replace(/[^a-zA-Z0-9_.-]/g, '_');
    return baseName.endsWith('.c') ? baseName : `${baseName || 'program'}.c`;
}

function normalizeTimeout(timeoutMs: number | undefined): number {
    return Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0 ? Math.floor(timeoutMs as number) : DEFAULT_RUN_TIMEOUT_MS;
}
