import {
  findRecordField,
  MAX_PROFILE_RECORDS,
  PROFILE_RECORD_COLLECTIONS,
  type FieldType,
  type FormField,
  type SavedMapping,
} from '@applyonce/core';
import { describe, expect, it } from 'vitest';
import {
  classifySectionHeading,
  createAliasMatcher,
  createMappingKey,
  createMappingKeyParts,
  mapFields,
  matchRecordField,
  RECORD_FIELD_ALIASES,
} from './index';

const matcher = createAliasMatcher();
let next = 0;
function field(
  label: string,
  record?: FormField['record'],
  type: FieldType = 'text',
  extra: Partial<FormField> = {},
): FormField {
  next += 1;
  return {
    id: `f${next}`,
    type,
    htmlType: type,
    required: false,
    visible: true,
    disabled: false,
    signals: { label },
    ...(record ? { record } : {}),
    ...extra,
  };
}
const mapOne = (f: FormField, saved?: ReadonlyMap<string, SavedMapping>) =>
  mapFields([f], matcher, saved).mappings[0];
const edu = (index: number) => ({ collection: 'education' as const, index });
const work = (index: number) => ({ collection: 'workExperience' as const, index });
const cert = (index: number) => ({ collection: 'certifications' as const, index });

describe('section headings', () => {
  it.each([
    ['Education 1', 'education', 1],
    ['Education', 'education', undefined],
    ['EDUCATION #2', 'education', 2],
    ['Education History 3', 'education', 3],
    ['Work Experience 1', 'workExperience', 1],
    ['Employment History', 'workExperience', undefined],
    ['Experience 2', 'workExperience', 2],
    ['Certification 1', 'certifications', 1],
    ['Licenses & Certifications', 'certifications', undefined],
    ['Certification (optional) 2', 'certifications', 2],
  ])('%j → %s %s', (heading, collection, number) => {
    expect(classifySectionHeading(heading)).toEqual({
      collection,
      ...(number ? { number } : {}),
    });
  });

  it.each([
    'Education preferences',
    'Your experience with us',
    'Contact details',
    'Application',
    'Education level required',
    '1 Education',
    '',
  ])('%j is not a record heading', (heading) => {
    expect(classifySectionHeading(heading)).toBeUndefined();
  });
});

describe('record field aliases', () => {
  it('only name record fields that exist in the canonical definitions', () => {
    for (const collection of PROFILE_RECORD_COLLECTIONS) {
      for (const name of Object.keys(RECORD_FIELD_ALIASES[collection])) {
        expect(findRecordField(collection, name)).toBeDefined();
      }
    }
  });

  it('never gives one question to two fields of the same record', () => {
    for (const collection of PROFILE_RECORD_COLLECTIONS) {
      const all = Object.values(RECORD_FIELD_ALIASES[collection]).flat();
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it.each([
    ['Institution *', 'education', 'institution'],
    ['School or University', 'education', 'institution'],
    ['Degree', 'education', 'degree'],
    ['Field of Study (required)', 'education', 'fieldOfStudy'],
    ['Graduation Year', 'education', 'graduationYear'],
    ['Start year', 'education', 'startYear'],
    ['Company', 'workExperience', 'company'],
    ['Job Title', 'workExperience', 'title'],
    ['Location', 'workExperience', 'location'],
    ['Start Date', 'workExperience', 'startDate'],
    ['End Date', 'workExperience', 'endDate'],
    ['I currently work here', 'workExperience', 'current'],
    ['Role Description', 'workExperience', 'description'],
    ['Name', 'certifications', 'name'],
    ['Issuer', 'certifications', 'issuer'],
    ['Issue Year', 'certifications', 'issueYear'],
    ['Credential URL', 'certifications', 'credentialUrl'],
  ] as const)('%j in %s → %s', (label, collection, name) => {
    expect(matchRecordField(field(label), collection)).toBe(name);
  });

  it.each([
    ['Company website', 'workExperience'],
    ['GPA', 'education'],
    ['Institution', 'workExperience'],
    ['Company', 'education'],
    ['Name of your manager', 'workExperience'],
  ] as const)('%j in %s matches nothing (exact questions only)', (label, collection) => {
    expect(matchRecordField(field(label), collection)).toBeUndefined();
  });
});

describe('mapping fields in repeated sections', () => {
  it('maps block 1 of education to the primary scalar keys, selected as before', () => {
    expect(mapOne(field('Institution', edu(0)))).toMatchObject({
      status: 'mapped',
      source: 'automatic',
      profileField: 'institution',
      confidence: { level: 'high', reasons: ['label', 'repeated-section'] },
    });
    expect(mapOne(field('Degree', edu(0)))?.profileField).toBe('highest_degree');
    expect(mapOne(field('Graduation Year', edu(0), 'number'))?.profileField).toBe(
      'graduation_year',
    );
  });

  it.each([
    ['Institution', edu(1), 'education[1].institution'],
    ['Field of Study', edu(2), 'education[2].fieldOfStudy'],
    ['Start year', edu(0), 'education[0].startYear'],
    ['Company', work(0), 'workExperience[0].company'],
    ['Job Title', work(1), 'workExperience[1].title'],
    ['Start Date', work(1), 'workExperience[1].startDate'],
    ['Name', cert(0), 'certifications[0].name'],
    ['Credential URL', cert(1), 'certifications[1].credentialUrl'],
  ] as const)(
    'maps %j at %j to %s for review (needs explicit approval)',
    (label, record, target) => {
      expect(mapOne(field(label, record))).toMatchObject({
        status: 'review',
        source: 'automatic',
        profileField: target,
        confidence: { level: 'review' },
      });
    },
  );

  it('never maps work experience block 1 to current employment', () => {
    expect(mapOne(field('Company', work(0)))?.profileField).toBe('workExperience[0].company');
    expect(mapOne(field('Job Title', work(0)))?.profileField).toBe('workExperience[0].title');
  });

  it('maps a checkbox and a textarea by their record field types', () => {
    expect(mapOne(field('I currently work here', work(1), 'checkbox'))).toMatchObject({
      status: 'review',
      profileField: 'workExperience[1].current',
    });
    expect(mapOne(field('Description', work(1), 'textarea'))?.profileField).toBe(
      'workExperience[1].description',
    );
  });

  it.each([
    ['an unknown question', field('GPA', edu(1))],
    ['a question from another record type', field('Company', edu(1))],
    ['a label-less field', field('', edu(1))],
    ['a position past the record limit', field('Institution', edu(MAX_PROFILE_RECORDS))],
  ])('does not guess for %s (unsupported, repeated question)', (_, f) => {
    expect(mapOne(f)).toMatchObject({
      status: 'unsupported',
      unsupportedReason: 'repeated-question',
    });
    expect(mapOne(f)?.profileField).toBeUndefined();
  });

  it('keeps the usual unsupported states', () => {
    expect(mapOne(field('Graduation Year', edu(1), 'checkbox'))).toMatchObject({
      status: 'unsupported',
      unsupportedReason: 'incompatible-type',
    });
    expect(mapOne(field('Institution', edu(1), 'text', { visible: false }))).toMatchObject({
      status: 'unsupported',
      unsupportedReason: 'hidden',
    });
  });

  it('has no Teach key, and ignores saved mappings for the same question', () => {
    const inSection = field('Institution', edu(1));
    expect(createMappingKeyParts(inSection)).toBeUndefined();
    expect(createMappingKey(inSection)).toBeUndefined();
    const standalone = field('Institution');
    const key = createMappingKey(standalone) ?? '';
    const parts = createMappingKeyParts(standalone);
    if (!parts) throw new Error('no key');
    const saved = new Map([
      [
        key,
        {
          key,
          parts,
          profileField: 'institution' as const,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    ]);
    expect(mapOne(standalone, saved)).toMatchObject({ status: 'taught' });
    const mapped = mapOne(inSection, saved);
    expect(mapped).toMatchObject({ source: 'automatic', profileField: 'education[1].institution' });
    expect(mapped?.mappingKey).toBeUndefined();
  });

  it('leaves fields outside repeated sections exactly as before', () => {
    expect(mapOne(field('University'))).toMatchObject({
      status: 'mapped',
      profileField: 'institution',
    });
    expect(mapOne(field('Current Company'))).toMatchObject({ profileField: 'current_company' });
  });
});
