/**
 * Phase 17 security: profile targets resolve only against the canonical definitions. No
 * string, however crafted, becomes an object path, a prototype access, or a reference to a
 * record outside its collection.
 */
import { describe, expect, it } from 'vitest';
import {
  isProfileTarget,
  isRecordId,
  isRecordIdTarget,
  resolveProfileTarget,
} from './profile-field';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('profile path security', () => {
  it.each([
    '__proto__',
    'prototype',
    'constructor',
    'toString',
    'hasOwnProperty',
    '__proto__.polluted',
    'constructor.prototype',
    'identity.firstName',
    'identity',
    'location.city',
    'identity["firstName"]',
    "identity['firstName']",
    'education[0]',
    'education[0].__proto__',
    'education[0].constructor',
    'education[0].id',
    'education[01].institution',
    'education[-1].institution',
    'education[1e1].institution',
    'education[20].institution',
    'education[999999].institution',
    'education[0].institution.length',
    'education[0][institution]',
    'education.0.institution',
    'education[0].company',
    'workExperience[0].institution',
    'legacy',
    'legacy.education',
    'documents.resumes',
    'customAnswers[0].answer',
    'schemaVersion',
    'first_name ',
    ' first_name',
    'FIRST_NAME',
    'first_name\u0000',
    '',
  ])('%j is not a profile target', (value) => {
    expect(resolveProfileTarget(value)).toBeUndefined();
    expect(isProfileTarget(value)).toBe(false);
  });

  it.each([null, undefined, 42, true, {}, [], ['first_name'], { toString: () => 'first_name' }])(
    'non-strings (%j) are not profile targets',
    (value) => expect(resolveProfileTarget(value)).toBeUndefined(),
  );

  it('canonical targets resolve to fixed definitions, never to the given text as a path', () => {
    expect(resolveProfileTarget('first_name')?.path).toBe('identity.firstName');
    expect(resolveProfileTarget('education[1].institution')?.record).toEqual({
      collection: 'education',
      index: 1,
      field: 'institution',
    });
  });
});

describe('record id security', () => {
  it.each([ID, 'm-0123456789abcdef'])('%j is a record id', (id) =>
    expect(isRecordId(id)).toBe(true),
  );

  it.each([
    '',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa', // one digit short
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', // uppercase
    `${ID} `,
    `${ID}.degree`,
    'm-0123456789abcdeg',
    'm-0123456789abcdef0',
    '__proto__',
    '../aaaa',
    '0',
  ])('%j is not a record id', (id) => expect(isRecordId(id)).toBe(false));

  it.each([
    `education@${ID}.degree`,
    `workExperience@${ID}.company`,
    `certifications@m-0123456789abcdef.name`,
  ])('%j is a record-id target', (target) => expect(isRecordIdTarget(target)).toBe(true));

  it.each([
    `education@${ID}.company`, // a work experience field on an education record
    `workExperience@${ID}.institution`,
    `education@${ID}.__proto__`,
    `education@${ID}.constructor`,
    `education@${ID}.id`,
    `education@${ID}`,
    `education@__proto__.degree`,
    `education@not-an-id.degree`,
    `profile@${ID}.degree`,
    `legacy@${ID}.degree`,
    `education@${ID}.degree.length`,
    `education@${ID}..degree`,
    `Education@${ID}.degree`,
  ])('%j is refused', (target) => {
    expect(isRecordIdTarget(target)).toBe(false);
    expect(resolveProfileTarget(target)).toBeUndefined();
  });
});
