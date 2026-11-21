/**
 * @file debug-breakpoints.ts
 * @brief Haltepunktliste und lokaler Debug-Entwurf fuer die Browser-Editoren.
 * @author Abdul
 */

import type { LangiumParser } from 'langium';
import { parseDebugCondition, type DebugConditionInput } from '../runtime/debug-breakpoint.js';

export interface BreakpointSettings {
  enabled: boolean;
  condition?: DebugConditionInput;
}

export interface EditorBreakpoint extends BreakpointSettings {
  line: number;
}

type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const MAX_DRAFT_LENGTH = 1_000_000;
const MAX_STORED_BREAKPOINTS = 2048;

/** Liest Quelltext und Marker zusammen; aus dem Speicher kommen keine ausfuehrbaren Ausdruecke. */
export function loadBreakpointDraft(
  key: string,
  getParser: () => Pick<LangiumParser, 'parse'>,
  storage?: StorageAccess
): { source: string; breakpoints: EditorBreakpoint[] } | undefined {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(key);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as { version?: unknown; source?: unknown; breakpoints?: unknown } | null;
    if (saved?.version !== 1 || typeof saved.source !== 'string' || saved.source.length > MAX_DRAFT_LENGTH
      || !Array.isArray(saved.breakpoints) || saved.breakpoints.length > MAX_STORED_BREAKPOINTS) return undefined;
    const lineCount = saved.source.split('\n').length;
    const breakpoints = new Map<number, EditorBreakpoint>();
    for (const entry of saved.breakpoints) {
      if (!entry || typeof entry !== 'object') continue;
      const { line, enabled, condition } = entry as { line?: unknown; enabled?: unknown; condition?: unknown };
      if (typeof line !== 'number' || !Number.isSafeInteger(line) || line < 1 || line > lineCount || typeof enabled !== 'boolean') continue;
      const point: EditorBreakpoint = { line, enabled };
      if (condition !== undefined) {
        if (typeof condition !== 'string') continue;
        const parsed = parseDebugCondition(condition, getParser());
        if ('error' in parsed) continue;
        point.condition = { source: condition, expression: parsed.expression };
      }
      breakpoints.set(line, point);
    }
    return breakpoints.size ? { source: saved.source, breakpoints: [...breakpoints.values()] } : undefined;
  } catch {
    return undefined;
  }
}

/** Speichert nur Entwuerfe mit Haltepunkten. Ohne Browserspeicher bleiben sie sitzungsbezogen. */
export function saveBreakpointDraft(key: string, source: string, breakpoints: EditorBreakpoint[], storage?: StorageAccess): void {
  try {
    const area = storage ?? globalThis.localStorage;
    if (!breakpoints.length || source.length > MAX_DRAFT_LENGTH || breakpoints.length > MAX_STORED_BREAKPOINTS) {
      area.removeItem(key);
      return;
    }
    area.setItem(key, JSON.stringify({ version: 1, source, breakpoints: breakpoints.map(point => ({
      line: point.line, enabled: point.enabled, condition: point.condition?.source
    })) }));
  } catch {
    try { (storage ?? globalThis.localStorage).removeItem(key); } catch { /* Speicher nicht verfuegbar. */ }
  }
}

/** Fuehrt Textarea-Marker auf unveraenderten Zeilen mit; ersetzte mehrzeilige Bereiche verlieren ihre Marker. */
export function rebaseTextareaBreakpoints(oldSource: string, newSource: string, breakpoints: EditorBreakpoint[]): EditorBreakpoint[] {
  const before = oldSource.split('\n');
  const after = newSource.split('\n');
  let prefix = 0;
  while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > prefix && newEnd > prefix && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const singleLineEdit = oldEnd - prefix === 1 && newEnd - prefix === 1;
  return breakpoints.flatMap(point => {
    if (point.line <= prefix || (singleLineEdit && point.line === prefix + 1)) return [point];
    if (point.line > oldEnd) return [{ ...point, line: point.line + newEnd - oldEnd }];
    return [];
  });
}

/** Rendert die sortierte Liste, ohne bei einer Aktualisierung den Tastaturfokus zu verlieren. */
export function createBreakpointPanel(container: HTMLDetailsElement, actions: {
  jump(line: number): void;
  edit(line: number): void;
  toggle(line: number, enabled: boolean): void;
  remove(line: number): void;
}) {
  const summary = document.createElement('summary');
  const list = document.createElement('ul');
  list.className = 'debug-breakpoint-list';
  container.replaceChildren(summary, list);

  return (breakpoints: EditorBreakpoint[]): void => {
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && list.contains(active) ? active.dataset.breakpointControl : undefined;
    const controls = new Map<string, HTMLElement>();
    summary.textContent = `Haltepunkte (${breakpoints.length})`;
    list.replaceChildren();
    if (!breakpoints.length) {
      const empty = document.createElement('li');
      empty.className = 'debug-breakpoint-empty';
      empty.textContent = 'Keine Haltepunkte.';
      list.append(empty);
    }
    for (const point of [...breakpoints].sort((a, b) => a.line - b.line)) {
      const row = document.createElement('li');
      row.className = 'debug-breakpoint-row';
      const control = (kind: string, element: HTMLElement) => {
        const key = `${point.line}:${kind}`;
        element.dataset.breakpointControl = key;
        controls.set(key, element);
      };
      const button = (kind: string, text: string, title: string, listener: () => void) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.textContent = text;
        element.title = title;
        element.addEventListener('click', listener);
        control(kind, element);
        return element;
      };
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.checked = point.enabled;
      enabled.setAttribute('aria-label', `Haltepunkt in Zeile ${point.line} aktiv`);
      enabled.addEventListener('change', () => actions.toggle(point.line, enabled.checked));
      control('enabled', enabled);

      const jump = button('jump', `Zeile ${point.line}`, `Zu Zeile ${point.line} springen`, () => actions.jump(point.line));
      jump.className = 'debug-breakpoint-jump';
      if (point.condition) {
        const condition = document.createElement('code');
        condition.textContent = point.condition.source;
        jump.append(condition);
      }
      const edit = button('edit', 'Bedingung', `Bedingung in Zeile ${point.line} bearbeiten`, () => actions.edit(point.line));
      edit.setAttribute('aria-label', edit.title);
      const remove = button('remove', '\u00d7', `Haltepunkt in Zeile ${point.line} entfernen`, () => actions.remove(point.line));
      remove.setAttribute('aria-label', remove.title);
      row.append(enabled, jump, edit, remove);
      list.append(row);
    }
    if (focusKey) (controls.get(focusKey) ?? summary).focus({ preventScroll: true });
  };
}
