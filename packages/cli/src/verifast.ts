/**
 * @file verifast.ts
 * @brief Startet VeriFast, strukturiert dessen Diagnosen und ordnet C-Zeilen den Pseudo2-Zeilen zu.
 * @author Abdul
 */

// packages/cli/src/verifast.ts
import { spawn } from 'node:child_process';
import * as path from 'node:path';

/** @brief Beschreibt eine von VeriFast gemeldete Fehler- oder Hinweismeldung. */
export type VeriFastError = {
  /** @brief Enthält den von VeriFast gemeldeten C-Dateipfad. */
  file: string;
  /** @brief Enthält die einsbasierte Zeilennummer im überprüften C-Code. */
  line: number;
  /** @brief Enthält die erste betroffene Spalte. */
  colFrom: number;
  /** @brief Enthält die letzte betroffene Spalte. */
  colTo: number;
  /** @brief Unterscheidet verifikationsverhindernde Fehler von ergänzenden Hinweisen. */
  kind: 'error' | 'note';
  /** @brief Enthält den eigentlichen, von VeriFast ausgegebenen Meldungstext. */
  message: string;
  /** @brief Enthält nach erfolgreicher Abbildung den ursprünglichen Pseudo2-Dateipfad. */
  sourceFile?: string;
  /** @brief Enthält nach erfolgreicher Abbildung die Pseudo2-Quellzeile. */
  sourceLine?: number;
};

/** @brief Enthält das vollständige Ergebnis eines einzelnen VeriFast-Prozesses. */
export type VeriFastResult = {
  /** @brief Gibt an, ob VeriFast mit Exitcode 0 und ohne Zeitüberschreitung endete. */
  ok: boolean;
  /** @brief Enthält den VeriFast-Exitcode beziehungsweise 124 bei einer Zeitüberschreitung. */
  exitCode: number;
  /** @brief Enthält die unveränderte Standardausgabe von VeriFast. */
  stdout: string;
  /** @brief Enthält die Fehlerausgabe einschließlich möglicher Start- oder Timeoutmeldung. */
  stderr: string;
  /** @brief Enthält aus beiden Ausgabekanälen extrahierte strukturierte Diagnosen. */
  errors: VeriFastError[];
  /** @brief Gibt an, ob der Prozess nach Ablauf des Zeitlimits beendet wurde. */
  timedOut?: boolean;
};

/** @brief Fasst das Verifikationsergebnis eines konkreten C-Runtime-Kerns zusammen. */
export type VeriFastRuntimeCheck = {
  /** @brief Nennt die überprüfte Runtime-C-Datei ohne Verzeichnispfad. */
  component: string;
  /** @brief Gibt an, ob diese Runtime-Komponente erfolgreich verifiziert wurde. */
  ok: boolean;
  /** @brief Enthält den Exitcode der einzelnen Runtime-Verifikation. */
  exitCode: number;
  /** @brief Enthält die zusammengefasste, getrimmte VeriFast-Ausgabe. */
  summary: string;
};

/** @brief Erweitert ein VeriFast-Ergebnis um Runtime-Prüfungen und das tatsächlich geprüfte Ziel. */
export type VeriFastBundleResult = VeriFastResult & {
  /** @brief Enthält die Ergebnisse aller bis zum Abbruch geprüften Runtime-Komponenten. */
  runtimeChecks: VeriFastRuntimeCheck[];
  /** @brief Zeigt, ob ein Fehler in der Runtime oder im generierten Programm entstand. */
  verificationTarget: 'runtime' | 'program';
};

/** @brief Ordnet genau eine Zeile des generierten C-Codes einer Pseudo2-Zeile zu. */
export type CSourceMapEntry = {
  /** @brief Einsbasierte Zeilennummer in der generierten C-Datei. */
  generatedLine: number;
  /** @brief Einsbasierte Zeilennummer in der ursprünglichen Pseudo2-Datei. */
  sourceLine: number;
};

/** @brief Beschreibt die persistierte Source-Map einer generierten C-Datei. */
export type CSourceMapFile = {
  /** @brief Optionaler absoluter oder relativer Pfad der ursprünglichen Pseudo2-Datei. */
  sourceFile?: string;
  /** @brief Enthält sämtliche bekannten C-zu-Pseudo2-Zeilenabbildungen. */
  mappings: CSourceMapEntry[];
};

/** @brief Erkennt das von VeriFast verwendete Format für Fehler- und Hinweiszeilen. */
const VF_LINE_RE =
  /^(.*)\((\d+),(\d+)-(\d+)\):\s*(error|note):\s*(.*)$/;
/** @brief Standardzeitlimit einer VeriFast-Ausführung in Millisekunden. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @brief Führt VeriFast für genau eine C-Datei aus und strukturiert sämtliche Diagnosen.
 *
 * Im Standardfall wird `-c` für eine reine Übersetzungs-/Vertragsprüfung ergänzt.
 * Falls keine eigene Quelloption gesetzt wurde, aktiviert die Funktion außerdem
 * das Lesen von VeriFast-Optionen aus der C-Datei. Beide Ausgabekanäle werden bis
 * zum Prozessende gesammelt. Startfehler und Zeitüberschreitungen werden in genau
 * ein Ergebnis überführt; der Abschlusswächter verhindert mehrfaches Auflösen des Promise.
 *
 * @param args VeriFast-Pfad, C-Datei, Zusatzargumente, Linkmodus und Zeitlimit.
 * @return Strukturiertes VeriFast-Ergebnis mit erkannten Fehlern und Hinweisen.
 */
export async function runVeriFast(args: {
  /** @brief Pfad zur auszuführenden VeriFast-Programmdatei. */
  verifastExe: string;
  /** @brief Pfad der zu verifizierenden C-Datei. */
  file: string;
  /** @brief Zusätzliche, unverändert an VeriFast weitergegebene Argumente. */
  extraArgs?: string[];
  /** @brief Aktiviert standardmäßig `-c` und damit die Prüfung ohne Linkschritt. */
  compileOnly?: boolean;
  /** @brief Maximale VeriFast-Laufzeit in Millisekunden. */
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

    /**
     * @brief Schließt den VeriFast-Lauf genau einmal ab und erzeugt den gemeinsamen Ergebnisdatensatz.
     * @param exitCode Tatsächlicher oder synthetischer Exitcode des Prozesses.
     * @param errorMessage Optionaler Start- oder Timeoutfehler für die Fehlerausgabe.
     */
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

/**
 * @brief Verifiziert Runtime-Kerne sequenziell und anschließend das generierte C-Programm.
 *
 * Jede Runtime-Datei wird bewusst im Compile-only-Modus geprüft. Beim ersten
 * Runtime-Fehler endet die Verarbeitung sofort mit `verificationTarget: runtime`.
 * Nur wenn alle Runtime-Komponenten gültig sind, wird das eigentliche Programm
 * mit den vom Aufrufer gewählten Argumenten und dem gewünschten Linkmodus verifiziert.
 *
 * @param args VeriFast-Konfiguration, Programmdatei und geordnete Runtime-Dateien.
 * @return Bündelergebnis mit Einzelprüfungen und Kennzeichnung des Verifikationsziels.
 */
export async function runVeriFastBundle(args: {
  /** @brief Pfad zur auszuführenden VeriFast-Programmdatei. */
  verifastExe: string;
  /** @brief Pfad des nach den Runtime-Kernen zu verifizierenden C-Programms. */
  file: string;
  /** @brief Geordnete Liste der zuerst separat zu prüfenden Runtime-C-Dateien. */
  runtimeFiles: string[];
  /** @brief Nur an die Verifikation des eigentlichen Programms übergebene Zusatzargumente. */
  extraArgs?: string[];
  /** @brief Aktiviert für das Programm den VeriFast-Compile-only-Modus. */
  compileOnly?: boolean;
  /** @brief Gemeinsames Zeitlimit jedes einzelnen VeriFast-Prozesses. */
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

/**
 * @brief Ergänzt die Standardoption zum Lesen von VeriFast-Anweisungen aus der C-Datei.
 *
 * Eine explizite Prover-Auswahl oder bereits vorhandene Option
 * `-read_options_from_source_file` wird respektiert und nicht verändert.
 *
 * @param extraArgs Vom Benutzer angegebene VeriFast-Argumente.
 * @return Ursprüngliche oder um die Standardquelloption erweiterte Argumentliste.
 */
function withSourceOptions(extraArgs: string[]): string[] {
  return extraArgs.includes('-prover') || extraArgs.includes('-read_options_from_source_file')
    ? extraArgs
    : ['-read_options_from_source_file', ...extraArgs];
}

/**
 * @brief Normalisiert ein optionales positives VeriFast-Zeitlimit.
 * @param timeoutMs Gewünschte maximale Laufzeit in Millisekunden.
 * @return Abgerundeter positiver Wert oder 60000 Millisekunden als Standard.
 */
function normalizeTimeout(timeoutMs: number | undefined): number {
  return Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0
    ? Math.floor(timeoutMs as number)
    : DEFAULT_TIMEOUT_MS;
}

/**
 * @brief Extrahiert strukturierte VeriFast-Diagnosen aus Standard- und Fehlerausgabe.
 *
 * Nur Zeilen, die Dateipfad, Zeilen-/Spaltenbereich, Meldungsart und Text im
 * erwarteten VeriFast-Format enthalten, werden übernommen. Andere Statusausgaben
 * bleiben ausschließlich in `stdout` beziehungsweise `stderr` erhalten.
 *
 * @param stdout Vollständige Standardausgabe des VeriFast-Prozesses.
 * @param stderr Vollständige Fehlerausgabe des VeriFast-Prozesses.
 * @return Fehler und Hinweise in ihrer ursprünglichen Ausgabereihenfolge.
 */
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

/**
 * @brief Ergänzt VeriFast-Diagnosen um die zugehörigen Pseudo2-Quellpositionen.
 *
 * Die Source-Map wird für direkten Zugriff nach generierter C-Zeile indiziert.
 * Diagnosen ohne passende Zuordnung bleiben unverändert; alle übrigen erhalten
 * `sourceFile` und `sourceLine`. Das übergebene Ergebnis wird nicht mutiert.
 *
 * @param result Unverändertes Ergebnis der Verifikation des generierten C-Codes.
 * @param sourceMap Zu dieser C-Datei gehörende Pseudo2-Zeilenabbildung.
 * @return Neues Ergebnis mit soweit möglich ergänzten Pseudo2-Positionen.
 */
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
