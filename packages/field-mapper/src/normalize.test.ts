import { describe, expect, it } from 'vitest';
import { compactText, normalizeText } from './normalize';

describe('normalizeText', () => {
  it.each([
    ['  First Name * ', 'first name'],
    ['first_name', 'first name'],
    ['E-mail Address:', 'e mail address'],
    ['Résumé / CV', 'resume cv'],
    ['Years   of\tExperience', 'years of experience'],
    ['', ''],
    ['***', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });
});

describe('compactText', () => {
  it('makes identifier styles compare equal', () => {
    const forms = ['first name', 'first_name', 'firstName', 'FirstName', 'first-name'];
    expect(new Set(forms.map(compactText))).toEqual(new Set(['firstname']));
  });
});
