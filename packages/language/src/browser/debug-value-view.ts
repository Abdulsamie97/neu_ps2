/**
 * @file debug-value-view.ts
 * @brief Gemeinsame aufklappbare Wertedarstellung fuer die Browser-Debugger.
 * @author Abdul
 */

import type { DebugValueSnapshot } from '../runtime/debug-value-snapshot.js';
import type { VariableValue } from '../runtime/variable-inspector.js';

/** Rendert einen Pause-Wert und merkt offene Zweige pro Deklaration und Aufruf. */
export function createDebugValueElement(
  observed: VariableValue,
  expandedPaths: Set<string>,
  frameId?: number
): HTMLElement {
  return renderDebugValue(observed.debugValue ?? { text: observed.value }, [frameId ?? 'global', observed.id], expandedPaths);
}

/** Baut Kindzeilen erst beim Aufklappen und behandelt Namen und Werte als Text. */
function renderDebugValue(
  value: DebugValueSnapshot,
  path: (string | number)[],
  expandedPaths: Set<string>,
  label?: string
): HTMLElement {
  const preview = document.createElement('span');
  preview.className = 'variable-value';
  if (label !== undefined) {
    const name = document.createElement('span');
    name.className = 'debug-value-label';
    name.textContent = `${label}: `;
    preview.append(name);
  }
  preview.append(value.text);

  const children = value.children;
  if (!children?.length) {
    if (value.omitted) preview.append(' (Vorschau begrenzt)');
    return preview;
  }

  const details = document.createElement('details');
  details.className = 'debug-value-tree';
  const summary = document.createElement('summary');
  summary.append(preview);
  details.append(summary);

  const key = JSON.stringify(path);
  const renderChildren = () => {
    if (details.childElementCount > 1) return;
    const list = document.createElement('ul');
    list.className = 'debug-value-children';
    for (const child of children) {
      const row = document.createElement('li');
      row.append(renderDebugValue(child.value, [...path, child.label], expandedPaths, child.label));
      list.append(row);
    }
    if (value.omitted) {
      const row = document.createElement('li');
      row.className = 'debug-value-omitted';
      row.textContent = `... ${value.omitted} weitere ausgeblendet`;
      list.append(row);
    }
    details.append(list);
  };

  if (expandedPaths.has(key)) {
    details.open = true;
    renderChildren();
  }
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    if (details.open) {
      expandedPaths.add(key);
      renderChildren();
    } else {
      expandedPaths.delete(key);
    }
  });
  return details;
}
