/**
 * @file debug-breakpoint-dialog.ts
 * @brief Gemeinsamer Dialog fuer bedingte Browser-Haltepunkte.
 * @author Abdul
 */

import type { LangiumParser } from 'langium';
import { parseDebugCondition, type DebugConditionInput } from '../runtime/debug-breakpoint.js';
import { MAX_DEBUG_EXPRESSION_LENGTH } from '../runtime/debug-expression.js';

/** Bearbeitet eine Bedingung; eine leere Eingabe setzt einen normalen Haltepunkt. */
export function createDebugBreakpointDialog(getParser: () => Pick<LangiumParser, 'parse'>) {
  const dialog = document.createElement('dialog');
  dialog.className = 'debug-breakpoint-dialog';
  const form = document.createElement('form');
  const heading = document.createElement('h2');
  heading.id = 'debug-breakpoint-heading';
  dialog.setAttribute('aria-labelledby', heading.id);
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.maxLength = MAX_DEBUG_EXPRESSION_LENGTH;
  input.placeholder = 'i == 10';
  label.append('Bedingung (optional)', input);
  const feedback = document.createElement('div');
  feedback.className = 'debug-breakpoint-feedback';
  feedback.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.className = 'debug-breakpoint-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Abbrechen';
  cancel.addEventListener('click', () => dialog.close());
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Speichern';
  actions.append(cancel, save);
  form.append(heading, label, feedback, actions);
  dialog.append(form);
  document.body.append(dialog);

  let apply: ((condition?: DebugConditionInput) => void) | undefined;
  const showError = (message: string) => {
    feedback.textContent = message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  input.addEventListener('input', () => showError(''));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const source = input.value.trim();
    if (source) {
      const result = parseDebugCondition(source, getParser());
      if ('error' in result) {
        showError(result.error);
        return;
      }
      apply?.({ source, expression: result.expression });
    } else {
      apply?.();
    }
    dialog.close();
  });

  return (line: number, previous: DebugConditionInput | undefined, onSave: (condition?: DebugConditionInput) => void) => {
    apply = onSave;
    heading.textContent = `Haltepunkt in Zeile ${line}`;
    input.value = previous?.source ?? '';
    showError('');
    dialog.showModal();
    input.focus();
    input.select();
  };
}
