import {
  createEmptyProfile,
  sanitizeProfile,
  validateProfile,
  type Profile,
  type ProfileFieldErrors,
} from '@applyonce/profile';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProfileRepository } from '../storage';

export type LoadState = 'loading' | 'ready' | 'failed';

export interface StatusMessage {
  kind: 'success' | 'error';
  text: string;
}

const NO_ERRORS: ProfileFieldErrors = {};

/**
 * Editing state for the profile page: load once, edit in memory, validate and save
 * explicitly. Storage is only touched on load, save, and clear.
 */
export function useProfileEditor(repository: ProfileRepository) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [profile, setProfile] = useState<Profile>(createEmptyProfile);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [status, setStatus] = useState<StatusMessage>();

  useEffect(() => {
    let cancelled = false;
    repository.load().then(
      (saved) => {
        if (cancelled) return;
        setProfile(saved);
        setLoadState('ready');
      },
      (error: unknown) => {
        if (cancelled) return;
        logFailure('load', error);
        setLoadState('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repository]);

  // Errors appear after the first save attempt, then update live as fields are fixed.
  const errors = useMemo(
    () => (showErrors ? validateProfile(profile).errors : NO_ERRORS),
    [profile, showErrors],
  );

  const update = useCallback((recipe: (current: Profile) => Profile) => {
    setProfile(recipe);
    setDirty(true);
    setStatus(undefined);
  }, []);

  async function save() {
    if (!validateProfile(profile).valid) {
      setShowErrors(true);
      setStatus({ kind: 'error', text: 'Fix the highlighted fields, then save again.' });
      return;
    }
    const cleaned = sanitizeProfile(profile);
    setBusy(true);
    try {
      await repository.save(cleaned);
      setProfile(cleaned);
      setDirty(false);
      setShowErrors(false);
      setStatus({ kind: 'success', text: 'Profile saved' });
    } catch (error) {
      logFailure('save', error);
      setStatus({ kind: 'error', text: 'Could not save your profile. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await repository.clear();
      setProfile(createEmptyProfile());
      setDirty(false);
      setShowErrors(false);
      setStatus({ kind: 'success', text: 'Profile cleared' });
    } catch (error) {
      logFailure('clear', error);
      setStatus({ kind: 'error', text: 'Could not clear your profile. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return { loadState, profile, errors, dirty, busy, status, update, save, clear };
}

/** Logs the error type only. Never log profile values. */
function logFailure(operation: string, error: unknown) {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`ApplyOnce: profile ${operation} failed (${kind})`);
}
