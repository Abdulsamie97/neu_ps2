// packages/cli/src/verifast.ts
import { spawn } from 'node:child_process';
import * as path from 'node:path';

export type VeriFastError = {
  file: string;
  line: number;
  colFrom: number;
  colTo: number;
  kind: 'error' | 'note';
  message: string;
  sourceFile?: string;
  sourceLine?: number;
};

export type VeriFastResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  errors: VeriFastError[];
  timedOut?: boolean;
};

export type VeriFastRuntimeCheck = {
  component: string;
  ok: boolean;
  exitCode: number;
  summary: string;
};

export type VeriFastBundleResult = VeriFastResult & {
  runtimeChecks: VeriFastRuntimeCheck[];
  verificationTarget: 'runtime' | 'program';
};

export type CSourceMapEntry = {
  generatedLine: number;
  sourceLine: number;
};

export type CSourceMapFile = {
  sourceFile?: string;
  mappings: CSourceMapEntry[];
};

const VF_LINE_RE =
  /^(.*)\((\d+),(\d+)-(\d+)\):\s*(error|note):\s*(.*)$/;
const DEFAULT_TIMEOUT_MS = 60_000;

export async function runVeriFast(args: {
  verifastExe: string;
  file: string;
  extraArgs?: string[];
  compileOnly?: boolean;
  timeoutMs?: number;
}): Promise<VeriFastResult> {
  const { verifastExe, file, extraArgs = [], compileOnly = true } = args;
  const timeoutMs = normalizeTimeout(args.timeoutMs);
  const vfArgs = [...(compileOnly ? ['-c'] : []), ...withSourceOptions(extraArgs), file];

  return await new Promise((resolve) => {
    const child = spawn(verifastExe, vfArgs, {
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (exitCode: number, errorMessage?: string): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (errorMessage) {
        stderr += `${stderr ? '\n' : ''}${errorMessage}`;
      }

      resolve({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        stdout,
        stderr,
        errors: parseVeriFastErrors(stdout, stderr),
        timedOut
      });
    };

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', error => {
      finish(1, error.message);
    });
    child.on('close', code => {
      finish(timedOut ? 124 : (code ?? 1));
    });

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish(124, `VeriFast timed out after ${timeoutMs} ms.`);
    }, timeoutMs);
  });
}

export async function runVeriFastBundle(args: {
  verifastExe: string;
  file: string;
  runtimeFiles: string[];
  extraArgs?: string[];
  compileOnly?: boolean;
  timeoutMs?: number;
}): Promise<VeriFastBundleResult> {
  const runtimeChecks: VeriFastRuntimeCheck[] = [];
  for (const runtimeFile of args.runtimeFiles) {
    const result = await runVeriFast({
      verifastExe: args.verifastExe,
      file: runtimeFile,
      compileOnly: true,
      timeoutMs: args.timeoutMs
    });
    runtimeChecks.push({
      component: path.basename(runtimeFile),
      ok: result.ok,
      exitCode: result.exitCode,
      summary: (result.stdout || result.stderr).trim()
    });
    if (!result.ok) {
      return { ...result, runtimeChecks, verificationTarget: 'runtime' };
    }
  }

  const programResult = await runVeriFast({
    verifastExe: args.verifastExe,
    file: args.file,
    extraArgs: args.extraArgs,
    compileOnly: args.compileOnly,
    timeoutMs: args.timeoutMs
  });
  return { ...programResult, runtimeChecks, verificationTarget: 'program' };
}

function withSourceOptions(extraArgs: string[]): string[] {
  return extraArgs.includes('-prover') || extraArgs.includes('-read_options_from_source_file')
    ? extraArgs
    : ['-read_options_from_source_file', ...extraArgs];
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  return Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0
    ? Math.floor(timeoutMs as number)
    : DEFAULT_TIMEOUT_MS;
}

function parseVeriFastErrors(stdout: string, stderr: string): VeriFastError[] {
  const errors: VeriFastError[] = [];
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const match = line.match(VF_LINE_RE);
    if (!match) continue;
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

export function applyCSourceMapToVeriFastResult(result: VeriFastResult, sourceMap: CSourceMapFile): VeriFastResult {
  const byGeneratedLine = new Map<number, CSourceMapEntry>();
  for (const entry of sourceMap.mappings ?? []) {
    byGeneratedLine.set(entry.generatedLine, entry);
  }

  return {
    ...result,
    errors: result.errors.map(error => {
      const mapped = byGeneratedLine.get(error.line);
      if (!mapped) {
        return error;
      }

      return {
        ...error,
        sourceFile: sourceMap.sourceFile,
        sourceLine: mapped.sourceLine
      };
    })
  };
}
