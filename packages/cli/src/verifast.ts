// packages/cli/src/verifast.ts
import { spawn } from 'node:child_process';

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

export async function runVeriFast(args: {
  verifastExe: string;
  file: string;
  extraArgs?: string[];
  compileOnly?: boolean;
}): Promise<VeriFastResult> {
  const { verifastExe, file, extraArgs = [], compileOnly = true } = args;
  const vfArgs = [...(compileOnly ? ['-c'] : []), ...extraArgs, file];

  return await new Promise((resolve) => {
    const child = spawn(verifastExe, vfArgs, {
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));

    child.on('close', (code: number | null) => {
    const exitCode = code ?? 1;

      const text = (stdout + '\n' + stderr).split(/\r?\n/);

      const errors: VeriFastError[] = [];
      for (const line of text) {
        const m = line.match(VF_LINE_RE);
        if (!m) continue;
        errors.push({
          file: m[1],
          line: Number(m[2]),
          colFrom: Number(m[3]),
          colTo: Number(m[4]),
          kind: m[5] as 'error' | 'note',
          message: m[6].trim(),
        });
      }

      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        errors,
      });
    });
  });
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
