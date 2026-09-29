/**
 * Phase 17 security: stored profile data is untrusted input. Corrupted data is refused as a
 * whole (never partly loaded, guessed, or repaired), prototype-like keys stay plain data,
 * and values are only ever read through canonical definitions as plain scalars.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProfile } from './create-empty-profile';
import { migrateProfile } from './migrate-profile';
import { getProfileValue, readProfilePath } from './profile-values';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const valid = () => ({
  ...createEmptyProfile(),
  identity: { firstName: 'Jane' },
  education: [{ id: ID, institution: 'University A', degree: 'Degree A' }],
});

afterEach(() => {
  // Nothing in these tests may pollute the global object prototype.
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.prototype).not.toHaveProperty('polluted');
});

describe('corrupted profiles are refused as a whole', () => {
  it.each<[string, (p: Record<string, unknown>) => void]>([
    ['a section that is a string', (p) => (p.identity = 'Jane')],
    ['a section that is a list', (p) => (p.contact = ['jane.doe@example.com'])],
    ['a section that is null', (p) => (p.location = null)],
    ['an object as a value', (p) => (p.identity = { firstName: { first: 'Jane' } })],
    ['a list as a value', (p) => (p.links = { website: ['https://x.example'] })],
    ['a non-finite number', (p) => (p.experience = { totalExperienceYears: Infinity })],
    ['a huge text value', (p) => (p.identity = { firstName: 'x'.repeat(100_001) })],
    ['records that are not a list', (p) => (p.education = { institution: 'A' })],
    ['a record that is not an object', (p) => (p.certifications = ['x'])],
    ['a record with an object value', (p) => (p.education = [{ id: ID, degree: { a: 1 } }])],
    ['a malformed record id', (p) => (p.education = [{ id: 'not-an-id', degree: 'A' }])],
    [
      'a duplicate record id',
      (p) =>
        (p.education = [
          { id: ID, degree: 'A' },
          { id: ID, degree: 'B' },
        ]),
    ],
  ])('%s', (_, corrupt) => {
    const stored = valid() as unknown as Record<string, unknown>;
    corrupt(stored);
    const before = JSON.stringify(stored);
    expect(migrateProfile(stored)).toBeUndefined();
    expect(JSON.stringify(stored)).toBe(before); // the stored data is never changed
  });

  it.each([undefined, null, 'profile', 42, [], { schemaVersion: 99 }, { schemaVersion: '4' }])(
    'unknown data or versions (%j) are refused',
    (stored) => expect(migrateProfile(stored)).toBeUndefined(),
  );

  it('a sound profile still loads (the checks are not over-eager)', () => {
    expect(migrateProfile(valid())?.education[0]?.institution).toBe('University A');
  });
});

describe('prototype-like keys stay plain data', () => {
  it('an object under "__proto__" is refused as corrupted, without pollution', () => {
    const stored = JSON.parse(
      `{"schemaVersion":4,"identity":{"firstName":"Jane","__proto__":{"polluted":"yes"}},"education":[{"id":"${ID}","__proto__":{"polluted":"yes"}}]}`,
    ) as unknown;
    expect(migrateProfile(stored)).toBeUndefined();
  });

  it('"__proto__", "constructor", and "prototype" keys with text load as plain, unreachable data', () => {
    const stored = JSON.parse(
      `{"schemaVersion":4,"identity":{"firstName":"Jane","__proto__":"polluted","constructor":"x"},"contact":{"prototype":"y"},"education":[{"id":"${ID}","institution":"University A","__proto__":"polluted"}]}`,
    ) as unknown;
    const profile = migrateProfile(stored);
    expect(profile).toBeDefined();
    if (!profile) return;
    expect(getProfileValue(profile, 'first_name')).toBe('Jane');
    expect(getProfileValue(profile, 'institution')).toBe('University A');
    // Not reachable through any target; the internal reader (canonical paths only, not
    // exported) follows own properties only, never the prototype chain.
    for (const target of ['__proto__', 'constructor', 'prototype', 'identity.constructor'])
      expect(getProfileValue(profile, target)).toBeUndefined();
    for (const path of ['identity.toString', 'identity.hasOwnProperty', 'contact.valueOf'])
      expect(readProfilePath(profile, path)).toBeUndefined();
    expect(getProfileValue(profile, '__proto__')).toBeUndefined();
    expect(getProfileValue(profile, 'constructor')).toBeUndefined();
  });

  it('values are read only through own properties: inherited ones are invisible', () => {
    const profile = {
      ...createEmptyProfile(),
      identity: Object.create({ firstName: 'Inherited' }),
    };
    expect(getProfileValue(profile, 'first_name')).toBeUndefined();
  });

  it('values are data only: text that looks like HTML or script is returned as text', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const profile = migrateProfile({ ...valid(), identity: { firstName: hostile } });
    expect(profile && getProfileValue(profile, 'first_name')).toBe(hostile);
  });
});

describe('record references', () => {
  const profile = () => migrateProfile(valid());

  it('a record id resolves only within its own collection', () => {
    const p = profile();
    if (!p) throw new Error('no profile');
    expect(getProfileValue(p, `education@${ID}.degree`)).toBe('Degree A');
    expect(getProfileValue(p, `workExperience@${ID}.company`)).toBeUndefined();
    expect(getProfileValue(p, `certifications@${ID}.name`)).toBeUndefined();
  });

  it('a deleted record never retargets another record', () => {
    const p = profile();
    if (!p) throw new Error('no profile');
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const withOther = { ...p, education: [{ id: other, degree: 'Degree B' }] };
    expect(getProfileValue(withOther, `education@${ID}.degree`)).toBeUndefined();
  });
});
