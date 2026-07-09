import { describe, expect, test } from 'vitest';

import { getSummaryFromCode } from '../../src/index.js';

describe('getSummaryFromCode', () => {
  test('summarizes declarations and diagnostics', async () => {
    const summary = await getSummaryFromCode(`
var n = 1

func f(x)
  return x

struct S
  num value
  inc()
    this.value = this.value + 1
    return this.value
`);

    expect(summary).toContain('Top-level instructions: 3');
    expect(summary).toContain('Global variables: n');
    expect(summary).toContain('Structs: S');
    expect(summary).toContain('Functions: f');
    expect(summary).toContain('Methods: inc');
    expect(summary).toContain('Diagnostics: 0 error(s), 0 warning(s)');
  });

  test('handles empty code', async () => {
    await expect(getSummaryFromCode('   ')).resolves.toBe('Empty Pseudo2 program.');
  });
});
