import {
  PROFILE_FIELD_KEYS,
  PROFILE_FIELDS,
  PROFILE_SECTIONS,
  type ProfileFieldKey,
  type ProfileValueKind,
} from '@applyonce/core';
import { AUTOCOMPLETE_TOKENS } from '@applyonce/field-mapper';
import {
  readStoredValue,
  updateProfileValue,
  type Profile,
  type ProfileFieldErrors,
  type StoredProfileValue,
} from '@applyonce/profile';
import type { ReactNode } from 'react';
import { NumberField, SelectField, TextField, YesNoField } from './fields';

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

/** Every canonical profile field, grouped by section, generated from the definitions. */
export function ProfileForm({ profile, errors, update }: ProfileFormProps) {
  return (
    <>
      {PROFILE_SECTIONS.map((section) => (
        <Section key={section} title={section}>
          {PROFILE_FIELD_KEYS.filter((key) => PROFILE_FIELDS[key].section === section).map(
            (key) => (
              <ProfileInput
                key={key}
                fieldKey={key}
                value={readStoredValue(profile, key)}
                error={errors[PROFILE_FIELDS[key].path]}
                onChange={(value) => update((current) => updateProfileValue(current, key, value))}
              />
            ),
          )}
        </Section>
      ))}
      {profile.legacy && <LegacyNotice legacy={profile.legacy} />}
    </>
  );
}

interface ProfileInputProps {
  fieldKey: ProfileFieldKey;
  value: StoredProfileValue | undefined;
  error: string | undefined;
  onChange: (value: StoredProfileValue | undefined) => void;
}

function ProfileInput({ fieldKey, value, error, onChange }: ProfileInputProps) {
  const { label, kind, choices } = PROFILE_FIELDS[fieldKey];
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
          autoComplete={EDITOR_AUTOCOMPLETE[fieldKey]}
          placeholder={PLACEHOLDERS[fieldKey]}
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
        ApplyOnce now keeps one primary education record, work mode, and employment type. These
        additional values from your earlier profile are preserved but not used for autofill.
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
