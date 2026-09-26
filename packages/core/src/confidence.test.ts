import { describe, expect, it } from 'vitest';
import { toConfidenceLevel } from './confidence';

describe('toConfidenceLevel', () => {
  it.each([
    [100, 'high'],
    [90, 'high'],
    [89, 'review'],
    [70, 'review'],
    [69, 'confirm'],
    [40, 'confirm'],
    [39, 'unknown'],
    [0, 'unknown'],
  ] as const)('score %i is %s', (score, level) => {
    expect(toConfidenceLevel(score)).toBe(level);
  });
});
