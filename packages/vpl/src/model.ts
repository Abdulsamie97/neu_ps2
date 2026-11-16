/**
 * @file model.ts
 * @brief Definiert Schutzgrenzen und gemeinsame Datentypen des VPL-Runners.
 * @author Abdul
 */

import type { Program } from 'pseudo2-language';

/** Standardlaufzeit eines direkt gestarteten Pseudo2-Programms. */
export const DEFAULT_RUN_TIMEOUT_MS = 5_000;
/** Standardlaufzeit eines einzelnen Bewertungstests. */
export const DEFAULT_TEST_TIMEOUT_MS = 2_000;
/** Untere Grenze fuer ein konfiguriertes Zeitlimit. */
export const MIN_TIMEOUT_MS = 100;
/** Obere Grenze fuer ein konfiguriertes Zeitlimit. */
export const MAX_TIMEOUT_MS = 30_000;
/** Maximale kombinierte Standardausgabe und Fehlerausgabe eines Testprozesses. */
export const MAX_OUTPUT_BYTES = 256 * 1024;
/** Maximale Groesse einer Pseudo2-Abgabe. */
export const MAX_SOURCE_BYTES = 1024 * 1024;
/** Maximale Groesse einer Bewertungsdatei. */
export const MAX_MANIFEST_BYTES = 1024 * 1024;
/** Maximale Zahl einzelner Tests in einer Aufgabe. */
export const MAX_TEST_COUNT = 100;
/** Obergrenze fuer Strukturkriterien pro Aufgabe und Eintraege pro Regelliste. */
export const MAX_STRUCTURAL_CHECK_COUNT = 100;

/** Im ausfuehrbaren AST erkennbare Operationsarten. */
export const STRUCTURAL_OPERATIONS = [
  'loop', 'for', 'while', 'do-while', 'print', 'throw', 'new', 'array-create', 'array-index'
] as const;
export type StructuralOperation = typeof STRUCTURAL_OPERATIONS[number];

/** Im Pseudo2-Programm erlaubte Operatoren, ohne Spezifikationssyntax. */
export const STRUCTURAL_OPERATORS = [
  '=', '+=', '-=', '*=', '/=', '++', '--', '||', '&&', '==', '!=',
  '<', '<=', '>', '>=', '+', '-', '*', '/', '%', 'mod', '^', '!'
] as const;
export type StructuralOperator = typeof STRUCTURAL_OPERATORS[number];

/** Schweregrad einer normalisierten Langium-Diagnose. */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';
/** Bewertungsmodus einer Aufgabe. */
export type EvaluationMode = 'program' | 'function';

/** Eine auf Pseudo2-Zeilen und -Spalten bezogene Diagnose. */
export interface SourceDiagnostic {
  /** Fehler blockieren die Ausfuehrung; Warnungen und Hinweise nicht. */
  severity: DiagnosticSeverity;
  /** Einsbasierte Startzeile. */
  line: number;
  /** Einsbasierte Startspalte. */
  column: number;
  /** Meldung des Parsers, Linkers oder Validators. */
  message: string;
}

/** Ergebnis eines vollstaendigen Parse-, Link- und Validierungslaufs. */
export interface AnalysisResult {
  /** Gelinkter AST, sofern keine Fehlerdiagnose vorhanden ist. */
  program?: Program;
  /** Alle Diagnosen des Dokuments. */
  diagnostics: SourceDiagnostic[];
}

/** Ergebnis eines isolierten generierten JavaScript-Prozesses. */
export interface ExecutionResult {
  /** Vom Programm geschriebene Standardausgabe. */
  stdout: string;
  /** Bereinigte Fehlerausgabe ohne temporaere Hostpfade. */
  stderr: string;
  /** Exit-Code des Kindprozesses; bei Signalen kann er fehlen. */
  exitCode: number | null;
  /** Kennzeichnet den Abbruch wegen des Zeitlimits. */
  timedOut: boolean;
  /** Kennzeichnet den Abbruch wegen zu grosser Ausgabe. */
  outputLimitExceeded: boolean;
  /** Fehler beim Starten des Kindprozesses. */
  spawnError?: string;
}

/** Ein einzelner oeffentlicher oder versteckter Bewertungstest. */
export interface AssignmentTest {
  /** Anzeigename des Tests. */
  name: string;
  /** Erwartete Standardausgabe. */
  expectedOutput: string;
  /** Gewicht des Tests innerhalb der Gesamtbewertung. */
  points: number;
  /** Optionaler Pseudo2-Testcode, der an die Abgabe angehaengt wird. */
  harness?: string;
  /** Optionales testspezifisches Zeitlimit. */
  timeoutMs?: number;
  /** Vergleicht bei true nur normalisierte Folgen von Leerraum. */
  normalizeWhitespace: boolean;
  /** Anonymisiert den Test und unterdrueckt Harness-spezifische Fehlerdetails. */
  hidden: boolean;
}

/** Validierte Konfiguration einer Moodle-VPL-Aufgabe. */
export interface AssignmentManifest {
  /** Versionsnummer des Dateiformats. */
  version: 1;
  /** Name der Aufgabe fuer die Rueckmeldung. */
  title: string;
  /** Programmtest oder Funktionstest mit angehaengtem Harness. */
  mode: EvaluationMode;
  /** Maximale Moodle-Bewertung. */
  maxGrade: number;
  /** Standardzeitlimit fuer alle Tests ohne eigenen Wert. */
  defaultTimeoutMs: number;
  /** Geordnete Liste der auszufuehrenden Tests. */
  tests: AssignmentTest[];
  /** Strukturkriterien fuer den validierten AST der Abgabe, ohne Test-Harness. */
  structuralChecks: StructuralCheck[];
}

/** Erwartetes Struct-Feld mit optionalem Element- oder Skalar-Typ. */
export interface StructuralField {
  name: string;
  type?: string;
  array: boolean;
}

/** Erwartete Struct-Methode mit optionaler Anzahl sichtbarer Parameter. */
export interface StructuralMethod {
  name: string;
  arity?: number;
}

/** Vorgaben fuer die Deklaration eines globalen Structs. */
export interface StructuralStruct {
  name: string;
  fields: StructuralField[];
  methods: StructuralMethod[];
}

/** Regeln fuer den Rumpf einer Funktion oder qualifizierten Struct-Methode. */
export interface StructuralScope {
  in: string;
  includeCallees: boolean;
  requiredCalls: string[];
  requiredFields: string[];
  requiredArrayAccesses: string[];
  requiredConstructions: string[];
  forbiddenCalls: string[];
  forbiddenOperations: StructuralOperation[];
  forbiddenOperators: StructuralOperator[];
  /** Falls angegeben, sind nur diese Aufrufziele erlaubt, auch bei einer leeren Liste. */
  allowedCalls?: string[];
}

/** Ein eigenstaendig bewertetes Kriterium; alle Teilregeln muessen erfuellt sein. */
export interface StructuralCheck {
  name: string;
  points: number;
  struct?: StructuralStruct;
  scopes: StructuralScope[];
}

/** Rueckmeldung zu einer Teilregel, gegebenenfalls mit Position in der Abgabe. */
export interface StructuralIssue {
  message: string;
  location?: { line: number; column: number };
}

/** Strukturpunkte werden vergeben, wenn keine Teilregel verletzt wurde. */
export interface StructuralCheckResult {
  check: StructuralCheck;
  issues: StructuralIssue[];
}

/** Ergebnis eines einzelnen Bewertungstests. */
export interface TestResult {
  /** Zugehoerige Testdefinition. */
  test: AssignmentTest;
  /** true, wenn Validierung, Ausfuehrung und Ausgabevergleich erfolgreich waren. */
  passed: boolean;
  /** Kurze, bereits fuer Studierende geeignete Fehlerbeschreibung. */
  details?: string;
}
