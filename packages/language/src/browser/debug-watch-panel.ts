/**
 * @file debug-watch-panel.ts
 * @brief Gemeinsamer Beobachtungsbereich der Pseudo2-Browser-Debugger.
 * @author Abdul
 */

import type { LangiumParser } from 'langium';
import { MAX_DEBUG_WATCHES } from '../runtime/debug-watch.js';
import { MAX_DEBUG_EXPRESSION_LENGTH, parseDebugExpression, type DebugExpression } from '../runtime/debug-expression.js';
import type { BrowserDebugSession } from '../runtime/variable-inspector.js';
import { createDebugValueElement } from './debug-value-view.js';

/** Verwaltet die Zeilen im Web-Editor und verwirft Antworten aus aelteren Pausen. */
export function createDebugWatchPanel(container: HTMLDetailsElement, getParser: () => Pick<LangiumParser, 'parse'>) {
  const summary = document.createElement('summary');
  summary.textContent = 'Beobachten';

  const form = document.createElement('form');
  form.className = 'debug-watch-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.maxLength = MAX_DEBUG_EXPRESSION_LENGTH;
  input.placeholder = 'A[i + 1]';
  input.setAttribute('aria-label', 'Ausdruck beobachten');
  const add = document.createElement('button');
  add.type = 'submit';
  add.textContent = '+';
  add.title = 'Beobachtung hinzufuegen';
  add.setAttribute('aria-label', add.title);
  form.append(input, add);

  const feedback = document.createElement('div');
  feedback.className = 'debug-watch-feedback';
  feedback.setAttribute('role', 'status');
  const list = document.createElement('div');
  list.className = 'debug-watch-list';
  container.replaceChildren(summary, form, feedback, list);
  container.open = true;

  const watches: { id: string; source: string; expression: DebugExpression; result: HTMLElement }[] = [];
  const expanded = new Set<string>();
  let nextId = 0;
  let revision = 0;
  let session: BrowserDebugSession | undefined;
  let frameId: number | undefined;

  const refresh = () => {
    const requestRevision = ++revision;
    const watchingFrame = session !== undefined && frameId !== undefined;
    for (const watch of watches) {
      watch.result.classList.remove('error');
      watch.result.textContent = watchingFrame ? '...' : 'Nicht angehalten.';
    }
    if (!session || frameId === undefined || watches.length === 0) return;

    const selectedFrame = frameId;
    void session.inspectWatches(selectedFrame, watches.map(watch => watch.expression)).then(results => {
      if (requestRevision !== revision) return;
      watches.forEach((watch, index) => {
        const result = results[index];
        if (!result || 'error' in result) {
          watch.result.classList.add('error');
          watch.result.textContent = result?.error ?? 'Wert nicht verfuegbar.';
        } else {
          watch.result.replaceChildren(createDebugValueElement({ id: watch.id, ...result }, expanded, selectedFrame));
        }
      });
    });
  };

  const setFeedback = (message: string) => {
    feedback.textContent = message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  input.addEventListener('input', () => setFeedback(''));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const source = input.value.trim();
    if (watches.length >= MAX_DEBUG_WATCHES) {
      setFeedback(`Hoechstens ${MAX_DEBUG_WATCHES} Beobachtungen gleichzeitig.`);
      return;
    }
    if (watches.some(watch => watch.source === source)) {
      setFeedback('Dieser Ausdruck wird bereits beobachtet.');
      return;
    }
    const parsed = parseDebugExpression(source, getParser());
    if ('error' in parsed) {
      setFeedback(parsed.error);
      return;
    }
    const row = document.createElement('div');
    row.className = 'debug-watch-row';
    const name = document.createElement('code');
    name.textContent = source;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '\u00d7';
    remove.title = 'Beobachtung entfernen';
    remove.setAttribute('aria-label', `${source}: ${remove.title}`);
    const result = document.createElement('div');
    result.className = 'debug-watch-result';
    result.setAttribute('aria-live', 'polite');
    const watch = { id: `watch-${nextId++}`, source, expression: parsed.expression, result };
    watches.push(watch);
    row.append(name, remove, result);
    list.append(row);
    remove.addEventListener('click', () => {
      watches.splice(watches.indexOf(watch), 1);
      row.remove();
      setFeedback('');
      input.focus();
      refresh();
    });
    input.value = '';
    setFeedback('');
    input.focus();
    refresh();
  });

  return {
    setContext(nextSession?: BrowserDebugSession, nextFrameId?: number): void {
      if (session !== nextSession) expanded.clear();
      session = nextSession;
      frameId = nextFrameId;
      container.hidden = !session;
      refresh();
    }
  };
}
