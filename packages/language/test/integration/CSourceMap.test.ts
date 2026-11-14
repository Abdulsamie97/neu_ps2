/**
 * @file CSourceMap.test.ts
 * @brief Prueft die beiden C-zu-Pseudo2-Quellabbildungsformate.
 * @author Abdul
 */

import { describe, expect, test } from 'vitest';
import { stripInlineSourceMapMarkers, stripSourceMapMarkers } from '../../src/generators/c/c-source-map.js';

describe('C source maps', () => {
  test('uses the innermost source line for nested runtime-C ranges', () => {
    const markedCode = [
      'runtime;',
      '/*@@pseudo2-source-line:2*/',
      'outer;',
      '/*@@pseudo2-source-line:3*/',
      'inner;',
      '/*@@pseudo2-source-line:end*/',
      'outer2;',
      '/*@@pseudo2-source-line:end*/',
      'tail;'
    ].join('\n');

    expect(stripSourceMapMarkers(markedCode)).toEqual({
      code: 'runtime;\nouter;\ninner;\nouter2;\ntail;',
      sourceMap: [
        { generatedLine: 2, sourceLine: 2 },
        { generatedLine: 3, sourceLine: 3 },
        { generatedLine: 4, sourceLine: 2 }
      ]
    });
  });

  test('carries the last inline source line across direct-C output lines', () => {
    const markedCode = [
      'runtime;',
      '/*__ps2_line_7__*/  value;',
      '  next;',
      '/*__ps2_line_9__*/  return;'
    ].join('\n');

    expect(stripInlineSourceMapMarkers(markedCode)).toEqual({
      code: 'runtime;\n  value;\n  next;\n  return;',
      sourceMap: [
        { generatedLine: 2, sourceLine: 7 },
        { generatedLine: 3, sourceLine: 7 },
        { generatedLine: 4, sourceLine: 9 }
      ]
    });
  });
});
