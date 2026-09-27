import {
  MAX_PROFILE_RECORDS,
  PROFILE_FIELD_KEYS,
  PROFILE_FIELDS,
  PROFILE_RECORD_COLLECTION_DEFINITIONS,
  PROFILE_RECORD_COLLECTIONS,
  PROFILE_SECTIONS,
  recordFieldsOf,
  recordTarget,
  type FieldType,
  type ProfileChoice,
  type ProfileFieldKey,
  type ProfileRecordCollection,
  type ProfileValueKind,
} from '@applyonce/core';
import { AUTOCOMPLETE_TOKENS } from '@applyonce/field-mapper';
import {
  addRecord,
  canAddRecord,
  moveRecord,
  readStoredValue,
  recordCount,
  removeRecord,
  updateProfileValue,
  updateRecordValue,
  type Profile,
  type ProfileFieldErrors,
  type StoredProfileValue,
} from '@applyonce/profile';
import type { ReactNode } from 'react';
import {
  CheckboxField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  YesNoField,
} from './fields';

const INPUT_TYPES: Partial<Record<ProfileValueKind, string>> = {
  email: 'email',
  phone: 'tel',
  url: 'url',
};

/** Hints for fields whose expected format is not obvious. */
const PLACEHOLDERS: Partial<Record<ProfileFieldKey, string>> = {
  notice_period: 'e.g. 30 days',
  work_authorization: 'e.g. Authorized to work in Canada',
  linkedin_url: 'https://www.linkedin.com/in/…',
};

/**
 * The browser's own autofill tokens for the editor inputs, taken from the mapper's
 * token table so there is no second list (first token per profile field wins).
 */
const EDITOR_AUTOCOMPLETE: Partial<Record<ProfileFieldKey, string>> = {};
for (const [token, key] of Object.entries(AUTOCOMPLETE_TOKENS)) EDITOR_AUTOCOMPLETE[key] ??= token;

interface ProfileFormProps {
  profile: Profile;
  errors: ProfileFieldErrors;
  update: (recipe: (current: Profile) => Profile) => void;
}

/**
 * Every canonical profile field, grouped by section, generated from the definitions:
 * scalar fields, then the repeatable records of each collection in that section.
 */
export function ProfileForm({ profile, errors, update }: ProfileFormProps) {
  return (
    <>
      {PROFILE_SECTIONS.map((section) => {
        const scalars = PROFILE_FIELD_KEYS.filter(
          (key) => PROFILE_FIELDS[key].section === section && !PROFILE_FIELDS[key].record,
        );
        const collections = PROFILE_RECORD_COLLECTIONS.filter(
          (collection) => PROFILE_RECORD_COLLECTION_DEFINITIONS[collection].section === section,
        );
        if (collections.length > 0) {
          return collections.map((collection) => (
            <RecordSection
              key={collection}
              collection={collection}
              profile={profile}
              errors={errors}
              update={update}
            />
          ));
        }
        return (
          <Section key={section} title={section}>
            {scalars.map((key) => (
              <ProfileInput
                key={key}
                definition={{ ...PROFILE_FIELDS[key], key }}
                value={readStoredValue(profile, key)}
                error={errors[PROFILE_FIELDS[key].path]}
                onChange={(value) => update((current) => updateProfileValue(current, key, value))}
              />
            ))}
          </Section>
        );
      })}
      {profile.legacy && <LegacyNotice legacy={profile.legacy} />}
    </>
  );
}

interface RecordSectionProps extends ProfileFormProps {
  collection: ProfileRecordCollection;
}

/**
 * One collection's records, each editable, removable, and movable up or down. Education
 * always shows Education 1 (the primary record, whose fields the mapper fills
 * automatically), even before it has a value; other collections start empty. Records left
 * completely blank are dropped when the profile is saved.
 */
function RecordSection({ collection, profile, errors, update }: RecordSectionProps) {
  const definition = PROFILE_RECORD_COLLECTION_DEFINITIONS[collection];
  const count = recordCount(profile, collection);
  const shown = Math.max(count, collection === 'education' ? 1 : 0);
  const fields = recordFieldsOf(collection);
  const addLabel = `Add ${definition.itemLabel.toLowerCase()}`;
  return (
    <section className="profile-section" aria-label={definition.label}>
      <h2>{definition.label}</h2>
      {errors[collection] && <p className="field-error">{errors[collection]}</p>}
      {shown === 0 && <p className="muted">No entries yet.</p>}
      <ol className="record-list">
        {Array.from({ length: shown }, (_, index) => {
          const role = index === 0 ? definition.firstRecordRole : undefined;
          const title = `${definition.itemLabel} ${index + 1}${role ? ` (${role})` : ''}`;
          return (
            <li key={index} className="record">
              <div className="record-header">
                <h3>{title}</h3>
                {index < count && (
                  <div className="record-actions">
                    <button
                      type="button"
                      className="small secondary"
                      aria-label={`Move ${title} up`}
                      disabled={index === 0}
                      onClick={() => update((p) => moveRecord(p, collection, index, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="small secondary"
                      aria-label={`Move ${title} down`}
                      disabled={index === count - 1}
                      onClick={() => update((p) => moveRecord(p, collection, index, 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="small secondary"
                      aria-label={`Remove ${title}`}
                      onClick={() => update((p) => removeRecord(p, collection, index))}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
              <div className="field-grid">
                {fields.map((field) => {
                  const target = recordTarget(collection, index, field.field);
                  // The primary record's fields keep their long-standing labels.
                  const label =
                    index === 0 && field.primaryKey
                      ? PROFILE_FIELDS[field.primaryKey].label
                      : field.label;
                  return (
                    <ProfileInput
                      key={field.field}
                      definition={{ ...field, label }}
                      value={readStoredValue(profile, target)}
                      error={errors[`${collection}[${index}].${field.field}`]}
                      onChange={(value) =>
                        update((p) => updateRecordValue(p, collection, index, field.field, value))
                      }
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="secondary"
        disabled={!canAddRecord(profile, collection)}
        onClick={() =>
          // While Education 1 is only a placeholder, it becomes a record first, so the click
          // visibly adds Education 2 rather than silently turning the placeholder into data.
          update((p) =>
            addRecord(
              recordCount(p, collection) < shown ? addRecord(p, collection) : p,
              collection,
            ),
          )
        }
      >
        + {addLabel}
      </button>
      {!canAddRecord(profile, collection) && (
        <p className="muted">At most {MAX_PROFILE_RECORDS} entries.</p>
      )}
    </section>
  );
}

interface InputDefinition {
  label: string;
  kind: ProfileValueKind;
  fieldTypes: readonly FieldType[];
  choices?: readonly ProfileChoice[];
  /** Scalar key, for editor hints; absent for record fields. */
  key?: ProfileFieldKey;
}

interface ProfileInputProps {
  definition: InputDefinition;
  value: StoredProfileValue | undefined;
  error: string | undefined;
  onChange: (value: StoredProfileValue | undefined) => void;
}

function ProfileInput({ definition, value, error, onChange }: ProfileInputProps) {
  const { label, kind, choices, key, fieldTypes } = definition;
  // A record's yes/no field ("I currently work here") is a checkbox; blank means no.
  if (kind === 'boolean' && !key) {
    return (
      <CheckboxField
        label={label}
        value={value === true}
        onChange={(on) => onChange(on || undefined)}
      />
    );
  }
  if (fieldTypes[0] === 'textarea') {
    return (
      <TextAreaField
        label={label}
        value={typeof value === 'string' ? value : undefined}
        error={error}
        onChange={onChange}
      />
    );
  }
  switch (kind) {
    case 'boolean':
      return (
        <YesNoField
          label={label}
          value={typeof value === 'boolean' ? value : undefined}
          onChange={onChange}
        />
      );
    case 'choice':
      return (
        <SelectField
          label={label}
          options={choices ?? []}
          value={typeof value === 'string' ? value : undefined}
          error={error}
          onChange={onChange}
        />
      );
    case 'years':
    case 'year':
      return (
        <NumberField
          label={label}
          step={kind === 'years' ? 0.5 : 1}
          value={typeof value === 'number' ? value : undefined}
          error={error}
          onChange={onChange}
        />
      );
    default:
      return (
        <TextField
          label={label}
          type={INPUT_TYPES[kind] ?? 'text'}
          autoComplete={key && EDITOR_AUTOCOMPLETE[key]}
          placeholder={key ? PLACEHOLDERS[key] : kind === 'month' ? 'YYYY-MM' : undefined}
          value={typeof value === 'string' ? value : undefined}
          error={error}
          onChange={onChange}
        />
      );
  }
}

/** Read-only: values an older version stored that the current model has no place for. */
function LegacyNotice({ legacy }: { legacy: NonNullable<Profile['legacy']> }) {
  const items = [
    ...(legacy.education ?? []).map((entry) =>
      ['Education', entry.degree, entry.fieldOfStudy, entry.institution, entry.graduationYear]
        .filter((part) => part !== undefined && part !== '')
        .join(' · '),
    ),
    ...(legacy.workModes ?? []).map((mode) => `Work mode · ${mode}`),
    ...(legacy.employmentTypes ?? []).map((type) => `Employment type · ${type}`),
  ];
  return (
    <section className="profile-section legacy">
      <h2>Kept from an earlier version</h2>
      <p className="muted">
        ApplyOnce keeps one work mode and employment type. These additional values from your earlier
        profile are preserved but not used for autofill. (Education entries appear here only if your
        earlier profile had no primary education record.)
      </p>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="profile-section">
      <h2>{title}</h2>
      <div className="field-grid">{children}</div>
    </section>
  );
}
