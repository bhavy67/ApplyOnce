import { PROFILE_SCHEMA_VERSION, type Profile } from './profile';

export function createEmptyProfile(): Profile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    identity: {},
    contact: {},
    location: {},
    education: [],
    experience: {},
    workExperience: [],
    certifications: [],
    links: {},
    preferences: {},
    authorization: {},
    documents: { resumes: [], coverLetters: [] },
    customAnswers: [],
  };
}
