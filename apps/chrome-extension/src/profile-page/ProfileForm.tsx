import {
  EMPLOYMENT_TYPES,
  WORK_MODES,
  type EducationEntry,
  type EmploymentType,
  type Profile,
  type ProfileFieldErrors,
  type WorkMode,
} from '@applyonce/profile';
import type { ReactNode } from 'react';
import { CheckboxGroup, NumberField, TextField, YesNoField } from './fields';

type SectionKey =
  'identity' | 'contact' | 'location' | 'experience' | 'links' | 'preferences' | 'authorization';

const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
};

interface ProfileFormProps {
  profile: Profile;
  errors: ProfileFieldErrors;
  update: (recipe: (current: Profile) => Profile) => void;
}

export function ProfileForm({ profile, errors, update }: ProfileFormProps) {
  function setField<S extends SectionKey, F extends keyof Profile[S]>(
    section: S,
    field: F,
    value: Profile[S][F],
  ) {
    update((current) => ({ ...current, [section]: { ...current[section], [field]: value } }));
  }

  function updateEducation(index: number, patch: Partial<EducationEntry>) {
    update((current) => ({
      ...current,
      education: current.education.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      ),
    }));
  }

  const { identity, contact, location, experience, links, preferences, authorization } = profile;

  return (
    <>
      <Section title="Personal">
        <TextField
          label="First name"
          autoComplete="given-name"
          value={identity.firstName}
          onChange={(v) => setField('identity', 'firstName', v)}
        />
        <TextField
          label="Middle name"
          autoComplete="additional-name"
          value={identity.middleName}
          onChange={(v) => setField('identity', 'middleName', v)}
        />
        <TextField
          label="Last name"
          autoComplete="family-name"
          value={identity.lastName}
          onChange={(v) => setField('identity', 'lastName', v)}
        />
      </Section>

      <Section title="Contact">
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={contact.email}
          error={errors['contact.email']}
          onChange={(v) => setField('contact', 'email', v)}
        />
        <TextField
          label="Phone"
          type="tel"
          autoComplete="tel"
          value={contact.phone}
          error={errors['contact.phone']}
          onChange={(v) => setField('contact', 'phone', v)}
        />
      </Section>

      <Section title="Location">
        <TextField
          label="Address"
          autoComplete="street-address"
          value={location.address}
          onChange={(v) => setField('location', 'address', v)}
        />
        <TextField
          label="City"
          autoComplete="address-level2"
          value={location.city}
          onChange={(v) => setField('location', 'city', v)}
        />
        <TextField
          label="State / province"
          autoComplete="address-level1"
          value={location.state}
          onChange={(v) => setField('location', 'state', v)}
        />
        <TextField
          label="Country"
          autoComplete="country-name"
          value={location.country}
          onChange={(v) => setField('location', 'country', v)}
        />
        <TextField
          label="Postal code"
          autoComplete="postal-code"
          value={location.postalCode}
          onChange={(v) => setField('location', 'postalCode', v)}
        />
      </Section>

      <Section title="Education">
        {profile.education.map((entry, index) => (
          <div className="list-entry" key={index}>
            <TextField
              label="Institution"
              value={entry.institution}
              onChange={(v) => updateEducation(index, { institution: v })}
            />
            <TextField
              label="Degree"
              value={entry.degree}
              onChange={(v) => updateEducation(index, { degree: v })}
            />
            <TextField
              label="Field of study"
              value={entry.fieldOfStudy}
              onChange={(v) => updateEducation(index, { fieldOfStudy: v })}
            />
            <NumberField
              label="Graduation year"
              value={entry.graduationYear}
              error={errors[`education.${index}.graduationYear`]}
              onChange={(v) => updateEducation(index, { graduationYear: v })}
            />
            <button
              type="button"
              className="link-button"
              onClick={() =>
                update((current) => ({
                  ...current,
                  education: current.education.filter((_, i) => i !== index),
                }))
              }
            >
              Remove education
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            update((current) => ({ ...current, education: [...current.education, {}] }))
          }
        >
          Add education
        </button>
      </Section>

      <Section title="Experience">
        <TextField
          label="Current company"
          autoComplete="organization"
          value={experience.currentCompany}
          onChange={(v) => setField('experience', 'currentCompany', v)}
        />
        <TextField
          label="Current title"
          autoComplete="organization-title"
          value={experience.currentTitle}
          onChange={(v) => setField('experience', 'currentTitle', v)}
        />
        <NumberField
          label="Total years of experience"
          step={0.5}
          value={experience.totalExperienceYears}
          error={errors['experience.totalExperienceYears']}
          onChange={(v) => setField('experience', 'totalExperienceYears', v)}
        />
        <TextField
          label="Notice period"
          placeholder="e.g. 30 days"
          value={experience.noticePeriod}
          onChange={(v) => setField('experience', 'noticePeriod', v)}
        />
      </Section>

      <Section title="Links">
        <TextField
          label="LinkedIn"
          type="url"
          value={links.linkedin}
          error={errors['links.linkedin']}
          onChange={(v) => setField('links', 'linkedin', v)}
        />
        <TextField
          label="GitHub"
          type="url"
          value={links.github}
          error={errors['links.github']}
          onChange={(v) => setField('links', 'github', v)}
        />
        <TextField
          label="Portfolio / website"
          type="url"
          autoComplete="url"
          value={links.portfolio}
          error={errors['links.portfolio']}
          onChange={(v) => setField('links', 'portfolio', v)}
        />
      </Section>

      <Section title="Preferences">
        <CheckboxGroup
          legend="Work mode"
          options={WORK_MODES}
          labels={WORK_MODE_LABELS}
          value={preferences.workModes}
          onChange={(v) => setField('preferences', 'workModes', v)}
        />
        <CheckboxGroup
          legend="Employment type"
          options={EMPLOYMENT_TYPES}
          labels={EMPLOYMENT_TYPE_LABELS}
          value={preferences.employmentTypes}
          onChange={(v) => setField('preferences', 'employmentTypes', v)}
        />
        <YesNoField
          label="Willing to relocate"
          value={preferences.openToRelocation}
          onChange={(v) => setField('preferences', 'openToRelocation', v)}
        />
      </Section>

      <Section title="Authorization">
        <TextField
          label="Work authorization"
          placeholder="e.g. Authorized to work in Canada"
          value={authorization.workAuthorization}
          onChange={(v) => setField('authorization', 'workAuthorization', v)}
        />
        <YesNoField
          label="Requires visa sponsorship"
          value={authorization.requiresSponsorship}
          onChange={(v) => setField('authorization', 'requiresSponsorship', v)}
        />
      </Section>
    </>
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
