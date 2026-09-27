import {
  isRecordId,
  isRecordIdTarget,
  recordIdTarget,
  resolveProfileTarget,
} from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import {
  addRecord,
  countProfileValues,
  createEmptyProfile,
  getProfileValue,
  isBlankRecord,
  migrateProfile,
  moveRecord,
  newRecordId,
  recordChoices,
  recordIndexById,
  removeRecord,
  sanitizeProfile,
  updateProfileValue,
  updateRecordValue,
  withRecordIds,
  type Profile,
} from './index';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ids = (records: readonly { id?: string }[]) => records.map((record) => record.id);

function twoEducations(): Profile {
  let profile = addRecord(addRecord(createEmptyProfile(), 'education'), 'education');
  profile = updateRecordValue(profile, 'education', 0, 'institution', 'University A');
  profile = updateRecordValue(profile, 'education', 0, 'degree', 'Degree A');
  profile = updateRecordValue(profile, 'education', 1, 'institution', 'University B');
  return updateRecordValue(profile, 'education', 1, 'degree', 'Degree B');
}

describe('stable record ids', () => {
  it('gives each new record a random UUID, unique across records', () => {
    const generated = new Set(Array.from({ length: 200 }, () => newRecordId()));
    expect(generated.size).toBe(200);
    expect([...generated].every(isRecordId)).toBe(true);
    let profile = createEmptyProfile();
    for (const collection of ['education', 'workExperience', 'certifications'] as const) {
      profile = addRecord(addRecord(profile, collection), collection);
      const [a, b] = ids(profile[collection]);
      expect(isRecordId(a) && isRecordId(b) && a !== b).toBe(true);
    }
  });

  it('keeps ids through edits, reordering, and removal of other records', () => {
    let profile = twoEducations();
    const [a, b] = ids(profile.education);
    profile = updateRecordValue(profile, 'education', 0, 'institution', 'University A (renamed)');
    expect(ids(profile.education)).toEqual([a, b]);
    profile = moveRecord(profile, 'education', 1, -1);
    expect(ids(profile.education)).toEqual([b, a]);
    expect(profile.education[1]?.institution).toBe('University A (renamed)');
    profile = addRecord(profile, 'education');
    const [, , c] = ids(profile.education);
    profile = removeRecord(profile, 'education', 0);
    expect(ids(profile.education)).toEqual([a, c]);
  });

  it('is gone for good when its record is deleted; a new record never reuses it', () => {
    let profile = twoEducations();
    const [a] = ids(profile.education);
    profile = removeRecord(profile, 'education', 0);
    expect(recordIndexById(profile, 'education', a ?? '')).toBe(-1);
    profile = addRecord(profile, 'education');
    expect(ids(profile.education)).not.toContain(a);
  });

  it('keeps ids through save (sanitize) and load (migrate)', () => {
    const profile = sanitizeProfile(twoEducations());
    const reloaded = migrateProfile(clone(profile));
    expect(ids(reloaded?.education ?? [])).toEqual(ids(profile.education));
  });

  it('does not count ids as values, and a record with only an id is blank', () => {
    const profile = addRecord(createEmptyProfile(), 'certifications');
    expect(countProfileValues(profile)).toBe(0);
    expect(isBlankRecord(profile.certifications[0] ?? {})).toBe(true);
    expect(sanitizeProfile(profile).certifications).toEqual([]);
  });

  it('cannot be written as a value', () => {
    const profile = twoEducations();
    expect(() => updateRecordValue(profile, 'education', 0, 'id', 'x')).toThrow();
  });
});

describe('migration adds ids', () => {
  const v3 = {
    ...createEmptyProfile(),
    schemaVersion: 3,
    education: [{ institution: 'University A' }, { institution: 'University B' }],
    workExperience: [{ company: 'Company A' }],
    certifications: [{ name: 'Cert A' }, { name: 'Cert A' }],
  };

  it('gives every stored record exactly one id, unique within its collection, values unchanged', () => {
    const migrated = migrateProfile(clone(v3));
    for (const key of ['education', 'workExperience', 'certifications'] as const) {
      const list = migrated?.[key] ?? [];
      expect(list.every((record) => isRecordId(record.id))).toBe(true);
      expect(new Set(ids(list)).size).toBe(list.length);
    }
    expect(migrated?.education.map((r) => r.institution)).toEqual(['University A', 'University B']);
  });

  it('gives the same ids on every load until saved, and keeps them after saving', () => {
    const first = migrateProfile(clone(v3));
    const second = migrateProfile(clone(v3));
    expect(ids(first?.certifications ?? [])).toEqual(ids(second?.certifications ?? []));
    if (!first) throw new Error('migration failed');
    // Saved, reordered, and loaded again: ids stay with their records.
    const reordered = moveRecord(sanitizeProfile(first), 'education', 1, -1);
    const reloaded = migrateProfile(clone(reordered));
    expect(ids(reloaded?.education ?? [])).toEqual([
      first.education[1]?.id,
      first.education[0]?.id,
    ]);
    expect(migrateProfile(clone(reloaded))).toEqual(reloaded);
  });

  it('keeps valid ids and repairs missing, malformed, or duplicate ones', () => {
    const good = newRecordId();
    const repaired = withRecordIds('education', [
      { id: good, institution: 'A' },
      { id: good, institution: 'B' },
      { id: '../../etc', institution: 'C' },
      { institution: 'D' },
    ]);
    expect(repaired[0]?.id).toBe(good);
    expect(repaired.slice(1).every((r) => isRecordId(r.id) && r.id !== good)).toBe(true);
    expect(new Set(repaired.map((r) => r.id)).size).toBe(4);
  });
});

describe('record id targets', () => {
  it('resolve only with a canonical collection, a valid id, and a known field', () => {
    const id = newRecordId();
    expect(isRecordIdTarget(recordIdTarget('education', id, 'degree'))).toBe(true);
    expect(resolveProfileTarget(`education@${id}.degree`)).toMatchObject({
      label: 'Education → Degree',
      record: { collection: 'education', recordId: id, field: 'degree' },
    });
    for (const bad of [
      `education@${id}.gpa`,
      `education@${id}.__proto__`,
      `jobs@${id}.company`,
      'education@../../x.degree',
      'education@1.degree',
      `education@${id}`,
      `education@${id}.degree.length`,
    ]) {
      expect(resolveProfileTarget(bad)).toBeUndefined();
    }
  });

  it('read the value of that exact record, wherever it is now', () => {
    let profile = twoEducations();
    const [a, b] = ids(profile.education);
    const targetA = recordIdTarget('education', a ?? '', 'degree');
    const targetB = recordIdTarget('education', b ?? '', 'degree');
    expect([getProfileValue(profile, targetA), getProfileValue(profile, targetB)]).toEqual([
      'Degree A',
      'Degree B',
    ]);
    profile = moveRecord(profile, 'education', 1, -1);
    expect([getProfileValue(profile, targetA), getProfileValue(profile, targetB)]).toEqual([
      'Degree A',
      'Degree B',
    ]);
    // Edited value is used; a deleted record never falls back to another record.
    profile = updateRecordValue(profile, 'education', 1, 'degree', 'Degree A2');
    expect(getProfileValue(profile, targetA)).toBe('Degree A2');
    profile = removeRecord(profile, 'education', 1);
    expect(getProfileValue(profile, targetA)).toBeUndefined();
    expect(getProfileValue(profile, targetB)).toBe('Degree B');
  });

  it('never read across collections or from blank fields', () => {
    const profile = twoEducations();
    const [a] = ids(profile.education);
    expect(
      getProfileValue(profile, recordIdTarget('workExperience', a ?? '', 'company')),
    ).toBeUndefined();
    expect(
      getProfileValue(profile, recordIdTarget('education', a ?? '', 'fieldOfStudy')),
    ).toBeUndefined();
  });

  it('cannot be written through the editor path', () => {
    const profile = twoEducations();
    const target = recordIdTarget('education', profile.education[0]?.id ?? '', 'degree');
    expect(() => updateProfileValue(profile, target, 'X')).toThrow();
  });
});

describe('record choices', () => {
  it('label records by position and summary fields only, in current order', () => {
    let profile = twoEducations();
    profile = { ...profile, contact: { email: 'jane@example.com', phone: '+1 555 010 0199' } };
    profile = addRecord(profile, 'workExperience');
    profile = updateRecordValue(profile, 'workExperience', 0, 'company', 'Company A');
    profile = updateRecordValue(profile, 'workExperience', 0, 'description', 'Private notes');
    const choices = recordChoices(moveRecord(profile, 'education', 1, -1));
    expect(choices.education.map(({ index, summary }) => [index, summary])).toEqual([
      [0, 'University B · Degree B'],
      [1, 'University A · Degree A'],
    ]);
    expect(choices.workExperience.map((c) => c.summary)).toEqual(['Company A']);
    expect(JSON.stringify(choices)).not.toMatch(/jane@example|555|Private notes/);
    expect(choices.certifications).toEqual([]);
  });
});
