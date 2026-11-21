/**
 * @file debug-value-snapshot.ts
 * @brief Begrenzte Werthierarchie fuer Variablen einer Debug-Pause.
 * @author Abdul
 */

/** Lesbare Beschreibung eines Werts mit optionalen Array-Eintraegen oder Struct-Feldern. */
export interface DebugValueSnapshot {
  text: string;
  children?: { label: string; value: DebugValueSnapshot }[];
  omitted?: number;
}

/**
 * Erstellt im Worker eine serialisierbare Vorschau. Die Grenzen gelten pro Ebene,
 * pro Variable und, ueber das gemeinsame Budget, fuer die gesamte Debug-Pause.
 */
export const DEBUG_VALUE_SNAPSHOT_SCRIPT = String.raw`
function unwrapDebugValue(value) {
  if (value !== null && typeof value === 'object') {
    if (typeof value.get === 'function' && Object.prototype.hasOwnProperty.call(value, 'value')) return value.get();
    if (typeof value.getRef === 'function') return value.getRef();
    if (Array.isArray(value.ref)) return value.ref;
  }
  return value;
}

function describeDebugValue(value, fieldNames, budget) {
  var root = unwrapDebugValue(value);
  if (root === null || typeof root !== 'object') return undefined;

  var ancestors = new Set();
  var limit = Math.min(256, budget.remaining);
  var remaining = limit;
  var result = describe(root, 0);
  budget.remaining -= limit - remaining;
  return result;

  function describe(content, depth) {
    if (typeof content === 'string') {
      var preview = content.slice(0, 240);
      return { text: JSON.stringify(preview) + (preview.length < content.length ? '...' : '') };
    }
    if (content === null || typeof content !== 'object') return { text: String(content) };
    // Die Referenz hinter dem Wrapper erkennt auch Zyklen ueber Alias-Variablen.
    if (ancestors.has(content)) return { text: '[Zyklus]' };

    var array = Array.isArray(content);
    var fields = array ? [] : Object.keys(content);
    var size = array ? content.length : fields.length;
    var text = array ? 'Array (' + size + ')' : 'Struct (' + size + (size === 1 ? ' Feld)' : ' Felder)');
    var snapshot = { text: text };
    var children = [];
    if (depth < 8 && remaining > 0 && size > 0) {
      ancestors.add(content);
      for (var i = 0; i < Math.min(40, size) && remaining > 0; i++) {
        var key = array ? i : fields[i];
        var label = array ? '[' + (i + 1) + ']' : Object.hasOwn(fieldNames, key) ? fieldNames[key] : key;
        remaining--;
        children.push({ label: label, value: describe(unwrapDebugValue(content[key]), depth + 1) });
      }
      ancestors.delete(content);
    }
    if (children.length) snapshot.children = children;
    if (children.length < size) snapshot.omitted = size - children.length;
    return snapshot;
  }
}
`;
