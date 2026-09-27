import { describe, expect, it } from 'vitest';
import { normalizeChoice } from './index';

describe('normalizeChoice', () => {
  it.each([
    ['remote', 'remote'],
    ['Remote', 'remote'],
    ['REMOTE', 'remote'],
    ['On-site', 'onsite'],
    ['on site', 'onsite'],
    ['onsite', 'onsite'],
    ['Hybrid', 'hybrid'],
  ])('work mode %j → %s', (input, expected) => {
    expect(normalizeChoice('work_mode', input)).toBe(expected);
  });

  it.each([
    ['full time', 'full-time'],
    ['full-time', 'full-time'],
    ['full_time', 'full-time'],
    ['Full Time', 'full-time'],
    ['PART-TIME', 'part-time'],
    ['Contract', 'contract'],
    ['internship', 'internship'],
    ['Temporary', 'temporary'],
  ])('employment type %j → %s', (input, expected) => {
    expect(normalizeChoice('employment_type', input)).toBe(expected);
  });

  it.each([
    ['work_mode', 'Remote / Hybrid'],
    ['work_mode', 'in office'],
    ['employment_type', 'freelance'],
    ['employment_type', ''],
    ['work_mode', 42],
    ['city', 'remote'],
  ] as const)('%s %j is not a choice', (key, input) => {
    expect(normalizeChoice(key, input)).toBeUndefined();
  });
});
