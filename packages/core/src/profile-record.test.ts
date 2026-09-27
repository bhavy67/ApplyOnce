import { describe, expect, it } from 'vitest';
import {
  findRecordField,
  isFieldType,
  isProfileTarget,
  MAX_PROFILE_RECORDS,
  PROFILE_FIELD_KEYS,
  PROFILE_FIELDS,
  PROFILE_RECORD_COLLECTION_DEFINITIONS,
  PROFILE_RECORD_COLLECTIONS,
  PROFILE_RECORD_FIELDS,
  PROFILE_SECTIONS,
  recordFieldsOf,
  recordTarget,
  resolveProfileTarget,
} from './index';

describe('repeatable record definitions', () => {
  it('defines three collections, each with a section, labels, and fields', () => {
    expect(PROFILE_RECORD_COLLECTIONS).toEqual(['education', 'workExperience', 'certifications']);
    for (const collection of PROFILE_RECORD_COLLECTIONS) {
      const definition = PROFILE_RECORD_COLLECTION_DEFINITIONS[collection];
      expect(PROFILE_SECTIONS).toContain(definition.section);
      expect(definition.label.trim()).not.toBe('');
      expect(definition.itemLabel.trim()).not.toBe('');
      expect(recordFieldsOf(collection).length).toBeGreaterThan(0);
    }
  });

  it.each(PROFILE_RECORD_FIELDS.map((d) => [`${d.collection}.${d.field}`, d] as const))(
    '%s has a collection, a record property, label, kind, field types, and Teach eligibility',
    (_, definition) => {
      expect(PROFILE_RECORD_COLLECTIONS).toContain(definition.collection);
      expect(definition.field).toMatch(/^[a-z][A-Za-z]+$/);
      expect(definition.label.trim()).not.toBe('');
      expect(['text', 'year', 'month', 'boolean', 'url']).toContain(definition.kind);
      expect(definition.fieldTypes.length).toBeGreaterThan(0);
      expect(definition.fieldTypes.every(isFieldType)).toBe(true);
      expect(typeof definition.teachable).toBe('boolean');
    },
  );

  it('defines each record field once', () => {
    const ids = PROFILE_RECORD_FIELDS.map((d) => `${d.collection}.${d.field}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the small, agreed record shapes', () => {
    const shape = (collection: (typeof PROFILE_RECORD_COLLECTIONS)[number]) =>
      recordFieldsOf(collection).map((d) => d.field);
    expect(shape('education')).toEqual([
      'institution',
      'degree',
      'fieldOfStudy',
      'startYear',
      'graduationYear',
    ]);
    expect(shape('workExperience')).toEqual([
      'company',
      'title',
      'location',
      'startDate',
      'endDate',
      'current',
      'description',
    ]);
    expect(shape('certifications')).toEqual(['name', 'issuer', 'issueYear', 'credentialUrl']);
  });

  it('derives the primary education fields from education records (one definition)', () => {
    const primary = PROFILE_RECORD_FIELDS.filter((d) => d.primaryKey);
    expect(primary.map((d) => d.primaryKey).sort()).toEqual([
      'field_of_study',
      'graduation_year',
      'highest_degree',
      'institution',
    ]);
    for (const definition of primary) {
      const scalar = PROFILE_FIELDS[definition.primaryKey ?? 'first_name'];
      expect(scalar.path).toBe(`education[0].${definition.field}`);
      expect(scalar.record).toEqual({ collection: 'education', field: definition.field });
      expect(scalar.kind).toBe(definition.kind);
      expect(scalar.fieldTypes).toBe(definition.fieldTypes);
    }
    // Only these four scalars are record-backed; current employment stays scalar.
    expect(PROFILE_FIELD_KEYS.filter((key) => PROFILE_FIELDS[key].record)).toHaveLength(4);
    expect(PROFILE_FIELDS.current_company.record).toBeUndefined();
    expect(PROFILE_FIELDS.current_company.path).toBe('experience.currentCompany');
  });
});

describe('profile targets', () => {
  it('resolves scalar keys unchanged', () => {
    expect(resolveProfileTarget('city')).toMatchObject({
      target: 'city',
      label: 'City',
      path: 'location.city',
    });
    expect(resolveProfileTarget('institution')).toMatchObject({
      target: 'institution',
      path: 'education[0].institution',
      record: { collection: 'education', index: 0, field: 'institution' },
    });
  });

  it.each([
    ['education[1].institution', 'Education 2 → Institution'],
    ['education[0].startYear', 'Education 1 → Start year'],
    ['workExperience[0].company', 'Work experience 1 → Company'],
    ['workExperience[1].company', 'Work experience 2 → Company'],
    ['certifications[0].name', 'Certification 1 → Name'],
  ])('resolves %s with a readable label', (target, label) => {
    expect(resolveProfileTarget(target)).toMatchObject({ target, label, path: target });
  });

  it('canonicalizes a primary record field to its scalar key (no duplicate targets)', () => {
    expect(resolveProfileTarget('education[0].institution')?.target).toBe('institution');
    expect(resolveProfileTarget('education[0].degree')?.target).toBe('highest_degree');
    expect(recordTarget('education', 0, 'fieldOfStudy')).toBe('field_of_study');
    expect(recordTarget('education', 1, 'fieldOfStudy')).toBe('education[1].fieldOfStudy');
    expect(recordTarget('workExperience', 0, 'company')).toBe('workExperience[0].company');
  });

  it.each([
    'education.institution',
    'education[1]',
    'education[1].gpa',
    'education[01].institution',
    'education[-1].institution',
    `education[${MAX_PROFILE_RECORDS}].institution`,
    'education[1].institution.length',
    'workExperience[0].__proto__',
    'constructor',
    '__proto__',
    'identity.firstName',
    'profile.education[1].institution',
    'jobs[0].company',
    ' education[1].institution',
    '',
    42,
    undefined,
  ])('rejects %j', (value) => {
    expect(resolveProfileTarget(value)).toBeUndefined();
    expect(isProfileTarget(value)).toBe(false);
  });

  it('allows indexes up to the record limit', () => {
    expect(isProfileTarget(`education[${MAX_PROFILE_RECORDS - 1}].institution`)).toBe(true);
    expect(findRecordField('education', 'institution')?.primaryKey).toBe('institution');
    expect(findRecordField('education', 'toString')).toBeUndefined();
  });
});
